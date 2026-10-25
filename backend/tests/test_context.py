"""Local project context indexing, cleanup, and retrieval behavior."""

from collections.abc import Generator
from pathlib import Path
import hashlib

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.context.indexing import chunk_text, query_terms
from app.api.routes import context as context_routes
from app.core.config import Settings
from app.db.base import Base
from app.db.models import Project
from app.db.session import create_database_engine, create_session_factory, get_db
from app.main import create_app


@pytest.fixture
def context_client(tmp_path: Path):
    engine = create_database_engine(Settings(data_dir=tmp_path))
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    application = create_app(Settings(environment="test", data_dir=tmp_path, _env_file=None))

    def override_get_db() -> Generator[Session, None, None]:
        with factory() as session:
            try:
                yield session
            except Exception:
                session.rollback()
                raise

    application.dependency_overrides[get_db] = override_get_db
    with TestClient(application) as client:
        project = client.post("/api/v1/projects", json={"name": "Context fixture"}).json()
        yield client, project
    engine.dispose()


def make_file(path: str, content: str, modified_at_ms: int = 1000, *, include_content: bool = True) -> dict:
    encoded = content.encode("utf-8")
    result = {
        "relative_path": path,
        "content_hash": hashlib.sha256(encoded).hexdigest(),
        "file_size": len(encoded),
        "modified_at_ms": modified_at_ms,
    }
    if include_content:
        result["content"] = content
    return result


def base_url(project: dict) -> str:
    return f"/api/v1/projects/{project['id']}/context"


def start(client: TestClient, project: dict) -> None:
    response = client.post(f"{base_url(project)}/index/refresh", json={})
    assert response.status_code == 202


def upload(client: TestClient, project: dict, files: list[dict]) -> dict:
    response = client.put(f"{base_url(project)}/index/files", json={"files": files})
    assert response.status_code == 200, response.text
    return response.json()


def complete(
    client: TestClient, project: dict, eligible: list[str], *, failed: list[str] | None = None,
    errors: list[dict[str, str]] | None = None, incomplete: bool = False,
) -> dict:
    response = client.post(f"{base_url(project)}/index/complete", json={
        "eligible_paths": eligible, "failed_paths": failed or [], "incomplete": incomplete,
        "discovered_count": len(eligible), "processed_count": len(eligible), "skipped_count": 0,
        "skip_reasons": {}, "errors": errors or [],
    })
    assert response.status_code == 200, response.text
    return response.json()


def test_chunking_is_stable_bounded_and_tracks_line_ranges() -> None:
    assert chunk_text("") == []
    one_line = chunk_text("last line without newline")
    assert one_line == chunk_text("last line without newline")
    assert one_line[0]["start_line"] == one_line[0]["end_line"] == 1

    content = "\r\n".join(f"line {line} has stable source metadata" for line in range(1, 30))
    chunks = chunk_text(content, chunk_size=128, overlap=24)
    assert len(chunks) > 1
    assert all(0 < len(chunk["content"]) <= 128 for chunk in chunks)
    assert all(1 <= chunk["start_line"] <= chunk["end_line"] <= 29 for chunk in chunks)
    assert chunks == chunk_text(content, chunk_size=128, overlap=24)


def test_query_validation_and_scoring_prefer_relevant_terms() -> None:
    terms = query_terms("  sqlite context indexing  ")
    assert terms == ["sqlite", "context", "indexing"]
    with pytest.raises(ValueError, match="searchable word"):
        query_terms("the and")
    with pytest.raises(ValueError, match="too long"):
        query_terms("x" * 301)


def test_refresh_persists_chunks_and_returns_ranked_source_results(context_client) -> None:
    client, project = context_client
    start(client, project)
    content = "SQLite context indexing keeps project files on this device.\n" * 80
    upload(client, project, [make_file("docs/context.md", content)])
    final = complete(client, project, ["docs/context.md"])
    assert final["state"] == "up_to_date"
    assert final["indexed_file_count"] == 1
    assert final["chunk_count"] > 1

    files = client.get(f"{base_url(project)}/files").json()
    assert files["total"] == 1
    assert files["files"][0]["relative_path"] == "docs/context.md"
    chunks = client.get(f"{base_url(project)}/files/chunks", params={"relative_path": "docs/context.md"})
    assert chunks.status_code == 200
    assert chunks.json()[0]["start_line"] == 1
    assert len(chunks.json()[0]["content"]) <= 1400

    results = client.get(f"{base_url(project)}/search", params={"q": "SQLite project context", "limit": 2})
    assert results.status_code == 200
    assert results.json()["total"] == 2
    assert all(item["relative_path"] == "docs/context.md" for item in results.json()["results"])
    assert all(item["start_line"] <= item["end_line"] for item in results.json()["results"])
    assert all(len(item["excerpt"]) <= 602 for item in results.json()["results"])


def test_unchanged_files_skip_content_and_changed_file_replaces_chunks(context_client) -> None:
    client, project = context_client
    start(client, project)
    original = make_file("src/app.py", "def old_search():\n    return 'old token'\n")
    upload(client, project, [original])
    complete(client, project, ["src/app.py"])
    original_chunks = client.get(f"{base_url(project)}/files/chunks", params={"relative_path": "src/app.py"}).json()
    chunk_ids = [chunk["id"] for chunk in original_chunks]

    start(client, project)
    unchanged = make_file("src/app.py", original["content"], 2000, include_content=False)
    upload(client, project, [unchanged])
    complete(client, project, ["src/app.py"])
    unchanged_chunks = client.get(f"{base_url(project)}/files/chunks", params={"relative_path": "src/app.py"}).json()
    assert [chunk["id"] for chunk in unchanged_chunks] == chunk_ids
    assert client.get(f"{base_url(project)}/search", params={"q": "old token"}).json()["total"] > 0

    start(client, project)
    changed = make_file("src/app.py", "def fresh_search():\n    return 'new token'\n")
    upload(client, project, [changed])
    complete(client, project, ["src/app.py"])
    assert client.get(f"{base_url(project)}/search", params={"q": "old token"}).json()["total"] == 0
    assert client.get(f"{base_url(project)}/search", params={"q": "new token"}).json()["total"] == 1


