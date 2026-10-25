"""Import model modules here so Alembic can discover their tables."""

from app.db.models.project import Project
from app.db.models.project import ProjectIndexJob, ProjectIndexedChunk, ProjectIndexedFile
from app.db.models.project_plan import ProjectPlan

__all__ = [
    "Project", "ProjectPlan", "ProjectIndexJob", "ProjectIndexedFile", "ProjectIndexedChunk",
]
