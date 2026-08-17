from datetime import datetime

from app.common.camel import CamelModel
from app.common.object_id import PyObjectId
from app.email_agent.models import ProcessedEmailOutcome


class ProcessedEmailOut(CamelModel):
    id: PyObjectId
    graph_message_id: str
    conversation_id: str
    received_at: datetime
    outcome: ProcessedEmailOutcome
    case_id: PyObjectId | None
    detail: str
    created_at: datetime


class EmailAgentRunResult(CamelModel):
    """Response for `POST /internal/email-agent/run` — a per-run summary
    the GitHub Actions workflow's log shows, so a stuck/misbehaving poller
    is visible without having to query `ProcessedEmail` directly."""

    checked: int
    created: int
    appended: int
    skipped: int
    errors: int


class EmailAgentStatusOut(CamelModel):
    enabled: bool
    last_checkpoint: datetime | None
    recent: list[ProcessedEmailOut]


class GraphSettingsOut(CamelModel):
    """Never carries `client_secret` — `has_client_secret` is all the
    frontend needs to show a "configured"/"not set" state without the
    actual value ever leaving the server after it's saved."""

    tenant_id: str
    client_id: str
    has_client_secret: bool
    mailbox: str
    updated_at: datetime | None


class GraphSettingsUpdate(CamelModel):
    tenant_id: str | None = None
    client_id: str | None = None
    client_secret: str | None = None  # omitted/blank = leave the stored value unchanged
    mailbox: str | None = None
