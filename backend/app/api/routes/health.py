"""Process health endpoint."""

from fastapi import APIRouter, Request

from app.schemas.health import HealthResponse

router = APIRouter(tags=["health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Check backend process health",
    description=(
        "Confirms the BUILDX API process is serving requests. It does not check "
        "database, AI-provider, or other integrations."
    ),
)
def health(request: Request) -> HealthResponse:
    """Return process identity and status without implying dependency health."""

    settings = request.app.state.settings
    return HealthResponse(status="ok", service=settings.app_name, version=settings.app_version)
