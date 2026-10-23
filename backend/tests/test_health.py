"""Health route, routing, and OpenAPI coverage."""

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def test_health_reports_only_api_process_status() -> None:
    client = TestClient(create_app(Settings(environment="test")))

    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "BUILDX API", "version": "0.1.0"}


def test_health_route_is_versioned() -> None:
    client = TestClient(create_app(Settings(environment="test")))

    assert client.get("/health").status_code == 404
    assert client.get("/api/v1/health").status_code == 200


def test_openapi_contains_health_schema_and_documentation() -> None:
    application = create_app(Settings(environment="test"))
    client = TestClient(application)

    assert client.get("/docs").status_code == 200
    schema = client.get("/openapi.json").json()
    assert "/api/v1/health" in schema["paths"]
    assert schema["paths"]["/api/v1/health"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]["$ref"] == "#/components/schemas/HealthResponse"


def test_production_hides_interactive_docs_but_keeps_openapi_disabled() -> None:
    application = create_app(Settings(environment="production"))

    assert application.docs_url is None
    assert application.redoc_url is None
    assert application.openapi_url is None
