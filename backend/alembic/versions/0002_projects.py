"""Create persistent projects.

Revision ID: 0002_projects
Revises: 0001_empty_schema
"""

from alembic import op
import sqlalchemy as sa

revision = "0002_projects"
down_revision = "0001_empty_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create project metadata without touching project directories."""
    op.create_table(
        "projects",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=2000), nullable=True),
        sa.Column("root_path", sa.String(length=2048), nullable=True),
        sa.Column("project_type", sa.String(length=60), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_projects_updated_at", "projects", ["updated_at"], unique=False)


def downgrade() -> None:
    """Remove project metadata without touching project directories."""
    op.drop_index("ix_projects_updated_at", table_name="projects")
    op.drop_table("projects")
