from pathlib import Path

import pytest

import buildx_backend
from app.core.config import get_settings


def test_migrate_creates_schema_from_any_working_directory(monkeypatch, tmp_path: Path) -> None:
    database = tmp_path / "bundle.db"
    monkeypatch.setenv("BUILDX_DATABASE_URL", f"sqlite:///{database}")
    monkeypatch.chdir(tmp_path)
    get_settings.cache_clear()
    try:
        buildx_backend.main(["migrate"])
    finally:
        get_settings.cache_clear()
    import sqlite3

    with sqlite3.connect(database) as connection:
        revision = connection.execute("SELECT version_num FROM alembic_version").fetchone()[0]
    assert revision == "0007_app_settings"


def test_unknown_command_exits_with_usage() -> None:
    with pytest.raises(SystemExit, match="usage"):
        buildx_backend.main(["drop-everything"])
