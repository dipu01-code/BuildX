"""Persistent project API coverage using isolated SQLite databases."""

from collections.abc import Generator
from pathlib import Path
import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.base import Base
from app.db.models import Project  # noqa: F401 -- register model metadata
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


def test_project_crud_persists_metadata_without_touching_root_path(
    client: TestClient, tmp_path: Path
) -> None:
    root_path = tmp_path / "directory-that-does-not-exist"
    created = client.post(
        "/api/v1/projects",
        json={"name": "  Atlas  ", "description": "Product design", "root_path": str(root_path)},
    )
    assert created.status_code == 201
    project = created.json()
    assert project["name"] == "Atlas"
    assert project["description"] == "Product design"
    assert project["root_path"] == str(root_path)
    assert project["project_type"] is None
    assert project["created_at"].endswith("Z") or project["created_at"].endswith("+00:00")
    assert not root_path.exists()

    assert client.get("/api/v1/projects").json() == [project]
    assert client.get(f"/api/v1/projects/{project['id']}").json() == project

    time.sleep(0.002)
    updated = client.patch(
        f"/api/v1/projects/{project['id']}", json={"description": "Research", "root_path": None}
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Atlas"
    assert updated.json()["description"] == "Research"
    assert updated.json()["root_path"] is None
    assert updated.json()["updated_at"] > project["updated_at"]

    assert client.delete(f"/api/v1/projects/{project['id']}").status_code == 204
    assert client.get("/api/v1/projects").json() == []
    assert not root_path.exists()


def test_projects_have_deterministic_order_and_allow_duplicate_names(client: TestClient) -> None:
    first = client.post("/api/v1/projects", json={"name": "Same name"}).json()
    time.sleep(0.002)
    second = client.post("/api/v1/projects", json={"name": "Same name"}).json()
    listed = client.get("/api/v1/projects").json()
    assert [project["id"] for project in listed] == [second["id"], first["id"]]


@pytest.mark.parametrize("payload", [{}, {"name": "   "}, {"name": None}])
def test_invalid_project_updates_use_error_envelope(
    client: TestClient, payload: dict[str, object]
) -> None:
    project = client.post("/api/v1/projects", json={"name": "Atlas"}).json()
    response = client.patch(f"/api/v1/projects/{project['id']}", json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_unknown_and_malformed_project_ids_are_rejected(client: TestClient) -> None:
    assert client.get("/api/v1/projects/00000000-0000-0000-0000-000000000000").status_code == 404
    malformed = client.get("/api/v1/projects/not-a-uuid")
    assert malformed.status_code == 422
    assert malformed.json()["error"]["code"] == "VALIDATION_ERROR"
