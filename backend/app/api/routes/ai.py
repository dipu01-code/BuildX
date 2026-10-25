"""Safe AI provider status and minimal connection test endpoints."""

from fastapi import APIRouter, Request

from app.ai.contracts import (
    AIConnectionTestResponse,
    AIErrorCategory,
    AIProviderStatus,
    ConnectionTestRequest,
    ProviderError,
)

router = APIRouter(prefix="/ai", tags=["ai"])

_ERROR_MESSAGES = {
    AIErrorCategory.CONFIGURATION_ERROR: "Add BUILDX_OPENAI_API_KEY to the backend environment, then restart BUILDX.",
    AIErrorCategory.AUTHENTICATION_ERROR: "The provider rejected the configured credential. Check BUILDX_OPENAI_API_KEY.",
    AIErrorCategory.RATE_LIMITED: "The provider rate limit was reached. Wait a moment before retrying.",
    AIErrorCategory.TIMEOUT: "The provider did not respond before the connection test timed out.",
    AIErrorCategory.NETWORK_ERROR: "BUILDX could not reach the AI provider. Check your network connection.",
    AIErrorCategory.MALFORMED_RESPONSE: "The provider returned an unexpected response. Try again later.",
    AIErrorCategory.PROVIDER_ERROR: "The provider could not complete the connection test. Try again later.",
}


@router.get("/status", response_model=AIProviderStatus, summary="Read safe AI provider configuration status")
def get_ai_status(request: Request) -> AIProviderStatus:
    """Return configured metadata without claiming the provider is reachable."""

    settings = request.app.state.settings
    configured = bool(
        settings.openai_api_key
        and settings.openai_api_key.get_secret_value().strip()
    )
    return AIProviderStatus(
        provider_configured=configured,
        provider_id=settings.ai_provider,
        model_id=settings.ai_model,
        credential_available=configured,
        connection_status="not_tested" if configured else "missing_credentials",
    )


@router.post(
    "/test-connection",
    response_model=AIConnectionTestResponse,
    summary="Send a minimal test request to the configured AI provider",
    description="Sends a short provider test prompt. A successful test may incur a small API charge.",
)
async def test_ai_connection(request: Request) -> AIConnectionTestResponse:
    """Call the configured adapter and return only normalized, sanitized fields."""

    settings = request.app.state.settings
    provider = request.app.state.ai_provider
    if provider is None:
        category = AIErrorCategory.CONFIGURATION_ERROR
        return AIConnectionTestResponse(
            success=False,
            provider_id=settings.ai_provider,
            model_id=settings.ai_model,
            error_category=category,
            message=_ERROR_MESSAGES[category],
        )

    try:
        result = await provider.test_connection(ConnectionTestRequest())
    except ProviderError as error:
        return AIConnectionTestResponse(
            success=False,
            provider_id=settings.ai_provider,
            model_id=settings.ai_model,
            error_category=error.category,
            message=_ERROR_MESSAGES[error.category],
        )

    return AIConnectionTestResponse(
        success=True,
        provider_id=result.provider_id,
        model_id=result.model_id,
        response_text=result.response_text,
        duration_ms=result.duration_ms,
    )
