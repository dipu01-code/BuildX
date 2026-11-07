"""Persist user application preferences across restarts.

The settings table stores typed, non-secret preferences only. Sensitive
credentials (for example BUILDX_OPENAI_API_KEY) remain in backend environment
configuration and are never stored here.
"""

from alembic import op
import sqlalchemy as sa

revision = "0007_app_settings"
down_revision = "0006_change_proposals"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("value_json", sa.JSON(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    op.drop_table("app_settings")
