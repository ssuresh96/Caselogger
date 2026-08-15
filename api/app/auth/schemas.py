from pydantic import ConfigDict
from fastapi_users import schemas
from fastapi_users_db_beanie import PydanticObjectId

from app.common.camel import CamelModel, to_camel
from app.common.object_id import PyObjectId

# fastapi-users' base schemas are snake_case (is_active, is_superuser, ...).
# The rest of this API is camelCase (see app.common.camel.CamelModel) —
# aliasing here too so the wire format is consistent everywhere, and so
# Angular's AuthService (which reads `isSuperuser`) actually works.
_camel_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class UserRead(schemas.BaseUser[PydanticObjectId]):
    model_config = _camel_config
    name: str


class UserCreate(schemas.BaseUserCreate):
    model_config = _camel_config
    name: str


class UserUpdate(schemas.BaseUserUpdate):
    model_config = _camel_config
    name: str | None = None


class UserSummary(CamelModel):
    """Minimal user reference for embedding elsewhere (e.g. `CaseOut`'s
    `assignedTo`/`createdBy`/`updatedBy`) — plan §11 (T11.4). Other modules
    import this from here rather than defining their own copy, since a
    "summary of a user" is auth's concept to own."""

    id: PyObjectId
    name: str
    email: str
