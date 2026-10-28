"""Proposal schema, AI validation, and explicit lifecycle coverage."""

from collections.abc import Generator
from pathlib import Path
import hashlib
import json

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError
from sqlalchemy.orm import Session

from app.ai.contracts import NormalizedAIResponse, StructuredGenerationRequest
from app.core.config import Settings
from app.db.base import Base
from app.db.session import create_database_engine, create_session_factory, get_db
from app.main import create_app
from app.schemas.change_proposals import GenerateProposalRequest, ProposedOperation


class FakeProposalProvider:
    provider_id = "openai"
    model_id = "test-model"

    def __init__(self):
        self.requests: list[StructuredGenerationRequest] = []
        self.response = json.dumps({"operation": "modify", "explanation": "Update the greeting", "relative_path": "src/app.py", "original_hash": None, "proposed_content": "print('new')\n"})

    async def generate_structured(self, request):
        self.requests.append(request)
        return NormalizedAIResponse(provider_id=self.provider_id, model_id=self.model_id, response_text=self.response, duration_ms=1)

    async def test_connection(self, _request):
        raise AssertionError


@pytest.fixture
def proposal_client(tmp_path: Path):
    engine = create_database_engine(Settings(data_dir=tmp_path))
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    provider = FakeProposalProvider()
    app = create_app(Settings(environment="test", data_dir=tmp_path, openai_api_key=SecretStr("sk-test"), _env_file=None), ai_provider=provider)

    def override() -> Generator[Session, None, None]:
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override
    with TestClient(app) as client:
        project = client.post("/api/v1/projects", json={"name": "Proposal project"}).json()
        yield client, provider, project
    engine.dispose()


def test_schema_rejects_traversal_sensitive_paths_and_wrong_hashes():
    with pytest.raises(ValidationError):
        GenerateProposalRequest(request="change", relative_path="../secret", original_content=None, original_hash=None)
    with pytest.raises(ValidationError):
        GenerateProposalRequest(request="change", relative_path=".env", original_content=None, original_hash=None)
    with pytest.raises(ValidationError):
        GenerateProposalRequest(request="change", relative_path="src/app.py", original_content="old", original_hash="0" * 64)


def test_generation_persists_immutable_one_file_proposal_and_context(proposal_client):
    client, provider, project = proposal_client
    body = {"request": "change greeting", "relative_path": "src/app.py", "original_content": "print('old')\n", "original_hash": hashlib.sha256(b"print('old')\n").hexdigest()}
    provider.response = json.dumps({"operation": "modify", "explanation": "Update the greeting", "relative_path": body["relative_path"], "original_hash": body["original_hash"], "proposed_content": "print('new')\n"})
    response = client.post(f"/api/v1/projects/{project['id']}/change-proposals", json=body)
    assert response.status_code == 201, response.text
    proposal = response.json()
    assert proposal["status"] == "pending_review"
    assert proposal["operation"]["original_content"] == body["original_content"]
    assert "untrusted data" in provider.requests[0].instruction
    assert client.get(f"/api/v1/projects/{project['id']}/change-proposals").json()["proposals"][0]["id"] == proposal["id"]
    approve = client.post(f"/api/v1/change-proposals/{proposal['id']}/approve")
    assert approve.status_code == 200 and approve.json()["status"] == "approved"
    assert client.post(f"/api/v1/change-proposals/{proposal['id']}/approve").status_code == 409
    applied = client.post(f"/api/v1/change-proposals/{proposal['id']}/apply", json={"status": "applied", "result_hash": hashlib.sha256(b"print('new')\n").hexdigest()})
    assert applied.status_code == 200 and applied.json()["status"] == "applied"
    assert client.post(f"/api/v1/change-proposals/{proposal['id']}/apply", json={"status": "applied"}).status_code == 409


def test_rejects_ai_output_that_changes_target_or_operation(proposal_client):
    client, provider, project = proposal_client
    provider.response = json.dumps({"operation": "modify", "explanation": "change it", "relative_path": "elsewhere.py", "original_hash": None, "proposed_content": "bad"})
    response = client.post(f"/api/v1/projects/{project['id']}/change-proposals", json={"request": "change", "relative_path": "src/app.py", "original_content": None, "original_hash": None})
    assert response.status_code == 502
    assert client.get(f"/api/v1/projects/{project['id']}/change-proposals").json()["proposals"] == []
