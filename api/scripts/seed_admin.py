"""Bootstrap the first admin user. Public registration is admin-gated (see
app/main.py), so the system can't self-bootstrap without this — plan T1.6.

Usage:
    venv/Scripts/python.exe scripts/seed_admin.py <email> <password> <name>
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi_users.exceptions import UserAlreadyExists  # noqa: E402

from app.auth.manager import get_user_db, get_user_manager  # noqa: E402
from app.auth.schemas import UserCreate  # noqa: E402
from app.core.database import init_db  # noqa: E402


async def main() -> None:
    if len(sys.argv) != 4:
        print("Usage: seed_admin.py <email> <password> <name>")
        raise SystemExit(1)
    email, password, name = sys.argv[1], sys.argv[2], sys.argv[3]

    await init_db()
    async for user_db in get_user_db():
        async for user_manager in get_user_manager(user_db):
            try:
                user = await user_manager.create(
                    UserCreate(email=email, password=password, name=name, is_superuser=True)
                )
                print(f"Created admin user: {user.email} (id={user.id})")
            except UserAlreadyExists:
                print(f"User {email} already exists — skipping.")


if __name__ == "__main__":
    asyncio.run(main())
