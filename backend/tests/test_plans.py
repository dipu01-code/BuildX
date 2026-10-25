"""Project planner validation, provider isolation, and persistence coverage."""

from collections.abc import Generator
from pathlib import Path
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError
from sqlalchemy.orm import Session
from uuid import uuid4

from app.ai.contracts import AIErrorCategory, NormalizedAIResponse, ProviderError, StructuredGenerationRequest
from app.core.config import Settings
from app.db.base import Base
from app.db.models import Project
from app.db.session import create_database_engine, create_session_factory, get_db
from app.main import create_app
from app.schemas.plans import PlanContent, PlanCreate
from app.api.routes.plans import save_plan


def plan_payload() -> dict:
    return {
        "project_title": "Local Recipe Book",
        "problem_statement": "Home cooks need a searchable recipe collection.",
        "intended_users": ["Home cooks"],
        "main_objectives": ["Organize recipes"],
        "assumptions": ["Users can enter recipes manually"],
        "out_of_scope": ["Grocery delivery"],
        "requirements": [{
            "id": "req_catalog", "title": "Recipe catalog", "description": "Store recipes.",
            "priority": "must", "acceptance_criteria": ["A recipe can be saved"], "dependencies": [],
        }],
        "milestones": [{
            "id": "mile_foundation", "title": "Foundation", "goal": "Create the basic app.",
            "tasks": [{
                "id": "task_schema", "title": "Design recipe schema", "description": "Define recipe fields.",
                "rationale": "Storage needs a stable structure.", "priority": "must",
                "estimated_effort": "2 hours (rough estimate)", "dependencies": [],
                "acceptance_criteria": ["Schema supports recipe name and ingredients"],
                "suggested_milestone": "Foundation",
            }],
            "completion_criteria": ["Schema is reviewed"],
        }],
        "recommendations": {
            "recommended_stack": [{"technology": "SQLite", "reason": "Local-first storage."}],
            "architecture": "A local desktop application with a small persistence layer.",
            "risks": [{"risk": "Data loss", "mitigation": "Provide export and backup."}],
            "testing_strategy": ["Test data validation and search behavior."],
            "security_considerations": ["Keep recipe data on-device by default."],
        },
    }


class FakePlannerProvider:
    provider_id = "openai"
    model_id = "gpt-test"

    def __init__(self, response: str | None = None, error: AIErrorCategory | None = None) -> None:
        self.response = response if response is not None else json.dumps(plan_payload())
        self.error = error
        self.requests: list[StructuredGenerationRequest] = []

    async def test_connection(self, _request):
        raise AssertionError("Planner tests must not use the connection test method")

    async def generate_structured(self, request: StructuredGenerationRequest) -> NormalizedAIResponse:
        self.requests.append(request)
        if self.error:
            raise ProviderError(self.error)
        return NormalizedAIResponse(
            provider_id="openai", model_id="gpt-test", response_text=self.response, duration_ms=10
        )


@pytest.fixture
def planner_client(tmp_path: Path):
    engine = create_database_engine(Settings(data_dir=tmp_path))
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    provider = FakePlannerProvider()
    application = create_app(
        Settings(environment="test", data_dir=tmp_path, openai_api_key=SecretStr("sk-test"), _env_file=None),
        ai_provider=provider,
    )

    def override_get_db() -> Generator[Session, None, None]:
        with factory() as session:
            try:
                yield session
            except Exception:
                session.rollback()
                raise

    application.dependency_overrides[get_db] = override_get_db
    with TestClient(application) as client:
        project = client.post("/api/v1/projects", json={"name": "Planner fixture"}).json()
        yield client, provider, project, engine
    engine.dispose()


