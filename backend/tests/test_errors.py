"""Consistent, non-sensitive API error response coverage."""

from fastapi import HTTPException, Query
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def test_unknown_route_returns_error_envelope() -> None:
    client = TestClient(create_app(Settings(environment="test")))

    response = client.get("/api/v1/not-a-route")

    assert response.status_code == 404
    assert response.json() == {
        "error": {"code": "HTTP_404", "message": "Not Found", "details": []}
    }


def test_unexpected_error_does_not_expose_exception_details(caplog) -> None:
    application = create_app(Settings(environment="test"))

    @application.get("/explode")
    def explode() -> None:
        raise RuntimeError("sensitive /Users/example/.env path")

    client = TestClient(application, raise_server_exceptions=False)
    response = client.get("/explode")

    assert response.status_code == 500
    assert response.json() == {
        "error": {
            "code": "INTERNAL_SERVER_ERROR",
            "message": "An unexpected error occurred",
            "details": [],
        }
    }
    assert "/Users/example" not in response.text
    assert "/Users/example" not in caplog.text


def test_http_exception_detail_is_not_reflected_to_client() -> None:
    application = create_app(Settings(environment="test"))

    @application.get("/private-error")
    def private_error() -> None:
        raise HTTPException(status_code=400, detail="token=do-not-disclose")

    response = TestClient(application).get("/private-error")

    assert response.status_code == 400
    assert "do-not-disclose" not in response.text


def test_validation_error_omits_rejected_input() -> None:
    application = create_app(Settings(environment="test"))

    @application.get("/validated")
    def validated(limit: int = Query(gt=0)) -> dict[str, int]:
        return {"limit": limit}

    response = TestClient(application).get("/validated?limit=private-token")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert response.json()["error"]["details"][0]["location"] == ["query", "limit"]
    assert "private-token" not in response.text
