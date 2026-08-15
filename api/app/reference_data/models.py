from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.common.object_id import PyObjectId

ReferenceKind = Literal["category", "product", "market", "status", "type"]
Tone = Literal["good", "warning", "progress", "info", "serious", "critical"]
ReferenceType = Literal["Bug", "Task", "Workorder"]


class ReferenceItem(BaseModel):
    """Admin Panel reference data — plan §3.3."""

    id: PyObjectId = Field(alias="_id")
    kind: ReferenceKind
    name: str
    value: str
    active: bool = True
    order: int = 0
    tone: Tone | None = None
    closes_case: bool | None = None
    # category only, plan §12/T12.7 — which of Bug/Task/Workorder a case in
    # this category may reference. None/absent = all three allowed (the
    # default for every category); an explicit list narrows it, e.g.
    # "Other Support Cases" -> ["Workorder"] only. Same pattern as
    # `closes_case` for statuses (T3.7): admin-editable, no code change
    # needed to adjust a category's allowed types later.
    allowed_reference_types: list[ReferenceType] | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"populate_by_name": True, "arbitrary_types_allowed": True}
