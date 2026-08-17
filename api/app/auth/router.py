from datetime import UTC, datetime

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status
from fastapi_users import BaseUserManager
from fastapi_users.exceptions import InvalidPasswordException, UserAlreadyExists

from app.auth.dependencies import current_active_user, current_superuser
from app.auth.manager import get_user_manager
from app.auth.models import User
from app.auth.schemas import UserCreate
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
    user: User = Depends(current_active_user),
) -> list[UserSummaryOut]:
    """Not provided by fastapi-users out of the box (it only ships /me and
    /{id}) — needed for the Assigned To dropdown on the Create Case modal,
    and the Admin Panel's Users tab.

    Security audit M-1: a non-admin caller only needs id/name/isActive to
    populate an assignee picker (confirmed against every frontend call
    site — none of them read email/isSuperuser/isLocked outside the
    admin-only Users page), so email/role/lock-status are redacted for
    them rather than handed to every logged-in agent. Admins still get the
    full picture, same as before."""
    query = User.find(User.is_active == True) if active_only else User.find_all()  # noqa: E712
    users = await query.sort("+name").to_list()
    return [
        UserSummaryOut(
            id=u.id,
            name=u.name,
            email=u.email if user.is_superuser else "",
            is_active=u.is_active,
            is_superuser=u.is_superuser if user.is_superuser else False,
            is_locked=_is_locked(u) if user.is_superuser else False,
        )
        for u in users
    ]


@router.post("", response_model=UserSummaryOut, status_code=http_status.HTTP_201_CREATED)
async def create_user(
    user_create: UserCreate,
    _admin: User = Depends(current_superuser),
    user_manager: BaseUserManager = Depends(get_user_manager),
) -> UserSummaryOut:
    """Admin-provisioned account creation (plan §5/T1.4 — this is an
    internal tool, not public sign-up). Deliberately not fastapi-users'
    own /auth/register: that route hardcodes `safe=True` on every call
    regardless of who's authenticated, which silently drops isSuperuser/
    isVerified from the body — a guard meant for a *public* registration
    endpoint to stop self-escalation, wrongly applied to one that's
    already admin-gated. This route is gated the same way but honors the
    caller's isSuperuser choice, same as the PATCH update route below
    (fastapi-users' own get_users_router already uses safe=False there —
    only /auth/register was the mismatched one)."""
    try:
        user = await user_manager.create(user_create, safe=False)
    except UserAlreadyExists as exc:
        raise HTTPException(
            http_status.HTTP_400_BAD_REQUEST, "REGISTER_USER_ALREADY_EXISTS"
        ) from exc
    except InvalidPasswordException as exc:
        raise HTTPException(
            http_status.HTTP_400_BAD_REQUEST,
            {"code": "REGISTER_INVALID_PASSWORD", "reason": exc.reason},
        ) from exc

    return UserSummaryOut(
        id=user.id,
        name=user.name,
        email=user.email,
        is_active=user.is_active,
        is_superuser=user.is_superuser,
        is_locked=False,
    )


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
