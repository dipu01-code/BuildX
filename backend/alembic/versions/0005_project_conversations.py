"""Persist project-scoped AI coding conversations and visible messages.

Revision ID: 0005_project_conversations
Revises: 0004_project_context
"""

from alembic import op
import sqlalchemy as sa

revision = "0005_project_conversations"
down_revision = "0004_project_context"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_conversations",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_project_conversations_project_updated", "project_conversations", ["project_id", "updated_at"]
    )
    op.create_table(
        "project_conversation_messages",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("conversation_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("request_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("sources", sa.JSON(), nullable=False),
        sa.Column("error_message", sa.String(length=300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], ["project_conversations.id"], ondelete="CASCADE"),
        sa.CheckConstraint("role IN ('user', 'assistant')", name="ck_project_conversation_messages_role"),
        sa.CheckConstraint("status IN ('pending', 'complete', 'failed', 'interrupted')", name="ck_project_conversation_messages_status"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_project_conversation_messages_conversation_created",
        "project_conversation_messages", ["conversation_id", "created_at"],
    )
    op.create_index(
        "uq_project_conversation_messages_request_role",
        "project_conversation_messages", ["conversation_id", "request_id", "role"], unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_project_conversation_messages_request_role", table_name="project_conversation_messages")
    op.drop_index("ix_project_conversation_messages_conversation_created", table_name="project_conversation_messages")
    op.drop_table("project_conversation_messages")
    op.drop_index("ix_project_conversations_project_updated", table_name="project_conversations")
    op.drop_table("project_conversations")
