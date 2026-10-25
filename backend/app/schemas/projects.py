"""Validated project request and response schemas."""

from datetime import datetime, timezone
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ProjectCreate(BaseModel):
    """Fields accepted when a project record is created."""

    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    root_path: str | None = Field(default=None, max_length=2048)
    project_type: str | None = Field(default=None, max_length=60)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Project name must contain a non-whitespace character")
        return value


class ProjectUpdate(BaseModel):
    """Partial editable metadata; root paths are persisted without filesystem access."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    root_path: str | None = Field(default=None, max_length=2048)
    project_type: str | None = Field(default=None, max_length=60)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Project name must contain a non-whitespace character")
        return value

    @model_validator(mode="after")
    def validate_changes(self) -> "ProjectUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one editable field must be provided")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("Project name cannot be null")
        return self


class ProjectResponse(BaseModel):
    """Serialized project metadata with consistent UTC timestamps."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    description: str | None
    root_path: str | None
    project_type: str | None
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at")
    @classmethod
    def normalize_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
