import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Must happen before any `app.*` import — app.core.database creates its
# Motor client/database at module-import time from these settings.
os.environ["MONGODB_DB_NAME"] = "case_logger_test"
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production-use-only-32bytes+")

import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from app.auth.manager import get_user_db, get_user_manager  # noqa: E402
from app.auth.models import User  # noqa: E402
from app.auth.schemas import UserCreate  # noqa: E402
from app.core.database import database, init_db  # noqa: E402
from app.core.rate_limit import reset_login_rate_limit  # noqa: E402
from app.main import app  # noqa: E402


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _init_database():
    await init_db()
    yield


@pytest_asyncio.fixture(autouse=True)
async def _clear_collections():
    for name in await database.list_collection_names():
        await database[name].delete_many({})
    reset_login_rate_limit()
    yield


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def superuser() -> User:
    async for user_db in get_user_db():
        async for user_manager in get_user_manager(user_db):
            return await user_manager.create(
                UserCreate(
                    email="admin@test.caselogger.internal",
                    password="AdminPass123!",
                    name="Test Admin",
                    is_superuser=True,
                )
            )


@pytest_asyncio.fixture
async def regular_user() -> User:
    async for user_db in get_user_db():
        async for user_manager in get_user_manager(user_db):
            return await user_manager.create(
                UserCreate(
                    email="agent@test.caselogger.internal",
                    password="AgentPass123!",
                    name="Test Agent",
                    is_superuser=False,
                )
            )


async def _login(client: AsyncClient, email: str, password: str) -> str:
    resp = await client.post("/auth/jwt/login", data={"username": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


@pytest_asyncio.fixture
async def superuser_token(client: AsyncClient, superuser: User) -> str:
    return await _login(client, "admin@test.caselogger.internal", "AdminPass123!")


@pytest_asyncio.fixture
async def regular_user_token(client: AsyncClient, regular_user: User) -> str:
    return await _login(client, "agent@test.caselogger.internal", "AgentPass123!")
