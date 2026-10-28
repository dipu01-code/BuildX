from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core.config import Settings, get_settings
from app.db.base import Base
from app.db.models import Project
from app.db.session import create_database_engine, create_session_factory, get_db


def test_engine_and_session_factory_execute_queries(tmp_path: Path) -> None:
    engine = create_database_engine(Settings(data_dir=tmp_path))
    factory = create_session_factory(engine)
    with factory() as session:
        assert session.scalar(text("SELECT 42")) == 42
    engine.dispose()


def test_sqlite_foreign_keys_are_enforced(tmp_path: Path) -> None:
    engine = create_database_engine(Settings(data_dir=tmp_path))
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE parent (id INTEGER PRIMARY KEY)")
        connection.exec_driver_sql("CREATE TABLE child (parent_id INTEGER REFERENCES parent(id))")
        with pytest.raises(IntegrityError):
            connection.exec_driver_sql("INSERT INTO child (parent_id) VALUES (999)")
    engine.dispose()


def test_request_dependency_rolls_back_and_closes_session(monkeypatch, tmp_path: Path) -> None:
    engine = create_database_engine(Settings(data_dir=tmp_path))
    factory = create_session_factory(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE sample (value INTEGER)")
    monkeypatch.setattr("app.db.session.SessionLocal", factory)
    dependency = get_db()
    failing_session = next(dependency)
    failing_session.execute(text("INSERT INTO sample VALUES (2)"))
    with pytest.raises(RuntimeError):
        dependency.throw(RuntimeError("request failed"))
    with factory() as verification:
        assert verification.scalar(text("SELECT COUNT(*) FROM sample")) == 0
    engine.dispose()


def test_each_engine_uses_an_isolated_database(tmp_path: Path) -> None:
    first = create_database_engine(Settings(database_url=f"sqlite:///{tmp_path / 'first.db'}"))
    second = create_database_engine(Settings(database_url=f"sqlite:///{tmp_path / 'second.db'}"))
    with first.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE marker (value INTEGER)")
    with second.connect() as connection:
        assert connection.exec_driver_sql("SELECT name FROM sqlite_master WHERE name='marker'").first() is None
    first.dispose()
    second.dispose()


def test_migrations_upgrade_fresh_database_twice(monkeypatch, tmp_path: Path) -> None:
    database = tmp_path / "migration-test.db"
    monkeypatch.setenv("BUILDX_DATABASE_URL", f"sqlite:///{database}")
    get_settings.cache_clear()
    try:
        config = Config("alembic.ini")
        command.upgrade(config, "head")
        command.upgrade(config, "head")
        engine = create_database_engine(Settings(database_url=f"sqlite:///{database}"))
        with engine.connect() as connection:
            revision = connection.exec_driver_sql("SELECT version_num FROM alembic_version").scalar_one()
            tables = connection.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            ).scalars().all()
        assert revision == "0006_change_proposals"
        assert set(tables) == {
            "alembic_version", "projects", "project_plans", "project_indexed_files", "change_proposals",
            "project_indexed_chunks", "project_index_jobs", "project_conversations",
            "project_conversation_messages",
        }
        engine.dispose()
    finally:
        get_settings.cache_clear()


def test_model_metadata_registers_project_tables() -> None:
    assert set(Base.metadata.tables) == {
        "projects", "project_plans", "project_indexed_files", "project_indexed_chunks", "project_index_jobs",
        "project_conversations", "project_conversation_messages", "change_proposals",
    }


def test_phase_eleven_migration_preserves_context_and_adds_conversations(monkeypatch, tmp_path: Path) -> None:
    database = tmp_path / "phase-eleven-migration.db"
    monkeypatch.setenv("BUILDX_DATABASE_URL", f"sqlite:///{database}")
    get_settings.cache_clear()
    try:
        config = Config("alembic.ini")
        command.upgrade(config, "0004_project_context")
        engine = create_database_engine(Settings(database_url=f"sqlite:///{database}"))
        factory = create_session_factory(engine)
        with factory.begin() as session:
            project = Project(name="Existing indexed project")
            session.add(project)
            session.flush()
            from app.db.models import ProjectIndexJob
            session.add(ProjectIndexJob(project_id=project.id, state="up_to_date", discovered_count=0, processed_count=0, skipped_count=0, skip_reasons={}, errors=[]))
            project_id = project.id
        engine.dispose()
        command.upgrade(config, "head")
        upgraded_engine = create_database_engine(Settings(database_url=f"sqlite:///{database}"))
        upgraded_factory = create_session_factory(upgraded_engine)
        with upgraded_factory() as session:
            assert session.get(Project, project_id).name == "Existing indexed project"
            assert session.scalar(text("SELECT COUNT(*) FROM project_index_jobs")) == 1
            assert session.scalar(text("SELECT COUNT(*) FROM project_conversations")) == 0
            revision = session.scalar(text("SELECT version_num FROM alembic_version"))
        assert revision == "0006_change_proposals"
        upgraded_engine.dispose()
    finally:
        get_settings.cache_clear()


def test_phase_ten_migration_preserves_existing_project_rows(monkeypatch, tmp_path: Path) -> None:
    database = tmp_path / "forward-migration.db"
    monkeypatch.setenv("BUILDX_DATABASE_URL", f"sqlite:///{database}")
    get_settings.cache_clear()
    try:
        config = Config("alembic.ini")
        command.upgrade(config, "0003_project_plans")
        engine = create_database_engine(Settings(database_url=f"sqlite:///{database}"))
        factory = create_session_factory(engine)
        project = Project(name="Existing project")
        with factory.begin() as session:
            session.add(project)
        project_id = project.id
        engine.dispose()

        command.upgrade(config, "head")
        engine = create_database_engine(Settings(database_url=f"sqlite:///{database}"))
        with create_session_factory(engine)() as session:
            persisted = session.get(Project, project_id)
            assert persisted is not None
            assert persisted.name == "Existing project"
        engine.dispose()
    finally:
        get_settings.cache_clear()


def test_invalid_database_scheme_is_rejected() -> None:
    with pytest.raises(ValueError, match="Only SQLite"):
        create_database_engine(Settings(database_url="postgresql://user:secret@localhost/db"))
