"""Stable, client-safe API error response models."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ErrorDetail(BaseModel):
    """A safe validation detail; rejected input values are deliberately omitted."""

    location: list[str | int] = Field(default_factory=list)
    message: str
    type: str


class ErrorBody(BaseModel):
    """Error envelope shared by API exception handlers."""

    code: str
    message: str
    details: list[ErrorDetail] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    """Top-level error response."""

    model_config = ConfigDict(json_schema_extra={"example": {"error": {"code": "VALIDATION_ERROR", "message": "The request is invalid", "details": [{"location": ["query", "limit"], "message": "Input should be greater than 0", "type": "greater_than"}]}}})

    error: ErrorBody


class PlannerAPIError(Exception):
    """Actionable, sanitized planner failure using the shared error envelope."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(code)


def safe_validation_details(errors: list[dict[str, Any]]) -> list[ErrorDetail]:
    """Select non-sensitive fields from Pydantic's validation errors."""

    return [
        ErrorDetail(
            location=[part if isinstance(part, (str, int)) else str(part) for part in error.get("loc", ())],
            message=str(error.get("msg", "Invalid value")),
            type=str(error.get("type", "value_error")),
        )
        for error in errors
    ]
