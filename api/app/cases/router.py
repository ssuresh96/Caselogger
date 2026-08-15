from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status

from app.auth.dependencies import current_active_user
from app.auth.models import User
from app.cases import service
from app.cases.schemas import (
    ActivityCommentCreate,
    ActivityEntryOut,
    CaseCreate,
    CaseListOut,
    CaseOut,
    CaseUpdate,
)

router = APIRouter(prefix="/cases", tags=["cases"])


def _parse_object_id(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except InvalidId as exc:
        raise HTTPException(http_status.HTTP_400_BAD_REQUEST, "Invalid id") from exc


@router.get("", response_model=CaseListOut)
async def list_cases(
    status_filter: str | None = Query(default=None, alias="status"),
    type_filter: str | None = Query(default=None, alias="type"),
    search: str | None = None,
    assigned_to: str | None = Query(default=None, alias="assignedTo"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100, alias="pageSize"),
    _user: User = Depends(current_active_user),
) -> CaseListOut:
    items, total = await service.list_cases(
        status_filter=status_filter,
        type_filter=type_filter,
        search=search,
        page=page,
        page_size=page_size,
        assigned_to=_parse_object_id(assigned_to) if assigned_to else None,
    )
    return CaseListOut(items=items, total=total, page=page, pageSize=page_size)


@router.post("", response_model=CaseOut, status_code=http_status.HTTP_201_CREATED)
async def create_case(payload: CaseCreate, user: User = Depends(current_active_user)) -> CaseOut:
    return await service.create_case(payload, current_user_id=user.id)


@router.get("/{case_id}", response_model=CaseOut)
async def get_case(case_id: str, _user: User = Depends(current_active_user)) -> CaseOut:
    return await service.get_case(_parse_object_id(case_id))


@router.patch("/{case_id}", response_model=CaseOut)
async def update_case(
    case_id: str, payload: CaseUpdate, user: User = Depends(current_active_user)
) -> CaseOut:
    return await service.update_case(_parse_object_id(case_id), payload, current_user_id=user.id)


@router.delete("/{case_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_case(case_id: str, user: User = Depends(current_active_user)) -> None:
    await service.delete_case(_parse_object_id(case_id), current_user_id=user.id)


@router.get("/{case_id}/activity", response_model=list[ActivityEntryOut])
async def list_case_activity(
    case_id: str, _user: User = Depends(current_active_user)
) -> list[ActivityEntryOut]:
    return await service.list_activity(_parse_object_id(case_id))


@router.post(
    "/{case_id}/activity", response_model=ActivityEntryOut, status_code=http_status.HTTP_201_CREATED
)
async def add_case_comment(
    case_id: str, payload: ActivityCommentCreate, user: User = Depends(current_active_user)
) -> ActivityEntryOut:
    return await service.add_comment(_parse_object_id(case_id), payload.message, user_id=user.id)
