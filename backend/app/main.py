"""FastAPI application factory and safe error handlers."""

import logging
from contextlib import asynccontextmanager
import asyncio
from http import HTTPStatus
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from app.ai.contracts import AIProvider
from app.ai.openai_provider import OpenAIProvider
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routes.router import api_router
from app.core.config import Settings, get_settings
from app.schemas.errors import ErrorBody, ErrorResponse, PlannerAPIError, safe_validation_details

logger = logging.getLogger("buildx.api")


def create_app(settings: Settings | None = None, ai_provider: AIProvider | None = None) -> FastAPI:
    """Build an API instance with explicit configuration for tests and runtime."""

    configured = settings or get_settings()
    docs_enabled = configured.environment != "production"
    credential = configured.openai_api_key.get_secret_value().strip() if configured.openai_api_key else ""
    provider = ai_provider
    if provider is None and credential:
        provider = OpenAIProvider(api_key=credential, model_id=configured.ai_model)

    @asynccontextmanager
    async def lifespan(_application: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            close = getattr(provider, "close", None)
            if close is not None:
                await close()

    application = FastAPI(
        title=configured.app_name,
        version=configured.app_version,
        description="Local BUILDX desktop backend API.",
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
        lifespan=lifespan,
    )
    application.state.settings = configured
    application.state.ai_provider = provider
    application.state.active_conversations = set()
    application.state.active_generation_slots = asyncio.Semaphore(2)
    application.include_router(api_router, prefix=configured.api_prefix)

    @application.exception_handler(RequestValidationError)
    async def validation_error_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
        payload = ErrorResponse(
            error=ErrorBody(
                code="VALIDATION_ERROR",
                message="The request is invalid",
                details=safe_validation_details(exc.errors()),
            )
        )
        return JSONResponse(status_code=422, content=payload.model_dump(mode="json"))

    @application.exception_handler(StarletteHTTPException)
    async def http_error_handler(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        try:
            message = HTTPStatus(exc.status_code).phrase
        except ValueError:
            message = "Request failed"
        payload = ErrorResponse(
            error=ErrorBody(code=f"HTTP_{exc.status_code}", message=message)
        )
        return JSONResponse(
            status_code=exc.status_code,
            content=payload.model_dump(mode="json"),
            headers=exc.headers,
        )

    @application.exception_handler(PlannerAPIError)
    async def planner_error_handler(_request: Request, exc: PlannerAPIError) -> JSONResponse:
        payload = ErrorResponse(error=ErrorBody(code=exc.code, message=exc.message))
        return JSONResponse(status_code=exc.status_code, content=payload.model_dump(mode="json"))

    @application.exception_handler(Exception)
    async def unexpected_error_handler(request: Request, _exc: Exception) -> JSONResponse:
        logger.error(
            "Unhandled request exception",
            extra={"method": request.method, "path": request.url.path},
        )
        payload = ErrorResponse(
            error=ErrorBody(code="INTERNAL_SERVER_ERROR", message="An unexpected error occurred")
        )
        return JSONResponse(status_code=500, content=payload.model_dump(mode="json"))

    return application


app = create_app()
