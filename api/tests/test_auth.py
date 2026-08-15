import pytest
from fastapi_users import InvalidPasswordException
from httpx import AsyncClient

from app.auth.manager import get_user_db, get_user_manager
from app.auth.models import User


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _make_manager():
    async for user_db in get_user_db():
        async for user_manager in get_user_manager(user_db):
            return user_manager


@pytest.mark.parametrize(
    "password,email,name,expected_reason",
    [
        ("short1", "a@caselogger.internal", "A", "at least 8 characters"),
        ("12345678", "a@caselogger.internal", "A", "all numbers"),
        ("a@caselogger.internal", "a@caselogger.internal", "A", "email or name"),
    ],
)
async def test_password_policy_rejects_weak_passwords(password, email, name, expected_reason):
    manager = await _make_manager()
    fake_user = User(email=email, hashed_password="x", name=name)
    with pytest.raises(InvalidPasswordException) as exc_info:
        await manager.validate_password(password, fake_user)
    assert expected_reason in exc_info.value.reason


async def test_password_policy_accepts_strong_password():
    manager = await _make_manager()
    fake_user = User(email="a@caselogger.internal", hashed_password="x", name="A")
    await manager.validate_password("SecurePass!2026", fake_user)  # no raise


async def test_register_requires_superuser(client: AsyncClient, regular_user_token: str):
    resp = await client.post(
        "/auth/register",
        json={"email": "new@caselogger.internal", "password": "SecurePass!2026", "name": "New"},
        headers=_auth(regular_user_token),
    )
    assert resp.status_code == 403


async def test_register_requires_auth_at_all(client: AsyncClient):
    resp = await client.post(
        "/auth/register",
        json={"email": "new@caselogger.internal", "password": "SecurePass!2026", "name": "New"},
    )
    assert resp.status_code == 401


async def test_register_as_superuser_succeeds(client: AsyncClient, superuser_token: str):
    resp = await client.post(
        "/auth/register",
        json={"email": "new@caselogger.internal", "password": "SecurePass!2026", "name": "New"},
        headers=_auth(superuser_token),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["email"] == "new@caselogger.internal"


async def test_login_wrong_password_fails(client: AsyncClient, superuser: User):
    resp = await client.post(
        "/auth/jwt/login",
        data={"username": "admin@test.caselogger.internal", "password": "WrongPassword1"},
    )
    assert resp.status_code == 400


async def test_login_rate_limited_after_threshold(client: AsyncClient, superuser: User):
    for _ in range(10):
        resp = await client.post(
            "/auth/jwt/login",
            data={"username": "admin@test.caselogger.internal", "password": "WrongPassword1"},
        )
        assert resp.status_code == 400
    resp = await client.post(
        "/auth/jwt/login",
        data={"username": "admin@test.caselogger.internal", "password": "WrongPassword1"},
    )
    assert resp.status_code == 429


async def test_users_list_requires_auth(client: AsyncClient):
    resp = await client.get("/users")
    assert resp.status_code == 401


async def test_users_list_returns_all_users(
    client: AsyncClient, superuser_token: str, superuser: User, regular_user: User
):
    resp = await client.get("/users", headers=_auth(superuser_token))
    assert resp.status_code == 200
    emails = {u["email"] for u in resp.json()}
    assert emails == {"admin@test.caselogger.internal", "agent@test.caselogger.internal"}


async def test_patch_other_user_requires_superuser(
    client: AsyncClient, regular_user_token: str, regular_user: User
):
    resp = await client.patch(
        f"/users/{regular_user.id}", json={"isActive": False}, headers=_auth(regular_user_token)
    )
    assert resp.status_code == 403


# --- Account lockout (plan §10) ---

_LOGIN = {"username": "agent@test.caselogger.internal", "password": "WrongPassword1"}
_CORRECT_LOGIN = {"username": "agent@test.caselogger.internal", "password": "AgentPass123!"}


async def test_login_shows_attempts_remaining_after_first_failure(
    client: AsyncClient, regular_user: User
):
    resp = await client.post("/auth/jwt/login", data=_LOGIN)
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert detail["code"] == "LOGIN_BAD_CREDENTIALS"
    assert detail["attemptsRemaining"] == 2


async def test_login_locks_account_after_three_failures(client: AsyncClient, regular_user: User):
    for expected_remaining in (2, 1):
        resp = await client.post("/auth/jwt/login", data=_LOGIN)
        assert resp.json()["detail"]["attemptsRemaining"] == expected_remaining

    resp = await client.post("/auth/jwt/login", data=_LOGIN)
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert detail["code"] == "ACCOUNT_LOCKED"
    assert detail["retryAfterSeconds"] > 0


async def test_locked_account_rejects_correct_password_too(
    client: AsyncClient, regular_user: User
):
    for _ in range(3):
        await client.post("/auth/jwt/login", data=_LOGIN)

    resp = await client.post("/auth/jwt/login", data=_CORRECT_LOGIN)
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "ACCOUNT_LOCKED"


async def test_successful_login_resets_failed_attempt_count(
    client: AsyncClient, regular_user: User
):
    await client.post("/auth/jwt/login", data=_LOGIN)  # 1 failure -> 2 remaining

    resp = await client.post("/auth/jwt/login", data=_CORRECT_LOGIN)
    assert resp.status_code == 200

    resp = await client.post("/auth/jwt/login", data=_LOGIN)
    assert resp.json()["detail"]["attemptsRemaining"] == 2  # not 1 — counter reset


async def test_admin_unlock_endpoint(
    client: AsyncClient, superuser_token: str, regular_user: User
):
    for _ in range(3):
        await client.post("/auth/jwt/login", data=_LOGIN)
    locked_check = await client.post("/auth/jwt/login", data=_CORRECT_LOGIN)
    assert locked_check.json()["detail"]["code"] == "ACCOUNT_LOCKED"

    resp = await client.post(
        f"/users/{regular_user.id}/unlock", headers=_auth(superuser_token)
    )
    assert resp.status_code == 200
    assert resp.json()["isLocked"] is False

    resp = await client.post("/auth/jwt/login", data=_CORRECT_LOGIN)
    assert resp.status_code == 200


async def test_unlock_requires_superuser(
    client: AsyncClient, regular_user_token: str, regular_user: User
):
    resp = await client.post(
        f"/users/{regular_user.id}/unlock", headers=_auth(regular_user_token)
    )
    assert resp.status_code == 403


async def test_users_list_shows_locked_status(
    client: AsyncClient, superuser_token: str, regular_user: User
):
    for _ in range(3):
        await client.post("/auth/jwt/login", data=_LOGIN)

    resp = await client.get("/users", headers=_auth(superuser_token))
    users = {u["email"]: u for u in resp.json()}
    assert users["agent@test.caselogger.internal"]["isLocked"] is True
    assert users["admin@test.caselogger.internal"]["isLocked"] is False
