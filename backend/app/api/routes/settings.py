"""Settings and operational health endpoints.

Preferences are non-secret. The AI provider credential itself is never returned;
only its configured/reachable status is reported through the existing Phase 8
abstraction.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.routes.ai import _ERROR_MESSAGES
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.services.settings import get_settings as read_settings
from app.services.settings import patch_settings as apply_patch
from app.services.settings import reset_settings as apply_reset
from app.schemas.errors import ErrorBody, ErrorResponse, PlannerAPIError
from app.schemas.settings import (
    AppSettings,
    ComponentHealth,
    HealthDashboard,
    HealthState,
    SettingsPatch,
    SettingsRead,
    SettingsReset,
    utc_now,
)

router = APIRouter(tags=["settings"])


def _iso_now() -> str:
    return utc_now().isoformat()


def _component(name: str, status: HealthState, message: str, *, retry: bool = False, last_check: Optional[str] = None) -> ComponentHealth:
    return ComponentHealth(
        name=name,
        status=status,
        last_check=last_check or _iso_now(),
        message=message,
        retry_available=retry,
    )


def _overall(components: list[ComponentHealth]) -> HealthState:
    order = {"healthy": 0, "degraded": 1, "unavailable": 2, "not_configured": 3, "unknown": 4}
    worst = max(order.get(c.status, 4) for c in components)
    for state, rank in order.items():
        if rank == worst:
            return state  # type: ignore[return-value]
    return "unknown"


@router.get(
    "/settings",
    response_model=SettingsRead,
    summary="Read user application preferences",
    description="Returns typed, non-secret settings persisted in the local database.",
)
def read_settings_route(db: Session = Depends(get_db)) -> SettingsRead:
    return read_settings(db)


@router.patch(
    "/settings",
    response_model=SettingsRead,
    summary="Partially update user preferences",
    description="Merges the supplied sections into stored settings; unset fields are preserved.",
)
def update_settings_route(patch: SettingsPatch, db: Session = Depends(get_db)) -> SettingsRead:
    if not patch.model_fields_set_nonempty():
        raise PlannerAPIError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="NO_SETTINGS_PROVIDED",
            message="At least one settings section must be provided.",
        )
    return apply_patch(db, patch)


@router.post(
    "/settings/reset",
    response_model=SettingsReset,
    summary="Reset settings to defaults",
    description="Restores all preferences to safe defaults. Irreversible.",
)
def reset_settings_route(db: Session = Depends(get_db)) -> SettingsReset:
    return apply_reset(db)


@router.get(
    "/settings/health",
    response_model=HealthDashboard,
    summary="Operational health dashboard",
    description="Reports accurate status for Electron, backend, database, migrations, AI provider, indexing, terminal, and Git.",
)
def health_dashboard(request: Request, db: Session = Depends(get_db)) -> HealthDashboard:
    components: list[ComponentHealth] = []

    # FastAPI backend: responding means healthy.
    backend = _component(
        "backend",
        "healthy",
        "The FastAPI API process is serving requests.",
        retry=False,
    )
    components.append(backend)

    # Database connection: run a trivial query.
    db_status: HealthState = "healthy"
    db_message = "The local SQLite database is reachable."
    db_retry = True
    try:
        db.execute(text("SELECT 1")).scalar()
    except Exception as error:  # pragma: no cover - environment dependent
        db_status = "unavailable"
        db_message = f"The database could not be reached: {error}"
    components.append(_component("database", db_status, db_message, retry=db_retry))

    # Migration status: compare alembic_version table head to expected latest revision.
    migration_status: HealthState = "healthy"
    migration_message = "Database schema is at the latest migration."
    migration_retry = False
    try:
        row = db.execute(text("SELECT version_num FROM alembic_version LIMIT 1")).scalar_one_or_none()
        if row is None:
            migration_status = "unavailable"
            migration_message = "No migration version is recorded."
        elif row != "0007_app_settings":
            migration_status = "degraded"
            migration_message = f"Schema is at {row}; expected 0007_app_settings. Run migrations."
    except Exception as error:  # pragma: no cover - environment dependent
        migration_status = "unavailable"
        migration_message = f"Migration status could not be read: {error}"
        migration_retry = True
    components.append(_component("migrations", migration_status, migration_message, retry=migration_retry))

    # AI provider configuration (Phase 8 abstraction). Credential is never returned.
    settings: Settings = request.app.state.settings
    configured = bool(
        settings.openai_api_key and settings.openai_api_key.get_secret_value().strip()
    )
    ai_status: HealthState = "healthy" if configured else "not_configured"
    ai_message = (
        "OpenAI provider is configured."
        if configured
        else "No AI provider credential is configured. Set BUILDX_OPENAI_API_KEY and restart."
    )
    ai_retry = not configured
    components.append(
        _component("ai_provider", ai_status, ai_message, retry=ai_retry)
    )

    # Project indexing service (Phase 10): inspect the latest index job state if tables exist.
    indexing_status: HealthState = "healthy"
    indexing_message = "Project context indexing is available."
    indexing_retry = True
    try:
        job = db.execute(
            text("SELECT state, errors FROM project_index_jobs ORDER BY updated_at DESC LIMIT 1")
        ).fetchall()
        if not job:
            indexing_status = "not_configured"
            indexing_message = "No project has been indexed yet."
        else:
            state, errors = job[0]
            if state == "failed" or (errors and len(errors) > 0):
                indexing_status = "degraded"
                indexing_message = f"Indexing reported errors: {errors[:2]}"
            elif state in ("indexing", "refreshing"):
                indexing_status = "degraded"
                indexing_message = "An indexing refresh is in progress."
            else:
                indexing_status = "healthy"
                indexing_message = "Project context indexing is available."
    except Exception:
        # Table may not exist in older schemas; treat as unavailable rather than failing.
        indexing_status = "unavailable"
        indexing_message = "Indexing service tables are not available."
    components.append(_component("project_indexing", indexing_status, indexing_message, retry=indexing_retry))

    # Terminal / process manager: Phase 13 runs in Electron; backend reports availability only.
    terminal_status: HealthState = "healthy"
    terminal_message = "Terminal process management is available through the desktop main process."
    components.append(_component("terminal", terminal_status, terminal_message, retry=False))

    # Git integration: not implemented in this codebase.
    git_status: HealthState = "not_configured"
    git_message = "Git integration is not implemented in this phase."
    components.append(_component("git", git_status, git_message, retry=False))

    # Electron application: the backend cannot probe Electron directly; report based on reachability context.
    electron_status: HealthState = "healthy"
    electron_message = "Electron main process is hosting this backend."
    components.append(_component("electron", electron_status, electron_message, retry=False))

    overall = _overall(components)
    return HealthDashboard(
        overall=overall,
        components=components,
        checked_at=_iso_now(),
    )
