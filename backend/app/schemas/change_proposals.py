"""Validated, bounded proposals for review-first file changes."""

import hashlib
import re
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_FILE_CHARS = 1_000_000
_HASH = re.compile(r"^[0-9a-f]{64}$")
_SENSITIVE = re.compile(r"^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|credentials?|secrets?|auth|service-account.*\.json|.*\.(?:pem|key|p12|pfx|jks)|id_(?:rsa|dsa|ecdsa|ed25519))$", re.I)


def _safe_path(value: str) -> str:
    if (value.startswith(("/", "\\")) or ":" in value
            or any(x in ("", ".", "..") for x in value.replace("\\", "/").split("/"))
            or any(_SENSITIVE.fullmatch(part) for part in value.replace("\\", "/").split("/"))):
        raise ValueError("A safe, normalized project-relative path is required")
    return value


class ProposalModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GenerateProposalRequest(ProposalModel):
    request: str = Field(min_length=1, max_length=4000)
    relative_path: str = Field(min_length=1, max_length=2048)
    original_hash: str | None
    original_content: str | None = Field(max_length=MAX_FILE_CHARS)
    conversation_id: UUID | None = None

    @field_validator("relative_path")
    @classmethod
    def valid_relative_path(cls, value: str) -> str:
        return _safe_path(value)

    @field_validator("original_hash")
    @classmethod
    def valid_hash(cls, value: str | None) -> str | None:
        if value is not None and not _HASH.fullmatch(value):
            raise ValueError("A lowercase SHA-256 hash is required")
        return value

    @field_validator("original_content")
    @classmethod
    def content_hash_matches(cls, value: str | None, info):
        original_hash = info.data.get("original_hash")
        if value is None and original_hash is not None:
            raise ValueError("Missing original content for supplied hash")
        if value is not None and hashlib.sha256(value.encode()).hexdigest() != original_hash:
            raise ValueError("Original content does not match its hash")
        return value


class AIProposedOperation(ProposalModel):
    operation: Literal["create", "modify"]
    explanation: str = Field(min_length=1, max_length=1200)
    relative_path: str = Field(min_length=1, max_length=2048)
    original_hash: str | None
    proposed_content: str = Field(max_length=MAX_FILE_CHARS)

    @field_validator("relative_path")
    @classmethod
    def valid_path(cls, value: str) -> str:
        return _safe_path(value)

    @field_validator("original_hash")
    @classmethod
    def valid_original_hash(cls, value: str | None, info):
        if (info.data.get("operation") == "create") != (value is None):
            raise ValueError("Create must have no original hash; modify must have a SHA-256 hash")
        if value is not None and not _HASH.fullmatch(value):
            raise ValueError("A lowercase SHA-256 hash is required")
        return value


class ProposedOperation(AIProposedOperation):
    original_content: str | None = Field(max_length=MAX_FILE_CHARS)


class ProposalRecord(ProposalModel):
    id: UUID
    project_id: UUID
    conversation_id: UUID | None
    summary: str
    operation: ProposedOperation
    status: Literal["pending_review", "approved", "applying", "applied", "rejected", "conflicted", "failed"]
    outcome: dict | None
    created_at: datetime
    updated_at: datetime


class ProposalList(ProposalModel):
    proposals: list[ProposalRecord]


class ApplyOutcome(ProposalModel):
    status: Literal["applied", "conflicted", "failed"]
    result_hash: str | None = None
    message: str | None = Field(default=None, max_length=300)