def test_complete_removes_deleted_files_but_retains_temporarily_unreadable_paths(context_client) -> None:
    client, project = context_client
    start(client, project)
    upload(client, project, [make_file("keep.md", "Searchable project notes."), make_file("gone.md", "Removed from disk.")])
    complete(client, project, ["keep.md", "gone.md"])

    start(client, project)
    retained = complete(client, project, ["keep.md"], failed=["gone.md"], errors=[{"path": "gone.md", "message": "Permission denied."}])
    assert retained["state"] == "partial"
    assert [item["relative_path"] for item in client.get(f"{base_url(project)}/files").json()["files"]] == ["gone.md", "keep.md"]

    start(client, project)
    cleaned = complete(client, project, ["keep.md"])
    assert cleaned["indexed_file_count"] == 1
    assert [item["relative_path"] for item in client.get(f"{base_url(project)}/files").json()["files"]] == ["keep.md"]


def test_incomplete_scan_preserves_unseen_records_and_project_delete_cascades(context_client) -> None:
    client, project = context_client
    start(client, project)
    upload(client, project, [make_file("one.md", "A useful searchable passage."), make_file("two.md", "Another searchable passage.")])
    complete(client, project, ["one.md", "two.md"])
    start(client, project)
    result = complete(client, project, ["one.md"], incomplete=True)
    assert result["state"] == "partial"
    assert result["indexed_file_count"] == 2

    assert client.delete(f"/api/v1/projects/{project['id']}").status_code == 204
    assert client.get(f"{base_url(project)}/status").status_code == 404


def test_complete_enforces_total_index_limit_without_committing_cleanup(context_client, monkeypatch) -> None:
    client, project = context_client
    monkeypatch.setattr(context_routes, "MAX_PROJECT_BYTES", 10)
    monkeypatch.setattr(context_routes, "MAX_STAGED_BYTES", 20)
    start(client, project)
    upload(client, project, [make_file("a.txt", "123456"), make_file("b.txt", "abcdef")])
    response = client.post(f"{base_url(project)}/index/complete", json={
        "eligible_paths": ["a.txt", "b.txt"], "failed_paths": [], "incomplete": False,
        "discovered_count": 2, "processed_count": 2, "skipped_count": 0,
        "skip_reasons": {}, "errors": [],
    })
    assert response.status_code == 413
    assert client.get(f"{base_url(project)}/status").json()["state"] == "indexing"
    assert client.get(f"{base_url(project)}/files").json()["total"] == 2


def test_context_api_rejects_traversal_invalid_queries_and_unknown_projects(context_client) -> None:
    client, project = context_client
    start(client, project)
    invalid = client.put(f"{base_url(project)}/index/files", json={
        "files": [make_file("../secrets.txt", "secret value")],
    })
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "VALIDATION_ERROR"

    empty = client.get(f"{base_url(project)}/search", params={"q": "the and"})
    assert empty.status_code == 422
    assert empty.json()["error"]["code"] == "HTTP_422"
    assert client.get(f"{base_url(project)}/search", params={"q": "word", "limit": 21}).status_code == 422
    assert client.get("/api/v1/projects/00000000-0000-0000-0000-000000000001/context/status").status_code == 404
    assert client.post(f"{base_url(project)}/index/refresh", json={}).status_code == 409
    unsafe_error = client.patch(f"{base_url(project)}/index/progress", json={
        "discovered_count": 0, "processed_count": 0, "skipped_count": 0,
        "skip_reasons": {}, "errors": [{"path": "", "message": "Read failed at /Users/dipu/project/file.txt"}],
    })
    assert unsafe_error.status_code == 422


def test_hash_validation_binary_input_and_file_chunks_cannot_read_arbitrary_paths(context_client) -> None:
    client, project = context_client
    start(client, project)
    item = make_file("src/a.txt", "normal words")
    item["content_hash"] = "0" * 64
    assert client.put(f"{base_url(project)}/index/files", json={"files": [item]}).status_code == 422

    binary = make_file("src/b.txt", "\x00bytes")
    assert client.put(f"{base_url(project)}/index/files", json={"files": [binary]}).status_code == 422
    traversal = client.get(f"{base_url(project)}/files/chunks", params={"relative_path": "../../etc/passwd"})
    assert traversal.status_code == 422


@pytest.mark.parametrize("path", [".git/config", "src/.env.local", "node_modules/pkg/index.js", "secrets/token.txt", "keys/deploy.pem"])
def test_context_api_rejects_sensitive_and_generated_paths(context_client, path) -> None:
    client, project = context_client
    start(client, project)
    response = client.put(f"{base_url(project)}/index/files", json={"files": [make_file(path, "ordinary text")]})
    assert response.status_code == 422


def test_context_api_rejects_credential_like_content(context_client) -> None:
    client, project = context_client
    start(client, project)
    response = client.put(f"{base_url(project)}/index/files", json={
        "files": [make_file("src/config.py", "api_key = 'abcd1234efgh5678'")],
    })
    assert response.status_code == 422
