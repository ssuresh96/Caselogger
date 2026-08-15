from datetime import datetime

from app.common.camel import CamelModel
from app.common.object_id import PyObjectId
from app.reference_data.models import ReferenceKind, ReferenceType, Tone


class ReferenceItemCreate(CamelModel):
    kind: ReferenceKind
    name: str
    value: str
    active: bool = True
    order: int = 0
    tone: Tone | None = None
    closes_case: bool | None = None
    allowed_reference_types: list[ReferenceType] | None = None


class ReferenceItemUpdate(CamelModel):
    name: str | None = None
    value: str | None = None
    active: bool | None = None
    order: int | None = None
    tone: Tone | None = None
    closes_case: bool | None = None
    allowed_reference_types: list[ReferenceType] | None = None


class ReferenceItemOut(CamelModel):
    id: PyObjectId
    kind: ReferenceKind
    name: str
    value: str
    active: bool
    order: int
    tone: Tone | None
    closes_case: bool | None
    allowed_reference_types: list[ReferenceType] | None
    created_at: datetime
    updated_at: datetime
