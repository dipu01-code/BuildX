"""Validated runtime settings for the local BUILDX API."""

from functools import lru_cache
from ipaddress import ip_address
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Settings loaded from BUILDX_* environment variables."""

    model_config = SettingsConfigDict(
        env_prefix="BUILDX_",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "BUILDX API"
    app_version: str = "0.1.0"
    environment: Literal["development", "test", "production"] = "development"
    api_prefix: str = "/api/v1"
    host: str = "127.0.0.1"
    port: int = Field(default=0, ge=0, le=65535)

    @field_validator("api_prefix")
    @classmethod
    def validate_api_prefix(cls, value: str) -> str:
        if not value.startswith("/") or value == "/" or value.endswith("/"):
            raise ValueError("API prefix must start with / and have no trailing slash")
        return value

    @field_validator("host")
    @classmethod
    def validate_loopback_host(cls, value: str) -> str:
        if value.casefold() == "localhost":
            return value
        try:
            is_loopback = ip_address(value).is_loopback
        except ValueError as error:
            raise ValueError("API host must be localhost or a loopback IP address") from error
        if not is_loopback:
            raise ValueError("API host must be localhost or a loopback IP address")
        return value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached process settings, validating the environment on first use."""

    return Settings()
