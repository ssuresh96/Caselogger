from datetime import UTC, datetime

from httpx import AsyncClient

from app.auth.models import User

REPORT_MONTH = "2026-03"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _create_case(
    client: AsyncClient,
    token: str,
    *,
    assigned_to: str,
    day: int,
    status: str,
    product: str = "AOS",
    category: str = "AOS-General Support",
) -> dict:
    payload = {
        "reportedDate": datetime(2026, 3, day, tzinfo=UTC).isoformat(),
        "reporterType": "Customer",
        "reporterName": "Jane Reporter",
        "customer": "Test Customer",
        "product": product,
        "description": "desc",
        "category": category,
        "assignedTo": assigned_to,
        "status": status,
        "type": "Support",
    }
    resp = await client.post("/cases", json=payload, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_monthly_report_empty_month(client: AsyncClient, superuser_token: str):
    resp = await client.get(
        "/reports/monthly", params={"month": REPORT_MONTH}, headers=_auth(superuser_token)
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "month": REPORT_MONTH,
        "totalCases": 0,
        "aosCases": 0,
        "aosShare": 0.0,
        "pending": 0,
        "closeRate": 0.0,
        "implClosed": 0,
        "deactivations": 0,
        "pendingPct": 0.0,
        "categoryMix": [],
        "productMix": [],
    }


async def test_monthly_report_computes_totals(
    client: AsyncClient, superuser_token: str, superuser: User
):
    uid = str(superuser.id)
    await _create_case(client, superuser_token, assigned_to=uid, day=1, status="Resolved", product="AOS")
    await _create_case(client, superuser_token, assigned_to=uid, day=2, status="Pending", product="AOS")
    await _create_case(client, superuser_token, assigned_to=uid, day=3, status="Open", product="WS")

    resp = await client.get(
        "/reports/monthly", params={"month": REPORT_MONTH}, headers=_auth(superuser_token)
    )
    body = resp.json()
    assert body["totalCases"] == 3
    assert body["aosCases"] == 2
    assert body["aosShare"] == round(2 / 3 * 100, 1)
    assert body["pending"] == 1
    assert body["closeRate"] == round(1 / 3 * 100, 1)
    assert {row["label"]: row["cases"] for row in body["productMix"]} == {"AOS": 2, "WS": 1}


async def test_monthly_report_excludes_other_months(
    client: AsyncClient, superuser_token: str, superuser: User
):
    uid = str(superuser.id)
    await _create_case(client, superuser_token, assigned_to=uid, day=1, status="Open")
    payload = {
        "reportedDate": datetime(2026, 4, 1, tzinfo=UTC).isoformat(),
        "reporterType": "Customer",
        "reporterName": "Jane Reporter",
        "customer": "Test Customer",
        "product": "AOS",
        "description": "desc",
        "category": "AOS-General Support",
        "assignedTo": uid,
        "status": "Open",
        "type": "Support",
    }
    resp = await client.post("/cases", json=payload, headers=_auth(superuser_token))
    assert resp.status_code == 201

    resp = await client.get(
        "/reports/monthly", params={"month": REPORT_MONTH}, headers=_auth(superuser_token)
    )
    assert resp.json()["totalCases"] == 1


async def test_team_workload(
    client: AsyncClient, superuser_token: str, superuser: User, regular_user: User
):
    admin_id, agent_id = str(superuser.id), str(regular_user.id)
    await _create_case(client, superuser_token, assigned_to=agent_id, day=1, status="Resolved")
    await _create_case(client, superuser_token, assigned_to=agent_id, day=2, status="Pending")
    await _create_case(client, superuser_token, assigned_to=admin_id, day=3, status="Resolved")

    resp = await client.get(
        "/reports/team-workload", params={"month": REPORT_MONTH}, headers=_auth(superuser_token)
    )
    assert resp.status_code == 200
    rows = {row["member"]: row for row in resp.json()}
    assert rows["Test Agent"]["assigned"] == 2
    assert rows["Test Agent"]["closed"] == 1
    assert rows["Test Agent"]["pending"] == 1
    assert rows["Test Admin"]["assigned"] == 1
    assert rows["Test Admin"]["closed"] == 1


async def test_reports_require_auth(client: AsyncClient):
    resp = await client.get("/reports/monthly", params={"month": REPORT_MONTH})
    assert resp.status_code == 401


async def test_reports_reject_bad_month_format(client: AsyncClient, superuser_token: str):
    resp = await client.get(
        "/reports/monthly", params={"month": "not-a-month"}, headers=_auth(superuser_token)
    )
    assert resp.status_code == 400
