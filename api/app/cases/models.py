from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.common.object_id import PyObjectId

CaseStatus = Literal["Open", "InProgress", "Pending", "Resolved"]
CaseType = Literal["Support", "Implementation", "Deactivation", "Escalation"]
ReporterType = Literal["Customer", "Internal"]
ReferenceType = Literal["Bug", "Task", "Workorder"]
ActivityEntryType = Literal["system", "comment"]


class Case(BaseModel):
    """Internal representation of a `cases` document — matches
    `core/models/case.model.ts` on the Angular side (plan §3.2)."""

    id: PyObjectId = Field(alias="_id")
    case_id: str
    reported_date: datetime
    # Plan §10 — reporters are overwhelmingly customer-side contacts, not
    # internal users (confirmed by the Phase 5 migration's real data), so
    # this is a type + free-text name rather than a user reference.
    reporter_type: ReporterType
    reporter_name: str
    customer: str
    product: str
    category: str
    description: str
    assigned_to: PyObjectId
    status: CaseStatus
    type: CaseType
    market: str = ""
    remarks: str = ""
    resolution: str = ""
    # Plan §12 — three independent reference types, any combination
    # (including none). Bug stays single-valued; Task/WO are multi-valued
    # ("multiple tasks and workorders assigned to a single case"). Which
    # types are even offered for a given case is driven by its category's
    # `allowed_reference_types` (see app/reference_data/models.py), not
    # hardcoded here.
    bug_number: str | None = None
    task_numbers: list[str] = []
    work_order_numbers: list[str] = []
    date_of_closure: datetime | None = None
    linked_implementation_id: PyObjectId | None = None
    created_by: PyObjectId
    updated_by: PyObjectId
    created_at: datetime
    updated_at: datetime
    # Soft delete — hidden from list/get, never physically removed, so a
    # mistaken delete stays recoverable via direct DB access.
    deleted: bool = False
    deleted_at: datetime | None = None
    deleted_by: PyObjectId | None = None

    model_config = {"populate_by_name": True, "arbitrary_types_allowed": True}


class ActivityEntry(BaseModel):
    """A single row in a case's audit trail — plan §12/Part A. Written
    automatically by `create_case`/`update_case` (`entry_type="system"`) or
    by a user posting a comment (`entry_type="comment"`) — both share this
    collection/model so they render as one chronological feed."""

    id: PyObjectId = Field(alias="_id")
    case_id: PyObjectId
    user_id: PyObjectId
    entry_type: ActivityEntryType
    change_summary: str
    created_at: datetime

    model_config = {"populate_by_name": True, "arbitrary_types_allowed": True}
