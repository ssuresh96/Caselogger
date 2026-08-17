from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status

from app.auth.dependencies import current_active_user, current_superuser
from app.auth.models import User
from app.reference_data import service
from app.reference_data.models import ReferenceKind
from app.reference_data.schemas import ReferenceItemCreate, ReferenceItemOut, ReferenceItemUpdate

router = APIRouter(prefix="/reference-data", tags=["reference-data"])


def _parse_object_id(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except InvalidId as exc:
        raise HTTPException(http_status.HTTP_400_BAD_REQUEST, "Invalid id") from exc


@router.get("", response_model=list[ReferenceItemOut])
async def list_reference_items(
    kind: ReferenceKind | None = None,
    active_only: bool = Query(default=False, alias="activeOnly"),
    _user: User = Depends(current_active_user),  # any authed user — dropdowns need this
) -> list[ReferenceItemOut]:
    return await service.list_reference_items(kind, active_only)


@router.post("", response_model=ReferenceItemOut, status_code=http_status.HTTP_201_CREATED)
async def create_reference_item(
    payload: ReferenceItemCreate, _admin: User = Depends(current_superuser)
) -> ReferenceItemOut:
    return await service.create_reference_item(payload)


@router.patch("/{item_id}", response_model=ReferenceItemOut)
async def update_reference_item(
    item_id: str, payload: ReferenceItemUpdate, _admin: User = Depends(current_superuser)
) -> ReferenceItemOut:
    return await service.update_reference_item(_parse_object_id(item_id), payload)


@router.delete("/{item_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_reference_item(item_id: str, admin: User = Depends(current_superuser)) -> None:
    await service.delete_reference_item(_parse_object_id(item_id), admin.id)
