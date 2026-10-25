"""Bounded contracts for local project context indexing and retrieval."""

from datetime import datetime
import re
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


_IGNORED_DIRS = {
    ".git", "node_modules", "bower_components", "vendor", "dist", "build", "out", "coverage",
    ".next", ".nuxt", ".cache", ".turbo", ".parcel-cache", ".vite", ".venv", "venv", "env",
    ".tox", ".mypy_cache", ".pytest_cache", ".ruff_cache", "__pycache__", "target", ".idea",
    ".aws", ".ssh", "secrets", "credentials", "certificates",
}
_SENSITIVE_NAME = re.compile(
    r"^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|\.dockercfg|id_(?:rsa|dsa|ecdsa|ed25519)|"
    r".*(?:secret|credential|password|token|private.?key|service.?account).*)$", re.IGNORECASE
)
_SENSITIVE_SUFFIX = {".pem", ".key", ".p12", ".pfx", ".p7b", ".p7c", ".jks", ".keystore"}
_SECRET_CONTENT = re.compile(
    r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|"
    r"(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*['\"]?\S{12,}",
    re.IGNORECASE,
)


class ContextModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)


def validate_relative_path(value: str) -> str:
    if not value or len(value) > 2048 or "\x00" in value or "\\" in value or value.startswith("/"):
        raise ValueError("A project-relative file path is required")
    if len(value) > 1 and value[1] == ":":
        raise ValueError("Absolute file paths are not allowed")
    parts = value.split("/")
    if any(part in {"", ".", ".."} or ":" in part for part in parts):
        raise ValueError("The file path contains an invalid segment")
    if any(part.lower() in _IGNORED_DIRS for part in parts[:-1]):
        raise ValueError("Generated, private, and version-control paths cannot be indexed")
    filename = parts[-1]
    if _SENSITIVE_NAME.fullmatch(filename) or filename.lower().endswith(tuple(_SENSITIVE_SUFFIX)):
        raise ValueError("Sensitive files cannot be indexed")
    return value


class IndexedFileInput(ContextModel):
    relative_path: str = Field(min_length=1, max_length=2048)
    content_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    file_size: int = Field(ge=0, le=1_048_576)
    modified_at_ms: int = Field(ge=0, le=9_007_199_254_740_991)
    content: str | None = Field(default=None, max_length=1_048_576)

    @field_validator("relative_path")
    @classmethod
    def relative_path_only(cls, value: str) -> str:
        return validate_relative_path(value)

    @field_validator("content")
    @classmethod
    def reject_credentials(cls, value: str | None) -> str | None:
        if value is not None and _SECRET_CONTENT.search(value):
            raise ValueError("Credential-like content cannot be stored in the project index")
        return value


class IndexFilesRequest(ContextModel):
    files: list[IndexedFileInput] = Field(min_length=1, max_length=8)


class IndexIssue(ContextModel):
    path: str = Field(default="", max_length=2048)
    message: str = Field(min_length=1, max_length=240)

    @field_validator("path")
    @classmethod
    def relative_issue_path(cls, value: str) -> str:
        return validate_relative_path(value) if value else value

    @field_validator("message")
    @classmethod
    def no_absolute_paths_in_message(cls, value: str) -> str:
        if re.search(r"(?<!\w)/(?:\S+)|\b[A-Za-z]:[\\/](?:\S*)", value):
            raise ValueError("Error messages cannot contain absolute paths")
        return value


class IndexProgressRequest(ContextModel):
    discovered_count: int = Field(ge=0, le=5000)
    processed_count: int = Field(ge=0, le=5000)
    skipped_count: int = Field(ge=0, le=100_000)
    skip_reasons: dict[str, int] = Field(default_factory=dict, max_length=20)
    errors: list[IndexIssue] = Field(default_factory=list, max_length=100)

    @field_validator("skip_reasons")
    @classmethod
    def validate_skip_reasons(cls, value: dict[str, int]) -> dict[str, int]:
        if any(not re.fullmatch(r"[a-z0-9_]{1,48}", key) or count < 0 or count > 100_000 for key, count in value.items()):
            raise ValueError("Skip reason counts are invalid")
        return value


class IndexCompleteRequest(IndexProgressRequest):
    eligible_paths: list[str] = Field(max_length=5000)
    failed_paths: list[str] = Field(default_factory=list, max_length=5000)
    incomplete: bool = False

    @field_validator("eligible_paths", "failed_paths")
    @classmethod
    def validate_paths(cls, values: list[str]) -> list[str]:
        result = [validate_relative_path(value) for value in values]
        if len(result) != len(set(result)):
            raise ValueError("File paths must be unique")
        return result


class IndexedFileMetadata(ContextModel):
    relative_path: str
    content_hash: str
    file_size: int
    modified_at_ms: int
    status: str
    indexed_at: datetime


class IndexStatus(ContextModel):
    project_id: UUID
    state: Literal["not_indexed", "indexing", "up_to_date", "partial", "failed"]
    discovered_count: int
    processed_count: int
    skipped_count: int
    indexed_file_count: int
    chunk_count: int
    skip_reasons: dict[str, int]
    errors: list[dict[str, str]]
    started_at: datetime | None
    completed_at: datetime | None
    updated_at: datetime | None


class IndexedFilesPage(ContextModel):
    files: list[IndexedFileMetadata]
    total: int
    offset: int
    limit: int


class ContextChunkResponse(ContextModel):
    id: UUID
    relative_path: str
    chunk_index: int
    content: str
    start_line: int
    end_line: int
    content_hash: str
    chunk_hash: str
    indexed_at: datetime


class ContextSearchResult(ContextModel):
    relative_path: str
    start_line: int
    end_line: int
    excerpt: str
    score: float
    chunk_hash: str


class ContextSearchResponse(ContextModel):
    query: str
    results: list[ContextSearchResult]
    total: int


class IndexRefreshAccepted(ContextModel):
    project_id: UUID
    state: Literal["indexing"]
    started_at: datetime


class IndexFailureRequest(ContextModel):
    message: str = Field(min_length=1, max_length=240)

    @field_validator("message")
    @classmethod
    def no_absolute_paths(cls, value: str) -> str:
        if re.search(r"(?<!\w)/(?:\S+)|\b[A-Za-z]:[\\/](?:\S*)", value):
            raise ValueError("Error messages cannot contain absolute paths")
        return value
