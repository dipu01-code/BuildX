"""Provider contract, safe status and connection-test coverage."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from pydantic import SecretStr
from fastapi.testclient import TestClient

from app.ai.contracts import (
    AIErrorCategory,
    ConnectionTestRequest,
    NormalizedAIResponse,
    ProviderError,
)
from app.ai import openai_provider
from app.ai.openai_provider import OpenAIProvider
from app.core.config import Settings
from app.main import create_app


class FakeProvider:
    provider_id = "openai"
    model_id = "gpt-test"

    def __init__(self, error: AIErrorCategory | None = None) -> None:
        self.error = error
        self.requests: list[ConnectionTestRequest] = []

    async def test_connection(self, request: ConnectionTestRequest) -> NormalizedAIResponse:
        self.requests.append(request)
        if self.error:
            raise ProviderError(self.error)
        return NormalizedAIResponse(
            provider_id=self.provider_id,
            model_id=self.model_id,
            response_text="BUILDX connection verified.",
            duration_ms=12,
        )


def test_missing_credentials_are_reported_without_creating_a_provider() -> None:
    client = TestClient(create_app(Settings(environment="test", _env_file=None)))

    status = client.get("/api/v1/ai/status").json()
    result = client.post("/api/v1/ai/test-connection").json()

    assert status == {
        "provider_configured": False,
        "provider_id": "openai",
        "model_id": "gpt-5.4-mini",
        "credential_available": False,
        "connection_status": "missing_credentials",
    }
    assert result["success"] is False
    assert result["error_category"] == "configuration_error"
    assert "BUILDX_OPENAI_API_KEY" in result["message"]


def test_status_never_returns_the_configured_credential() -> None:
    secret = "sk-test-never-return-this"
    settings = Settings(environment="test", openai_api_key=SecretStr(secret), _env_file=None)
    response = TestClient(create_app(settings, ai_provider=FakeProvider())).get("/api/v1/ai/status")

    assert response.json()["provider_configured"] is True
    assert response.json()["credential_available"] is True
    assert secret not in json.dumps(response.json())
    assert "reachable" not in json.dumps(response.json()).casefold()


def test_connection_test_uses_the_normalized_provider_contract() -> None:
    provider = FakeProvider()
    settings = Settings(environment="test", openai_api_key=SecretStr("sk-test"), _env_file=None)
    response = TestClient(create_app(settings, ai_provider=provider)).post("/api/v1/ai/test-connection")

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "provider_id": "openai",
        "model_id": "gpt-test",
        "response_text": "BUILDX connection verified.",
        "duration_ms": 12,
        "error_category": None,
        "message": None,
    }
    assert len(provider.requests) == 1
    assert provider.requests[0].prompt == "Reply with exactly: BUILDX connection verified."


@pytest.mark.parametrize("category", list(AIErrorCategory))
def test_provider_failures_are_returned_as_safe_categories(category: AIErrorCategory) -> None:
    provider = FakeProvider(error=category)
    settings = Settings(environment="test", openai_api_key=SecretStr("sk-test"), _env_file=None)
    response = TestClient(create_app(settings, ai_provider=provider)).post("/api/v1/ai/test-connection")

    assert response.status_code == 200
    assert response.json()["success"] is False
    assert response.json()["error_category"] == category.value
    assert "sk-test" not in response.text
    assert "ProviderError" not in response.text


def test_openai_adapter_normalizes_response_and_disables_provider_storage() -> None:
    class FakeResponses:
        calls: list[dict[str, object]] = []

        async def create(self, **kwargs: object) -> SimpleNamespace:
            self.calls.append(kwargs)
            return SimpleNamespace(output_text="  BUILDX connection verified.  ")

    responses = FakeResponses()
    adapter = OpenAIProvider("sk-test", "gpt-test", client=SimpleNamespace(responses=responses))
    result = asyncio.run(adapter.test_connection(ConnectionTestRequest()))

    assert result.provider_id == "openai"
    assert result.model_id == "gpt-test"
    assert result.response_text == "BUILDX connection verified."
    assert responses.calls == [{
        "model": "gpt-test",
        "input": "Reply with exactly: BUILDX connection verified.",
        "max_output_tokens": 64,
        "reasoning": {"effort": "none"},
        "store": False,
    }]


def test_openai_adapter_rejects_empty_provider_response() -> None:
    class FakeResponses:
        async def create(self, **_kwargs: object) -> SimpleNamespace:
            return SimpleNamespace(output_text=" ")

    adapter = OpenAIProvider("sk-test", "gpt-test", client=SimpleNamespace(responses=FakeResponses()))

    with pytest.raises(ProviderError) as error:
        asyncio.run(adapter.test_connection(ConnectionTestRequest()))
    assert error.value.category is AIErrorCategory.MALFORMED_RESPONSE


@pytest.mark.parametrize(
    ("sdk_error_name", "category"),
    [
        ("AuthenticationError", AIErrorCategory.AUTHENTICATION_ERROR),
        ("PermissionDeniedError", AIErrorCategory.AUTHENTICATION_ERROR),
        ("RateLimitError", AIErrorCategory.RATE_LIMITED),
        ("APITimeoutError", AIErrorCategory.TIMEOUT),
        ("APIConnectionError", AIErrorCategory.NETWORK_ERROR),
        ("APIResponseValidationError", AIErrorCategory.MALFORMED_RESPONSE),
        ("APIStatusError", AIErrorCategory.PROVIDER_ERROR),
    ],
)
def test_openai_adapter_maps_sdk_errors_without_exposing_their_message(
    monkeypatch: pytest.MonkeyPatch, sdk_error_name: str, category: AIErrorCategory
) -> None:
    class SimulatedSDKError(Exception):
        pass

    class FakeResponses:
        async def create(self, **_kwargs: object) -> None:
            raise SimulatedSDKError("sk-secret response body and authorization header")

    monkeypatch.setattr(openai_provider, sdk_error_name, SimulatedSDKError)
    adapter = OpenAIProvider("sk-test", "gpt-test", client=SimpleNamespace(responses=FakeResponses()))

    with pytest.raises(ProviderError) as error:
        asyncio.run(adapter.test_connection(ConnectionTestRequest()))
    assert error.value.category is category
    assert "sk-secret" not in str(error.value)
