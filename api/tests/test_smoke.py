from httpx import AsyncClient


async def test_health(client: AsyncClient):
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_login_and_me(client: AsyncClient, superuser_token: str):
    resp = await client.get("/users/me", headers={"Authorization": f"Bearer {superuser_token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == "admin@test.caselogger.internal"
    assert body["isSuperuser"] is True
