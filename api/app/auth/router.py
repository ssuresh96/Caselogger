from datetime import UTC, datetime

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status

from app.auth.dependencies import current_active_user, current_superuser
from app.auth.models import User
from app.common.camel import CamelModel
from app.common.object_id import PyObjectId

router = APIRouter(prefix="/users", tags=["users"])


def _is_locked(user: User) -> bool:
    if user.locked_until is None:
        return False
    # Motor/Beanie return naive datetimes on read (Mongo stores UTC without
    # tzinfo) — normalize before comparing against an aware "now".
    locked_until = user.locked_until
    if locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=UTC)
    return locked_until > datetime.now(UTC)


class UserSummaryOut(CamelModel):
    id: PyObjectId
    name: str
    email: str
    is_active: bool
    is_superuser: bool
    is_locked: bool


@router.get("", response_model=list[UserSummaryOut])
async def list_users(
    active_only: bool = Query(default=False, alias="activeOnly"),
    _user: User = Depends(current_active_user),
) -> list[UserSummaryOut]:
    """Not provided by fastapi-users out of the box (it only ships /me and
    /{id}) — needed for the Assigned To dropdown on the Create Case modal,
    and the Admin Panel's Users tab."""
    query = User.find(User.is_active == True) if active_only else User.find_all()  # noqa: E712
    users = await query.sort("+name").to_list()
    return [
        UserSummaryOut(
            id=u.id,
            name=u.name,
            email=u.email,
            is_active=u.is_active,
            is_superuser=u.is_superuser,
            is_locked=_is_locked(u),
        )
        for u in users
    ]


@router.post("/{user_id}/unlock", response_model=UserSummaryOut)
async def unlock_user(user_id: str, _admin: User = Depends(current_superuser)) -> UserSummaryOut:
    """Admin-only manual unlock (plan §10) — clears a lockout before its
    automatic cooldown expires. Complements, doesn't replace, the auto-unlock
    in `UserManager.authenticate`."""
    try:
        object_id = ObjectId(user_id)
    except InvalidId as exc:
        raise HTTPException(http_status.HTTP_400_BAD_REQUEST, "Invalid id") from exc

    user = await User.get(object_id)
    if user is None:
        raise HTTPException(http_status.HTTP_404_NOT_FOUND, "User not found")

    user.locked_until = None
    user.failed_login_attempts = 0
    await user.save()

    return UserSummaryOut(
        id=user.id,
        name=user.name,
        email=user.email,
        is_active=user.is_active,
        is_superuser=user.is_superuser,
        is_locked=False,
    )
