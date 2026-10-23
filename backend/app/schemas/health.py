"""Health endpoint response schema."""

from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    """Confirms only that the API process is serving requests."""

    status: Literal["ok"]
    service: str
    version: str
