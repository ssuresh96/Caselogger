import secrets

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi import status as http_status

from app.auth.dependencies import current_superuser
from app.auth.models import User
from app.core.config import settings
from app.email_agent import graph_settings, service
from app.email_agent.schemas import (
    EmailAgentRunResult,
    EmailAgentStatusOut,
    GraphSettingsOut,
    GraphSettingsUpdate,
)

router = APIRouter(prefix="/internal/email-agent", tags=["email-agent"])
admin_router = APIRouter(prefix="/admin/email-agent", tags=["email-agent"])


def _verify_internal_token(x_internal_token: str | None = Header(default=None)) -> None:
    """Machine-to-machine auth — the caller is the scheduled GitHub Actions
    workflow, not a logged-in user, so this is a shared secret rather than
    the admin JWT flow used everywhere else in the API. Uses
    secrets.compare_digest (security audit M-3) instead of `!=` so the
    comparison doesn't leak timing information about how much of the token
    matched."""
    if not settings.email_agent_internal_token or not secrets.compare_digest(
        x_internal_token or "", settings.email_agent_internal_token
    ):
        raise HTTPException(http_status.HTTP_401_UNAUTHORIZED, "Invalid or missing internal token")


@router.post("/run", response_model=EmailAgentRunResult, dependencies=[Depends(_verify_internal_token)])
async def run_email_agent() -> EmailAgentRunResult:
    return await service.run_poll()


@router.get("/status", response_model=EmailAgentStatusOut, dependencies=[Depends(_verify_internal_token)])
async def email_agent_status() -> EmailAgentStatusOut:
    return await service.get_status()


@admin_router.get("/graph-settings", response_model=GraphSettingsOut)
async def get_graph_settings(_admin: User = Depends(current_superuser)) -> GraphSettingsOut:
    return await graph_settings.get_graph_settings_out()


@admin_router.put("/graph-settings", response_model=GraphSettingsOut)
async def update_graph_settings(
    payload: GraphSettingsUpdate, admin: User = Depends(current_superuser)
) -> GraphSettingsOut:
    return await graph_settings.update_graph_settings(payload, admin.id)
