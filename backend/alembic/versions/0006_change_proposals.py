"""Persist immutable code change proposals and lifecycle."""

from alembic import op
import sqlalchemy as sa
revision = "0006_change_proposals"
down_revision = "0005_project_conversations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "change_proposals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=True),
        sa.Column("summary", sa.String(), nullable=False),
        sa.Column("operation", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("outcome", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], ["project_conversations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_change_proposals_project_created", "change_proposals", ["project_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_change_proposals_project_created", table_name="change_proposals")
    op.drop_table("change_proposals")
