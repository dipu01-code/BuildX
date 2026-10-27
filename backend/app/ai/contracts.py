"""Small normalized contract shared by provider adapters and API routes."""

from enum import Enum
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field


class AIErrorCategory(str, Enum):
    """Stable error categories that do not expose provider response bodies."""

    CONFIGURATION_ERROR = "configuration_error"
    AUTHENTICATION_ERROR = "authentication_error"
    RATE_LIMITED = "rate_limited"
    TIMEOUT = "timeout"
    NETWORK_ERROR = "network_error"
    MALFORMED_RESPONSE = "malformed_response"
    PROVIDER_ERROR = "provider_error"


class ConnectionTestRequest(BaseModel):
    """Fixed, non-sensitive input for a provider connection check."""

    prompt: str = "Reply with exactly: BUILDX connection verified."


class NormalizedAIResponse(BaseModel):
    """Provider-neutral response returned by the AI infrastructure layer."""

    model_config = ConfigDict(extra="forbid")

    provider_id: str
    model_id: str
    response_text: str
    duration_ms: int


class StructuredGenerationRequest(BaseModel):
    """Bounded, provider-neutral request for a schema-constrained generation."""

    instruction: str
    user_content: str
    schema_name: str
    json_schema: dict[str, object]
    max_output_tokens: int = 6000


class TextGenerationRequest(BaseModel):
    """Bounded user-visible response generation without structured output mode."""

    instruction: str = Field(min_length=1, max_length=4000)
    user_content: str = Field(min_length=1, max_length=24_000)
    max_output_tokens: int = Field(default=1600, ge=1, le=2000)


class ProviderError(Exception):
    """A safe normalized failure; never retain or expose the SDK exception text."""

    def __init__(self, category: AIErrorCategory) -> None:
        self.category = category
        super().__init__(category.value)


class AIProvider(Protocol):
    """Minimal interface future AI features can use without SDK dependencies."""

    provider_id: str
    model_id: str

    async def test_connection(self, request: ConnectionTestRequest) -> NormalizedAIResponse:
        """Send the provider's smallest supported test request."""

    async def generate_structured(
        self, request: StructuredGenerationRequest
    ) -> NormalizedAIResponse:
        """Generate bounded JSON matching the supplied JSON Schema."""

    async def generate_text(self, request: TextGenerationRequest) -> NormalizedAIResponse:
        """Generate a bounded user-visible text response."""


class AIProviderStatus(BaseModel):
    """Safe configured-provider metadata; it deliberately says nothing about reachability."""

    provider_configured: bool
    provider_id: str
    model_id: str
    credential_available: bool
    connection_status: str


class AIConnectionTestResponse(BaseModel):
    """Stable success/failure response shown by the desktop settings screen."""

    success: bool
    provider_id: str
    model_id: str
    response_text: str | None = None
    duration_ms: int | None = None
    error_category: AIErrorCategory | None = None
    message: str | None = None
