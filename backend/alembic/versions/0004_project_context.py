"""Persist project context indexing state and chunks.

Revision ID: 0004_project_context
Revises: 0003_project_plans
"""

from alembic import op
import sqlalchemy as sa

revision = "0004_project_context"
down_revision = "0003_project_plans"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_indexed_files",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("relative_path", sa.String(length=2048), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("modified_at_ms", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="indexed"),
        sa.Column("indexed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_project_indexed_files_project_path", "project_indexed_files", ["project_id", "relative_path"], unique=True)
    op.create_index("ix_project_indexed_files_project_indexed", "project_indexed_files", ["project_id", "indexed_at"], unique=False)

    op.create_table(
        "project_indexed_chunks",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("file_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("relative_path", sa.String(length=2048), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("start_line", sa.Integer(), nullable=False),
        sa.Column("end_line", sa.Integer(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("chunk_hash", sa.String(length=64), nullable=False),
        sa.Column("indexed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["file_id"], ["project_indexed_files.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_project_indexed_chunks_file_index", "project_indexed_chunks", ["file_id", "chunk_index"], unique=True)
    op.create_index("ix_project_indexed_chunks_project", "project_indexed_chunks", ["project_id"], unique=False)
    op.create_index("ix_project_indexed_chunks_hash", "project_indexed_chunks", ["project_id", "chunk_hash"], unique=False)

    op.create_table(
        "project_index_jobs",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("state", sa.String(length=24), nullable=False),
        sa.Column("discovered_count", sa.Integer(), nullable=False),
        sa.Column("processed_count", sa.Integer(), nullable=False),
        sa.Column("skipped_count", sa.Integer(), nullable=False),
        sa.Column("skip_reasons", sa.JSON(), nullable=False),
        sa.Column("errors", sa.JSON(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_project_index_jobs_project", "project_index_jobs", ["project_id"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_project_index_jobs_project", table_name="project_index_jobs")
    op.drop_table("project_index_jobs")
    op.drop_index("ix_project_indexed_chunks_hash", table_name="project_indexed_chunks")
    op.drop_index("ix_project_indexed_chunks_project", table_name="project_indexed_chunks")
    op.drop_index("uq_project_indexed_chunks_file_index", table_name="project_indexed_chunks")
    op.drop_table("project_indexed_chunks")
    op.drop_index("ix_project_indexed_files_project_indexed", table_name="project_indexed_files")
    op.drop_index("uq_project_indexed_files_project_path", table_name="project_indexed_files")
    op.drop_table("project_indexed_files")
