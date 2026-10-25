"""Add persisted project plans.

Revision ID: 0003_project_plans
Revises: 0002_projects
"""

from alembic import op
import sqlalchemy as sa

revision = "0003_project_plans"
down_revision = "0002_projects"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_plans",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("plan_data", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_project_plans_project_created", "project_plans", ["project_id", "created_at"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_project_plans_project_created", table_name="project_plans")
    op.drop_table("project_plans")
