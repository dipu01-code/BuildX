"""Validated runtime settings for the local BUILDX API."""

from functools import lru_cache
from ipaddress import ip_address
import os
from pathlib import Path
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
    data_dir: Path | None = None
    database_url: str | None = None

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

    @property
    def resolved_data_dir(self) -> Path:
        """Persistent app data directory, overridable by the Electron main process."""
        if self.data_dir is not None:
            return self.data_dir.expanduser().resolve()
        override = os.environ.get("BUILDX_DATA_DIR")
        if override:
            return Path(override).expanduser().resolve()
        if os.name == "nt":
            base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
            return base / "BUILDX"
        if os.uname().sysname == "Darwin":
            return Path.home() / "Library" / "Application Support" / "BUILDX"
        return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "buildx"

    @property
    def resolved_database_url(self) -> str:
        """Return an explicit SQLite URL or a URL under the persistent data directory."""
        if self.database_url:
            if not (self.database_url.startswith("sqlite:") or self.database_url.startswith("sqlite+")):
                raise ValueError("Only SQLite database URLs are supported")
            return self.database_url
        path = self.resolved_data_dir / "buildx.db"
        return f"sqlite:///{path}"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached process settings, validating the environment on first use."""

    return Settings()
