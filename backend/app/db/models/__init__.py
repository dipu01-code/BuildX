"""Import model modules here so Alembic can discover their tables."""

from app.db.models.project import Project

__all__ = ["Project"]
