"""OpenAI Responses API adapter; SDK details stay behind the provider contract."""

from time import monotonic
import logging
from typing import Any

from openai import (
    APIConnectionError,
    APIResponseValidationError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    AuthenticationError,
    PermissionDeniedError,
    RateLimitError,
)

from app.ai.contracts import (
    AIErrorCategory,
    ConnectionTestRequest,
    NormalizedAIResponse,
    ProviderError,
)


class OpenAIProvider:
    """One OpenAI provider configured from backend-only settings."""

    provider_id = "openai"

    def __init__(
        self,
        api_key: str,
        model_id: str,
        *,
        timeout_seconds: float = 8.0,
        client: Any | None = None,
    ) -> None:
        self.model_id = model_id
        # Do not let SDK debug logging expose HTTP details when OPENAI_LOG is inherited.
        logging.getLogger("openai").setLevel(logging.WARNING)
        self._client = client or AsyncOpenAI(
            api_key=api_key,
            base_url="https://api.openai.com/v1",
            timeout=timeout_seconds,
            max_retries=0,
        )

    async def test_connection(self, request: ConnectionTestRequest) -> NormalizedAIResponse:
        """Send only the fixed test prompt and disable provider-side response storage."""

        started = monotonic()
        try:
            response = await self._client.responses.create(
                model=self.model_id,
                input=request.prompt,
                max_output_tokens=64,
                reasoning={"effort": "none"},
                store=False,
            )
        except AuthenticationError as error:
            raise ProviderError(AIErrorCategory.AUTHENTICATION_ERROR) from error
        except PermissionDeniedError as error:
            raise ProviderError(AIErrorCategory.AUTHENTICATION_ERROR) from error
        except RateLimitError as error:
            raise ProviderError(AIErrorCategory.RATE_LIMITED) from error
        except APITimeoutError as error:
            raise ProviderError(AIErrorCategory.TIMEOUT) from error
        except APIConnectionError as error:
            raise ProviderError(AIErrorCategory.NETWORK_ERROR) from error
        except APIResponseValidationError as error:
            raise ProviderError(AIErrorCategory.MALFORMED_RESPONSE) from error
        except APIStatusError as error:
            raise ProviderError(AIErrorCategory.PROVIDER_ERROR) from error
        except Exception as error:
            # SDK errors can contain request details; callers receive only a category.
            raise ProviderError(AIErrorCategory.PROVIDER_ERROR) from error

        response_text = getattr(response, "output_text", None)
        if not isinstance(response_text, str) or not response_text.strip():
            raise ProviderError(AIErrorCategory.MALFORMED_RESPONSE)

        return NormalizedAIResponse(
            provider_id=self.provider_id,
            model_id=self.model_id,
            response_text=response_text.strip(),
            duration_ms=max(0, round((monotonic() - started) * 1000)),
        )

    async def close(self) -> None:
        """Release the SDK's async HTTP client during backend shutdown."""

        await self._client.close()
