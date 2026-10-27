"""Top-level versioned API router."""

from fastapi import APIRouter

from app.api.routes.health import router as health_router
from app.api.routes.ai import router as ai_router
from app.api.routes.projects import router as projects_router
from app.api.routes.plans import router as plans_router
from app.api.routes.context import router as context_router
from app.api.routes.conversations import router as conversations_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(projects_router)
api_router.include_router(ai_router)
api_router.include_router(plans_router)
api_router.include_router(context_router)
api_router.include_router(conversations_router)
