"""Bounded public schemas for project coding-assistant conversations."""

from datetime import datetime
import re
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


_CREDENTIAL_PATTERN = re.compile(
    r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|"
    r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b|\bAKIA[0-9A-Z]{16}\b|"
    r"\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}|"
    r"\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*['\"]?[^\s,'\"]{8,}",
    re.IGNORECASE,
)
_LOCAL_ABSOLUTE_PATH = re.compile(r"(?:^|\s)/(?:Users|home|private|tmp|etc|var|opt|root|Volumes|Applications|System|Library|mnt)/[^\s,;]*|(?:^|\s)[A-Za-z]:\\[^\s,;]*")


def contains_credential_like_text(value: str) -> bool:
    return bool(_CREDENTIAL_PATTERN.search(value))


def contains_local_absolute_path(value: str) -> bool:
    return bool(_LOCAL_ABSOLUTE_PATH.search(value))


class ConversationModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)


class ConversationCreate(ConversationModel):
    title: str = Field(default="New conversation", min_length=1, max_length=120)

    @field_validator("title")
    @classmethod
    def nonempty_title(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("A conversation title is required")
        title = value.strip()
        if contains_credential_like_text(title):
            raise ValueError("Credential-like text cannot be saved in a conversation")
        return title


class ConversationSummary(ConversationModel):
    id: UUID
    project_id: UUID
    title: str
    created_at: datetime
    updated_at: datetime
    message_count: int


class SourceReference(ConversationModel):
    relative_path: str = Field(min_length=1, max_length=2048)
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)


class ConversationMessage(ConversationModel):
    id: UUID
    request_id: UUID | None = None
    role: Literal["user", "assistant"]
    content: str = Field(max_length=16_000)
    status: Literal["pending", "complete", "failed", "interrupted"]
    sources: list[SourceReference] = Field(max_length=5)
    error_message: str | None = Field(default=None, max_length=300)
    created_at: datetime


class ConversationDetail(ConversationModel):
    id: UUID
    project_id: UUID
    title: str
    created_at: datetime
    updated_at: datetime
    messages: list[ConversationMessage] = Field(max_length=100)


class SendMessageRequest(ConversationModel):
    request_id: UUID
    content: str = Field(min_length=1, max_length=8000)

    @field_validator("content")
    @classmethod
    def nonempty_content(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Message cannot be empty")
        content = value.strip()
        if contains_credential_like_text(content):
            raise ValueError("Credential-like text cannot be saved in a conversation")
        return content


class SendMessageResponse(ConversationModel):
    user_message: ConversationMessage
    assistant_message: ConversationMessage


class ConversationList(ConversationModel):
    conversations: list[ConversationSummary]
