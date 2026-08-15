from httpx import AsyncClient


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_list_reference_data_requires_auth(client: AsyncClient):
    resp = await client.get("/reference-data")
    assert resp.status_code == 401


async def test_regular_user_can_read_reference_data(client: AsyncClient, regular_user_token: str):
    resp = await client.get("/reference-data", headers=_auth(regular_user_token))
    assert resp.status_code == 200
    assert resp.json() == []


async def test_regular_user_cannot_create_reference_data(client: AsyncClient, regular_user_token: str):
    resp = await client.post(
        "/reference-data",
        json={"kind": "product", "name": "New Product", "value": "NP"},
        headers=_auth(regular_user_token),
    )
    assert resp.status_code == 403


async def test_superuser_can_create_and_patch_reference_data(
    client: AsyncClient, superuser_token: str
):
    headers = _auth(superuser_token)
    resp = await client.post(
        "/reference-data",
        json={"kind": "product", "name": "New Product", "value": "NP"},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    item_id = resp.json()["id"]
    assert resp.json()["active"] is True

    resp = await client.patch(f"/reference-data/{item_id}", json={"active": False}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["active"] is False


async def test_reference_data_visible_after_creation(
    client: AsyncClient, superuser_token: str, regular_user_token: str
):
    await client.post(
        "/reference-data",
        json={"kind": "market", "name": "UAE", "value": "UAE"},
        headers=_auth(superuser_token),
    )
    resp = await client.get(
        "/reference-data", params={"kind": "market"}, headers=_auth(regular_user_token)
    )
    assert resp.status_code == 200
    assert [i["value"] for i in resp.json()] == ["UAE"]


async def test_category_allowed_reference_types_defaults_to_null(
    client: AsyncClient, superuser_token: str
):
    """T12.7 — a category with no explicit `allowedReferenceTypes` allows
    all three types (represented as null, not an empty/full list)."""
    resp = await client.post(
        "/reference-data",
        json={"kind": "category", "name": "AOS-Queries", "value": "AOS-Queries"},
        headers=_auth(superuser_token),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["allowedReferenceTypes"] is None


async def test_category_allowed_reference_types_can_be_narrowed(
    client: AsyncClient, superuser_token: str
):
    """T12.7 — 'Other Support Cases' (or any category) can be restricted to
    a subset of Bug/Task/Workorder, admin-editable without a code change."""
    headers = _auth(superuser_token)
    resp = await client.post(
        "/reference-data",
        json={
            "kind": "category",
            "name": "Other Support Cases",
            "value": "Other Support Cases",
            "allowedReferenceTypes": ["Workorder"],
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["allowedReferenceTypes"] == ["Workorder"]
    item_id = resp.json()["id"]

    resp = await client.patch(
        f"/reference-data/{item_id}",
        json={"allowedReferenceTypes": ["Workorder", "Bug"]},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["allowedReferenceTypes"] == ["Workorder", "Bug"]
