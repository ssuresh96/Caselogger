from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.common.object_id import PyObjectId

ProcessedEmailOutcome = Literal["created", "appended", "skipped", "error"]


class ProcessedEmail(BaseModel):
    """Audit trail for the email-to-case agent. Case creation is fully
    automatic (no review queue), so this collection — not a human — is what
    a wrong/missed/duplicate case gets diagnosed against after the fact.
    `graph_message_id` is checked on every poll run before any processing
    happens, so a message already recorded here is never handled twice even
    if a run overlaps the previous one's time window."""

    id: PyObjectId = Field(alias="_id")
    graph_message_id: str
    conversation_id: str
    received_at: datetime
    outcome: ProcessedEmailOutcome
    case_id: PyObjectId | None = None
    detail: str
    created_at: datetime

    model_config = {"populate_by_name": True, "arbitrary_types_allowed": True}
