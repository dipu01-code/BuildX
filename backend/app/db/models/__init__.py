"""Import model modules here so Alembic can discover their tables."""

from app.db.models.project import Project
from app.db.models.project import (
    ProjectConversation,
    ProjectConversationMessage,
    ProjectIndexJob,
    ProjectIndexedChunk,
    ProjectIndexedFile,
)
from app.db.models.project_plan import ChangeProposal, ProjectPlan

__all__ = [
    "Project", "ProjectPlan", "ChangeProposal", "ProjectIndexJob", "ProjectIndexedFile", "ProjectIndexedChunk",
    "ProjectConversation", "ProjectConversationMessage",
]
