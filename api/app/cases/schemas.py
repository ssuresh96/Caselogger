from datetime import datetime

from pydantic import Field

from app.auth.schemas import UserSummary
from app.cases.models import ActivityEntryType, CaseSource, CaseStatus, CaseType, ReporterType
from app.common.camel import CamelModel
from app.common.object_id import PyObjectId


class CaseCreate(CamelModel):
    """The fields the Create Case modal collects — see plan §2/T2.3, §10.
    `assigned_to` is a real user reference (T2.2's populate-on-read
    decision); the reporter is not — see `ReporterType` on the model.
    Bug/Task/WO reference numbers (§12) aren't collected at creation —
    they're added later via Case Detail's edit form, once a case exists."""

    reported_date: datetime
    reporter_type: ReporterType
    reporter_name: str
    customer: str
    product: str
    description: str
    category: str
    assigned_to: PyObjectId
    status: CaseStatus
    type: CaseType


class CaseImportCreate(CamelModel):
    """Used only by the Phase 13 historical-data import (`app/import_data`),
    never by the live Create Case dialog. Unlike `CaseCreate`, this carries
    the fields a backfilled historical row needs up front — market/remarks/
    resolution/Bug/Task/WO — since there's no later edit-form step for
    imported rows the way there is for freshly-created ones."""

    reported_date: datetime
    reporter_type: ReporterType
    reporter_name: str
    customer: str
    product: str
    description: str
    category: str
    assigned_to: PyObjectId
    status: CaseStatus
    type: CaseType
    market: str = ""
    remarks: str = ""
    resolution: str = ""
    bug_number: str | None = None
    task_numbers: list[str] = []
    work_order_numbers: list[str] = []


class CaseEmailCreate(CamelModel):
    """Used only by `app.email_agent` (email-to-case, new-case path) — like
    `CaseImportCreate` in that it's a one-shot creation with no later
    edit-form step, but additionally carries `email_conversation_id` so the
    resulting case can be matched against later replies in the same
    Microsoft Graph email thread."""

    reported_date: datetime
    reporter_type: ReporterType
    reporter_name: str
    customer: str
    product: str
    description: str
    category: str
    assigned_to: PyObjectId
    status: CaseStatus
    type: CaseType
    market: str = ""
    email_conversation_id: str


class CaseUpdate(CamelModel):
    reporter_type: ReporterType | None = None
    reporter_name: str | None = None
    customer: str | None = None
    product: str | None = None
    description: str | None = None
    category: str | None = None
    assigned_to: PyObjectId | None = None
    status: CaseStatus | None = None
    type: CaseType | None = None
    market: str | None = None
    remarks: str | None = None
    resolution: str | None = None
    bug_number: str | None = None
    task_numbers: list[str] | None = None
    work_order_numbers: list[str] | None = None


class CaseOut(CamelModel):
    id: PyObjectId
    case_id: str
    reported_date: datetime
    reporter_type: ReporterType
    reporter_name: str
    customer: str
    product: str
    category: str
    description: str
    assigned_to: UserSummary
    status: CaseStatus
    type: CaseType
    market: str
    remarks: str
    resolution: str
    bug_number: str | None
    task_numbers: list[str]
    work_order_numbers: list[str]
    date_of_closure: datetime | None
    linked_implementation_id: PyObjectId | None
    source: CaseSource
    email_conversation_id: str | None
    created_by: UserSummary
    updated_by: UserSummary
    created_at: datetime
    updated_at: datetime


class CaseListOut(CamelModel):
    items: list[CaseOut]
    total: int
    page: int
    page_size: int = Field(alias="pageSize")


class ActivityEntryOut(CamelModel):
    id: PyObjectId
    case_id: PyObjectId
    user: UserSummary
    entry_type: ActivityEntryType
    change_summary: str
    created_at: datetime


class ActivityCommentCreate(CamelModel):
    message: str
