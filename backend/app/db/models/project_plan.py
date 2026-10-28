"""Persisted, validated plans associated with a project record."""

from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, JSON, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ProjectPlan(Base):
    __tablename__ = "project_plans"
    __table_args__ = (Index("ix_project_plans_project_created", "project_id", "created_at"),)

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    plan_data: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )


class ChangeProposal(Base):
    __tablename__ = "change_proposals"
    __table_args__ = (Index("ix_change_proposals_project_created", "project_id", "created_at"),)

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    conversation_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("project_conversations.id", ondelete="SET NULL"), nullable=True)
    summary: Mapped[str] = mapped_column(nullable=False)
    operation: Mapped[dict] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(nullable=False, default="pending_review")
    outcome: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)
