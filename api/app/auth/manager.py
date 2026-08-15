from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi_users import BaseUserManager, InvalidPasswordException
from fastapi_users.exceptions import UserNotExists
from fastapi_users_db_beanie import BeanieUserDatabase, ObjectIDIDMixin, PydanticObjectId

from app.auth.models import User
from app.core.config import settings

# Account lockout policy (plan §10) — 3 wrong passwords locks the account
# for a cooldown; an admin can also clear the lock early (POST
# /users/{id}/unlock in app/auth/router.py).
MAX_LOGIN_ATTEMPTS = 3
LOCKOUT_DURATION = timedelta(minutes=15)


class UserManager(ObjectIDIDMixin, BaseUserManager[User, PydanticObjectId]):
    reset_password_token_secret = settings.jwt_secret
    verification_token_secret = settings.jwt_secret

    async def authenticate(self, credentials: OAuth2PasswordRequestForm) -> User | None:
        try:
            user = await self.get_by_email(credentials.username)
        except UserNotExists:
            # Run the hasher anyway to mitigate timing attacks that could
            # reveal whether an email is registered — same approach the
            # library's own default implementation uses.
            self.password_helper.hash(credentials.password)
            return None

        now = datetime.now(UTC)
        if user.locked_until is not None:
            # Motor/Beanie return naive datetimes on read (Mongo stores UTC
            # without tzinfo) — normalize before comparing against `now`.
            locked_until = user.locked_until
            if locked_until.tzinfo is None:
                locked_until = locked_until.replace(tzinfo=UTC)
            if locked_until > now:
                retry_after = int((locked_until - now).total_seconds())
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    detail={"code": "ACCOUNT_LOCKED", "retryAfterSeconds": retry_after},
                )
            # Lock has naturally expired — clear it and give a fresh set of attempts.
            user.locked_until = None
            user.failed_login_attempts = 0
            await self.user_db.update(user, {"locked_until": None, "failed_login_attempts": 0})

        verified, updated_hash = self.password_helper.verify_and_update(
            credentials.password, user.hashed_password
        )
        if not verified:
            attempts = user.failed_login_attempts + 1
            if attempts >= MAX_LOGIN_ATTEMPTS:
                locked_until = now + LOCKOUT_DURATION
                await self.user_db.update(
                    user, {"failed_login_attempts": attempts, "locked_until": locked_until}
                )
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    detail={
                        "code": "ACCOUNT_LOCKED",
                        "retryAfterSeconds": int(LOCKOUT_DURATION.total_seconds()),
                    },
                )
            await self.user_db.update(user, {"failed_login_attempts": attempts})
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "LOGIN_BAD_CREDENTIALS",
                    "attemptsRemaining": MAX_LOGIN_ATTEMPTS - attempts,
                },
            )

        update: dict = {}
        if user.failed_login_attempts:
            update["failed_login_attempts"] = 0
        if updated_hash is not None:
            update["hashed_password"] = updated_hash
        if update:
            await self.user_db.update(user, update)

        return user

    async def validate_password(self, password: str, user: User) -> None:
        # Deliberately not a full complexity-rule policy (upper/lower/digit/
        # symbol classes) — this is an internal, admin-provisioned tool, not
        # public registration, so length + "not trivially guessable" is the
        # actual threat model. See plan §7/T7.2.
        if len(password) < 8:
            raise InvalidPasswordException(reason="Password must be at least 8 characters")
        if password.isdigit():
            raise InvalidPasswordException(reason="Password cannot be all numbers")
        if password.lower() in (user.email.lower(), user.name.lower()):
            raise InvalidPasswordException(reason="Password cannot be the same as your email or name")

    async def on_after_register(self, user: User, request=None) -> None:
        # No email service wired up yet — see plan §7. Logging is enough for now.
        print(f"User registered: {user.email} (admin={user.is_superuser})")


async def get_user_db() -> AsyncGenerator[BeanieUserDatabase, None]:
    yield BeanieUserDatabase(User)


async def get_user_manager(
    user_db: BeanieUserDatabase = Depends(get_user_db),
) -> AsyncGenerator[UserManager, None]:
    yield UserManager(user_db)
