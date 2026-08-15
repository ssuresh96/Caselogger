from datetime import datetime

from fastapi_users_db_beanie import BeanieBaseUserDocument


class User(BeanieBaseUserDocument):
    """The `users` collection, managed by fastapi-users.

    `is_superuser` doubles as the admin/agent role (True = Admin) and
    `is_active` doubles as the deactivate/reactivate toggle — see plan §3.1.
    Users also double as the Team Members list Cases reference.

    `failed_login_attempts`/`locked_until` back the account-lockout policy
    (plan §10): 3 wrong passwords locks the account for a cooldown period,
    with an admin able to unlock it early — see `UserManager.authenticate`.
    """

    name: str
    failed_login_attempts: int = 0
    locked_until: datetime | None = None

    class Settings(BeanieBaseUserDocument.Settings):
        name = "users"
