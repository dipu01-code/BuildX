"""Settings API coverage using isolated SQLite databases."""

from collections.abc import Generator
from pathlib import Path
import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.base import Base
from app.db.models import AppSetting  # noqa: F401 -- register model metadata
from app.db.session import create_database_engine, create_session_factory, get_db
from app.main import create_app


@pytest.fixture
def client(tmp_path: Path) -> Generator[TestClient, None, None]:
    engine = create_database_engine(Settings(data_dir=tmp_path))
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    application = create_app(Settings(environment="test", data_dir=tmp_path))

    def override_get_db() -> Generator[Session, None, None]:
        with factory() as session:
            try:
                yield session
            except Exception:
                session.rollback()
                raise

    application.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(application) as test_client:
            yield test_client
    finally:
        engine.dispose()


def test_settings_retrieve_defaults_when_nothing_stored(client: TestClient) -> None:
    response = client.get("/api/v1/settings")
    assert response.status_code == 200
    body = response.json()
    assert body["version"] == 1
    assert body["general"]["startup_behavior"] == "show_home"
    assert body["general"]["confirm_destructive_actions"] is True
    assert body["appearance"]["theme"] == "system"
    assert body["editor"]["font_size"] == 12
    assert body["editor"]["auto_save"] is False
    assert body["ai_provider"]["provider"] == "openai"
    assert body["terminal"]["output_retention_limit"] == 20
    assert body["project_context"]["indexing_enabled"] is True
    assert body["privacy"]["telemetry_enabled"] is False
    # No secret keys are ever returned.
    assert "openai_api_key" not in body
    assert "credential" not in str(body).lower()


def test_settings_partial_update_preserves_unrelated_sections(client: TestClient) -> None:
    first = client.get("/api/v1/settings").json()
    assert first["editor"]["font_size"] == 12
    assert first["appearance"]["theme"] == "system"

    updated = client.patch(
        "/api/v1/settings",
        json={"editor": {"font_size": 14, "auto_save": True}},
    )
    assert updated.status_code == 200
    body = updated.json()
    assert body["editor"]["font_size"] == 14
    assert body["editor"]["auto_save"] is True
    # Unrelated sections preserved.
    assert body["appearance"]["theme"] == "system"
    assert body["general"]["startup_behavior"] == "show_home"
    assert body["version"] == 1


def test_settings_persist_across_restart(tmp_path: Path) -> None:
    first = create_app(Settings(environment="test", data_dir=tmp_path))
    engine = create_database_engine(Settings(data_dir=tmp_path))
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    first.dependency_overrides[get_db] = lambda: (yield from _sessions(factory))

    with TestClient(first) as client:
        client.patch(
            "/api/v1/settings",
            json={"appearance": {"theme": "dark", "ui_density": "compact"}},
        )

    # New app instance over the same data directory reads the stored settings.
    second = create_app(Settings(environment="test", data_dir=tmp_path))
    second.dependency_overrides[get_db] = lambda: (yield from _sessions(factory))
    with TestClient(second) as client:
        body = client.get("/api/v1/settings").json()
        assert body["appearance"]["theme"] == "dark"
        assert body["appearance"]["ui_density"] == "compact"
        # Unrelated sections still defaulted.
        assert body["editor"]["font_size"] == 12

    engine.dispose()


def _sessions(factory):
    from sqlalchemy.orm import Session

    session = factory()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@pytest.mark.parametrize(
    "patch",
    [
        {"editor": {"font_size": 0}},
        {"editor": {"font_size": 200}},
        {"terminal": {"output_retention_limit": 0}},
        {"terminal": {"timeout_ms": 500}},
        {"ai_provider": {"model": "../secret"}},
        {"appearance": {"theme": "neon"}},
    ],
)
def test_settings_reject_invalid_section_values(client: TestClient, patch: dict) -> None:
    response = client.patch("/api/v1/settings", json=patch)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_settings_patch_requires_at_least_one_section(client: TestClient) -> None:
    response = client.patch("/api/v1/settings", json={})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "NO_SETTINGS_PROVIDED"


def test_settings_reset_returns_defaults(client: TestClient) -> None:
    client.patch("/api/v1/settings", json={"editor": {"font_size": 42}})
    assert client.get("/api/v1/settings").json()["editor"]["font_size"] == 42

    reset = client.post("/api/v1/settings/reset")
    assert reset.status_code == 200
    body = reset.json()
    assert body["version"] == 1

    restored = client.get("/api/v1/settings").json()
    assert restored["editor"]["font_size"] == 12
    assert restored["appearance"]["theme"] == "system"


def test_health_dashboard_reports_components(client: TestClient) -> None:
    response = client.get("/api/v1/settings/health")
    assert response.status_code == 200
    body = response.json()
    assert body["overall"] in (
        "healthy",
        "degraded",
        "unavailable",
        "not_configured",
        "unknown",
    )
    names = {component["name"] for component in body["components"]}
    expected = {
        "backend",
        "database",
        "migrations",
        "ai_provider",
        "project_indexing",
        "terminal",
        "git",
        "electron",
    }
    assert expected.issubset(names), f"missing components: {expected - names}"
    for component in body["components"]:
        assert component["status"] in (
            "healthy",
            "degraded",
            "unavailable",
            "not_configured",
            "unknown",
        )
        assert isinstance(component["message"], str)
        assert isinstance(component["retry_available"], bool)
    assert "checked_at" in body
