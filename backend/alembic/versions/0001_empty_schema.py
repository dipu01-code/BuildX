"""Establish the initial migration baseline; domain tables are not approved yet.

Revision ID: 0001_empty_schema
Revises:
"""

revision = "0001_empty_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No application tables are approved for this phase."""


def downgrade() -> None:
    """The initial baseline has no schema objects to remove."""