def test_generation_uses_provider_abstraction_and_returns_validated_draft(planner_client) -> None:
    client, provider, project, _engine = planner_client
    response = client.post(f"/api/v1/projects/{project['id']}/plans/generate", json={
        "project_brief": "Build a private recipe app.", "preferred_technology_stack": ["Python"],
        "experience_level": "beginner", "delivery_priorities": ["privacy"],
    })
    assert response.status_code == 200
    assert response.json()["project_title"] == "Local Recipe Book"
    assert "instruction" in provider.requests[0].model_dump()
    assert "private recipe app" in provider.requests[0].user_content
    assert "workspace" in provider.requests[0].instruction.casefold()
    assert client.get(f"/api/v1/projects/{project['id']}/plans").json() == []


def test_missing_provider_returns_actionable_sanitized_error(tmp_path: Path) -> None:
    engine = create_database_engine(Settings(data_dir=tmp_path))
    Base.metadata.create_all(engine)
    with create_session_factory(engine)() as db:
        project = Project(name="No provider")
        db.add(project); db.commit(); project_id = str(project.id)
    application = create_app(Settings(environment="test", data_dir=tmp_path, _env_file=None))

    def override_get_db():
        with create_session_factory(engine)() as session:
            yield session

    application.dependency_overrides[get_db] = override_get_db
    client = TestClient(application)
    response = client.post(f"/api/v1/projects/{project_id}/plans/generate", json={"project_brief": "Build a planner"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "AI_PROVIDER_UNCONFIGURED"
    assert "Configure the AI provider" in response.json()["error"]["message"]
    client.close()
    engine.dispose()


@pytest.mark.parametrize("category", list(AIErrorCategory))
def test_provider_failures_are_mapped_to_safe_planner_errors(planner_client, category: AIErrorCategory) -> None:
    client, provider, project, _engine = planner_client
    provider.error = category
    response = client.post(f"/api/v1/projects/{project['id']}/plans/generate", json={"project_brief": "Build a private recipe app."})
    assert response.status_code in {429, 502, 503, 504}
    assert "sk-test" not in response.text
    assert "ProviderError" not in response.text
    assert response.json()["error"]["code"].startswith("AI_")


def test_generation_rejects_missing_project_malformed_json_and_invalid_references(planner_client) -> None:
    client, provider, project, _engine = planner_client
    missing = client.post("/api/v1/projects/00000000-0000-0000-0000-000000000001/plans/generate", json={"project_brief": "Brief"})
    assert missing.status_code == 404
    provider.response = "not-json"
    malformed = client.post(f"/api/v1/projects/{project['id']}/plans/generate", json={"project_brief": "Brief"})
    assert malformed.status_code == 502
    assert malformed.json()["error"]["code"] == "AI_PLAN_INVALID"
    invalid = plan_payload()
    invalid["milestones"][0]["tasks"][0]["dependencies"] = ["task_missing"]
    provider.response = json.dumps(invalid)
    rejected = client.post(f"/api/v1/projects/{project['id']}/plans/generate", json={"project_brief": "Brief"})
    assert rejected.status_code == 502
    assert "task_missing" not in rejected.text


@pytest.mark.parametrize("mutator, message", [
    (lambda p: p["milestones"][0]["tasks"][0].update(dependencies=["task_missing"]), "must reference"),
    (lambda p: p["milestones"][0]["tasks"][0].update(dependencies=["task_schema"]), "itself"),
    (lambda p: p["requirements"][0].update(dependencies=["req_missing"]), "must reference"),
])
def test_plan_schema_rejects_invalid_dependency_references(mutator, message: str) -> None:
    payload = plan_payload()
    mutator(payload)
    with pytest.raises(ValidationError, match=message):
        PlanContent.model_validate(payload)


def test_plan_schema_rejects_cycles_and_list_limits() -> None:
    payload = plan_payload()
    task = payload["milestones"][0]["tasks"][0]
    other = {**task, "id": "task_other", "dependencies": ["task_schema"]}
    task["dependencies"] = ["task_other"]
    payload["milestones"][0]["tasks"].append(other)
    with pytest.raises(ValidationError, match="cycle"):
        PlanContent.model_validate(payload)
    oversized = plan_payload()
    oversized["requirements"] = [{**oversized["requirements"][0], "id": f"req_{index}"} for index in range(51)]
    with pytest.raises(ValidationError):
        PlanContent.model_validate(oversized)
    oversized_text = plan_payload()
    oversized_text["main_objectives"] = ["x" * 501]
    with pytest.raises(ValidationError):
        PlanContent.model_validate(oversized_text)


def test_saved_plans_can_be_reopened_updated_and_deleted(planner_client, tmp_path: Path) -> None:
    client, _provider, project, _engine = planner_client
    created = client.post(f"/api/v1/projects/{project['id']}/plans", json={"plan": plan_payload()})
    assert created.status_code == 201
    plan_id = created.json()["id"]
    assert client.get(f"/api/v1/projects/{project['id']}/plans").json()[0]["id"] == plan_id
    assert client.get(f"/api/v1/projects/{project['id']}/plans/{plan_id}").json()["plan"]["project_title"] == "Local Recipe Book"
    updated = client.patch(f"/api/v1/projects/{project['id']}/plans/{plan_id}", json={"project_title": "Recipe Library"})
    assert updated.status_code == 200
    assert updated.json()["plan"]["project_title"] == "Recipe Library"
    assert updated.json()["plan"]["problem_statement"] == plan_payload()["problem_statement"]
    assert updated.json()["updated_at"] >= created.json()["updated_at"]
    assert client.get(f"/api/v1/projects/{project['id']}/plans/{plan_id}").json()["plan"]["project_title"] == "Recipe Library"
    assert client.delete(f"/api/v1/projects/{project['id']}/plans/{plan_id}").status_code == 204
    assert client.get(f"/api/v1/projects/{project['id']}/plans").json() == []


def test_plan_project_ownership_and_project_cascade(planner_client) -> None:
    client, _provider, project, _engine = planner_client
    other_project = client.post("/api/v1/projects", json={"name": "Other"}).json()
    saved = client.post(f"/api/v1/projects/{project['id']}/plans", json={"plan": plan_payload()}).json()
    assert client.get(f"/api/v1/projects/{other_project['id']}/plans/{saved['id']}").status_code == 404
    assert client.patch(f"/api/v1/projects/{project['id']}/plans/{saved['id']}", json={"requirements": []}).status_code == 422
    assert client.delete(f"/api/v1/projects/{project['id']}").status_code == 204
    assert client.get(f"/api/v1/projects/{project['id']}/plans/{saved['id']}").status_code == 404


def test_failed_plan_commit_rolls_back_without_partial_record() -> None:
    class FailingSession:
        added = None
        rolled_back = False

        def get(self, _model, _project_id):
            return Project(id=uuid4(), name="Transaction test")

        def add(self, record):
            self.added = record

        def commit(self):
            raise RuntimeError("simulated commit failure")

        def rollback(self):
            self.rolled_back = True

    session = FailingSession()
    project_id = uuid4()
    with pytest.raises(RuntimeError, match="simulated commit failure"):
        save_plan(project_id, PlanCreate(plan=PlanContent.model_validate(plan_payload())), SimpleNamespace(headers={}), session)
    assert session.added is not None
    assert session.rolled_back


def test_plan_delete_does_not_touch_project_directory(planner_client, tmp_path: Path) -> None:
    client, _provider, project, _engine = planner_client
    directory = tmp_path / "project-files"
    directory.mkdir()
    (directory / "notes.txt").write_text("keep this file", encoding="utf-8")
    client.patch(f"/api/v1/projects/{project['id']}", json={"root_path": str(directory)})
    saved = client.post(f"/api/v1/projects/{project['id']}/plans", json={"plan": plan_payload()}).json()
    assert client.delete(f"/api/v1/projects/{project['id']}/plans/{saved['id']}").status_code == 204
    assert (directory / "notes.txt").read_text(encoding="utf-8") == "keep this file"
