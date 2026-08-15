from datetime import UTC, datetime

from bson import ObjectId
from httpx import AsyncClient

from app.auth.models import User
from app.core.database import database


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _case_payload(assigned_to: str, **overrides) -> dict:
    payload = {
        "reportedDate": datetime.now(UTC).isoformat(),
        "reporterType": "Customer",
        "reporterName": "Jane Reporter",
        "customer": "Test Customer",
        "product": "AOS",
        "description": "Something broke",
        "category": "AOS-General Support",
        "assignedTo": assigned_to,
        "status": "Open",
        "type": "Support",
    }
    payload.update(overrides)
    return payload


async def test_create_case_requires_auth(client: AsyncClient):
    resp = await client.post("/cases", json=_case_payload("y"))
    assert resp.status_code == 401


async def test_create_and_get_case(client: AsyncClient, superuser_token: str, superuser: User):
    payload = _case_payload(str(superuser.id))
    resp = await client.post("/cases", json=payload, headers=_auth(superuser_token))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["caseId"].startswith("CASE-")
    assert body["status"] == "Open"
    assert body["dateOfClosure"] is None
    assert body["reporterType"] == "Customer"
    assert body["reporterName"] == "Jane Reporter"

    resp = await client.get(f"/cases/{body['id']}", headers=_auth(superuser_token))
    assert resp.status_code == 200
    assert resp.json()["caseId"] == body["caseId"]


async def test_create_case_internal_reporter(
    client: AsyncClient, superuser_token: str, superuser: User
):
    payload = _case_payload(
        str(superuser.id), reporterType="Internal", reporterName="Thasneem"
    )
    resp = await client.post("/cases", json=payload, headers=_auth(superuser_token))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["reporterType"] == "Internal"
    assert body["reporterName"] == "Thasneem"


async def test_update_case_reporter_and_remarks(
    client: AsyncClient, superuser_token: str, superuser: User
):
    """Case editing (plan §10) — reporter info and remarks are editable
    after creation, all via the single case-detail PATCH."""
    headers = _auth(superuser_token)
    resp = await client.post("/cases", json=_case_payload(str(superuser.id)), headers=headers)
    case_id = resp.json()["id"]

    resp = await client.patch(
        f"/cases/{case_id}",
        json={"remarks": "Called customer back, awaiting confirmation.", "reporterName": "John Updated"},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["remarks"] == "Called customer back, awaiting confirmation."


async def test_update_case_assigned_to_persists_as_real_reference(
    client: AsyncClient, superuser_token: str, superuser: User, regular_user: User
):
    """Regression test: `CaseUpdate.model_dump()` was serializing PyObjectId
    fields to plain strings even in Python mode (the ObjectId-annotation's
    `plain_serializer_function_ser_schema` had no `when_used="json"` guard),
    so `update_case()` wrote `assigned_to` back into Mongo as a string.
    Reads then failed to populate it via `get_user_summaries()`'s `_id`
    lookup, silently showing "Unknown User" instead of the real assignee."""
    headers = _auth(superuser_token)
    resp = await client.post("/cases", json=_case_payload(str(superuser.id)), headers=headers)
    case_id = resp.json()["id"]

    resp = await client.patch(
        f"/cases/{case_id}", json={"assignedTo": str(regular_user.id)}, headers=headers
    )
    assert resp.status_code == 200
    assert resp.json()["assignedTo"]["id"] == str(regular_user.id)
    assert resp.json()["assignedTo"]["name"] == "Test Agent"  # not "Unknown User"

    # Re-fetch independently to confirm it's really persisted correctly,
    # not just an artifact of the same request's in-memory response.
    resp = await client.get(f"/cases/{case_id}", headers=headers)
    assert resp.json()["assignedTo"]["name"] == "Test Agent"


async def test_get_case_404(client: AsyncClient, superuser_token: str):
    resp = await client.get("/cases/000000000000000000000000", headers=_auth(superuser_token))
    assert resp.status_code == 404


async def test_closing_status_sets_and_clears_date_of_closure(
    client: AsyncClient, superuser_token: str, superuser: User
):
    """T3.7 — the fallback rule (no status reference data seeded): 'Resolved'
    closes a case, moving off it re-opens it."""
    payload = _case_payload(str(superuser.id), status="Resolved")
    resp = await client.post("/cases", json=payload, headers=_auth(superuser_token))
    assert resp.status_code == 201
    case = resp.json()
    assert case["dateOfClosure"] is not None

    resp = await client.patch(
        f"/cases/{case['id']}", json={"status": "Pending"}, headers=_auth(superuser_token)
    )
    assert resp.status_code == 200
    assert resp.json()["dateOfClosure"] is None

    resp = await client.patch(
        f"/cases/{case['id']}", json={"status": "Resolved"}, headers=_auth(superuser_token)
    )
    assert resp.status_code == 200
    assert resp.json()["dateOfClosure"] is not None


async def test_closing_status_driven_by_reference_data_not_hardcoded(
    client: AsyncClient, superuser_token: str, superuser: User
):
    """T3.7's actual point: closesCase comes from the ReferenceItem, not a
    hardcoded 'Resolved' string check. Seed 'Resolved' as explicitly
    non-closing and confirm the case does NOT get a closure date."""
    now = datetime.now(UTC)
    await database["reference_items"].insert_one(
        {
            "kind": "status",
            "name": "Resolved",
            "value": "Resolved",
            "active": True,
            "order": 0,
            "tone": "good",
            "closes_case": False,
            "created_at": now,
            "updated_at": now,
        }
    )
    payload = _case_payload(str(superuser.id), status="Resolved")
    resp = await client.post("/cases", json=payload, headers=_auth(superuser_token))
    assert resp.status_code == 201
    assert resp.json()["dateOfClosure"] is None


async def test_list_cases_status_filter_comma_separated(
    client: AsyncClient, superuser_token: str, superuser: User
):
    headers = _auth(superuser_token)
    for status in ("Open", "InProgress", "Pending", "Resolved"):
        payload = _case_payload(str(superuser.id), status=status)
        resp = await client.post("/cases", json=payload, headers=headers)
        assert resp.status_code == 201

    resp = await client.get("/cases", params={"status": "Open,InProgress,Pending"}, headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 3
    assert {c["status"] for c in body["items"]} == {"Open", "InProgress", "Pending"}


async def test_list_cases_type_and_assigned_to_filter(
    client: AsyncClient, superuser_token: str, superuser: User, regular_user: User
):
    headers = _auth(superuser_token)
    await client.post(
        "/cases",
        json=_case_payload(str(superuser.id), type="Escalation"),
        headers=headers,
    )
    await client.post(
        "/cases",
        json=_case_payload(str(regular_user.id), type="Support"),
        headers=headers,
    )

    resp = await client.get("/cases", params={"type": "Escalation"}, headers=headers)
    assert resp.json()["total"] == 1

    resp = await client.get("/cases", params={"assignedTo": str(regular_user.id)}, headers=headers)
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["assignedTo"]["id"] == str(regular_user.id)


async def test_list_cases_search(client: AsyncClient, superuser_token: str, superuser: User):
    headers = _auth(superuser_token)
    await client.post(
        "/cases",
        json=_case_payload(str(superuser.id), customer="Travco LLC"),
        headers=headers,
    )
    await client.post(
        "/cases",
        json=_case_payload(str(superuser.id), customer="Almosafer"),
        headers=headers,
    )

    resp = await client.get("/cases", params={"search": "Travco"}, headers=headers)
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["customer"] == "Travco LLC"


async def test_list_cases_search_matches_reporter_name(
    client: AsyncClient, superuser_token: str, superuser: User
):
    headers = _auth(superuser_token)
    await client.post(
        "/cases",
        json=_case_payload(str(superuser.id), reporterName="Ahmed Al Farsi"),
        headers=headers,
    )
    await client.post(
        "/cases",
        json=_case_payload(str(superuser.id), reporterName="Sara Khan"),
        headers=headers,
    )

    resp = await client.get("/cases", params={"search": "Al Farsi"}, headers=headers)
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["reporterName"] == "Ahmed Al Farsi"


async def test_list_cases_pagination(client: AsyncClient, superuser_token: str, superuser: User):
    headers = _auth(superuser_token)
    for _ in range(5):
        resp = await client.post(
            "/cases", json=_case_payload(str(superuser.id)), headers=headers
        )
        assert resp.status_code == 201

    resp = await client.get("/cases", params={"page": 1, "pageSize": 2}, headers=headers)
    body = resp.json()
    assert body["total"] == 5
    assert len(body["items"]) == 2

    resp = await client.get("/cases", params={"page": 3, "pageSize": 2}, headers=headers)
    body = resp.json()
    assert len(body["items"]) == 1


async def test_page_size_over_100_rejected(client: AsyncClient, superuser_token: str):
    resp = await client.get("/cases", params={"pageSize": 101}, headers=_auth(superuser_token))
    assert resp.status_code == 422


async def test_create_case_logs_activity_entry(
    client: AsyncClient, superuser_token: str, superuser: User
):
    """T12.2 — creating a case writes a real system activity entry naming
    the actual assignee, not a hardcoded placeholder."""
    headers = _auth(superuser_token)
    resp = await client.post("/cases", json=_case_payload(str(superuser.id)), headers=headers)
    case_id = resp.json()["id"]

    resp = await client.get(f"/cases/{case_id}/activity", headers=headers)
    assert resp.status_code == 200
    entries = resp.json()
    assert len(entries) == 1
    assert entries[0]["entryType"] == "system"
    assert entries[0]["changeSummary"] == "Case created and assigned to Test Admin"
    assert entries[0]["user"]["id"] == str(superuser.id)


async def test_update_case_logs_diff_entries(
    client: AsyncClient, superuser_token: str, superuser: User, regular_user: User
):
    """T12.2 — status changes, reassignment, and generic field edits each
    produce their own dedicated activity-log entry."""
    headers = _auth(superuser_token)
    resp = await client.post("/cases", json=_case_payload(str(superuser.id)), headers=headers)
    case_id = resp.json()["id"]

    resp = await client.patch(
        f"/cases/{case_id}",
        json={"status": "Pending", "assignedTo": str(regular_user.id), "remarks": "Investigating."},
        headers=headers,
    )
    assert resp.status_code == 200

    resp = await client.get(f"/cases/{case_id}/activity", headers=headers)
    summaries = {e["changeSummary"] for e in resp.json()}
    assert "Status changed from Open to Pending" in summaries
    assert "Reassigned to Test Agent" in summaries
    assert "Remarks updated" in summaries
    # created + 3 diffed changes
    assert len(resp.json()) == 4


async def test_update_case_no_activity_entry_when_nothing_changes(
    client: AsyncClient, superuser_token: str, superuser: User
):
    headers = _auth(superuser_token)
    resp = await client.post("/cases", json=_case_payload(str(superuser.id)), headers=headers)
    case_id = resp.json()["id"]

    resp = await client.patch(
        f"/cases/{case_id}", json={"status": "Open"}, headers=headers
    )
    assert resp.status_code == 200

    resp = await client.get(f"/cases/{case_id}/activity", headers=headers)
    assert len(resp.json()) == 1  # only the creation entry


async def test_post_and_list_case_comment(
    client: AsyncClient, superuser_token: str, superuser: User
):
    headers = _auth(superuser_token)
    resp = await client.post("/cases", json=_case_payload(str(superuser.id)), headers=headers)
    case_id = resp.json()["id"]

    resp = await client.post(
        f"/cases/{case_id}/activity", json={"message": "Called the customer, no answer."}, headers=headers
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["entryType"] == "comment"
    assert body["changeSummary"] == "Called the customer, no answer."
    assert body["user"]["id"] == str(superuser.id)

    resp = await client.get(f"/cases/{case_id}/activity", headers=headers)
    entries = resp.json()
    assert len(entries) == 2  # creation + comment
    assert entries[0]["entryType"] == "comment"  # newest first


async def test_case_activity_requires_auth(client: AsyncClient, superuser_token: str, superuser: User):
    resp = await client.post(
        "/cases", json=_case_payload(str(superuser.id)), headers=_auth(superuser_token)
    )
    case_id = resp.json()["id"]

    resp = await client.get(f"/cases/{case_id}/activity")
    assert resp.status_code == 401


async def test_bug_task_wo_fields_default_empty_then_editable(
    client: AsyncClient, superuser_token: str, superuser: User
):
    """T12.5 — bugNumber/taskNumbers/workOrderNumbers default to
    empty/null on creation and are independently editable via PATCH, with
    task/WO allowing multiple values on the same case."""
    headers = _auth(superuser_token)
    resp = await client.post("/cases", json=_case_payload(str(superuser.id)), headers=headers)
    body = resp.json()
    assert body["bugNumber"] is None
    assert body["taskNumbers"] == []
    assert body["workOrderNumbers"] == []
    case_id = body["id"]

    resp = await client.patch(
        f"/cases/{case_id}",
        json={
            "bugNumber": "BUG-100",
            "taskNumbers": ["TASK-1", "TASK-2"],
            "workOrderNumbers": ["WO-5"],
        },
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["bugNumber"] == "BUG-100"
    assert body["taskNumbers"] == ["TASK-1", "TASK-2"]
    assert body["workOrderNumbers"] == ["WO-5"]

    resp = await client.get(f"/cases/{case_id}", headers=headers)
    body = resp.json()
    assert body["bugNumber"] == "BUG-100"
    assert body["taskNumbers"] == ["TASK-1", "TASK-2"]
    assert body["workOrderNumbers"] == ["WO-5"]


async def test_delete_case_requires_auth(client: AsyncClient, superuser_token: str, superuser: User):
    resp = await client.post(
        "/cases", json=_case_payload(str(superuser.id)), headers=_auth(superuser_token)
    )
    case_id = resp.json()["id"]

    resp = await client.delete(f"/cases/{case_id}")
    assert resp.status_code == 401


async def test_delete_case_soft_deletes_and_hides_from_list_and_get(
    client: AsyncClient, superuser_token: str, superuser: User
):
    """Soft delete (plan-adjacent feature, user-requested after Phase 12):
    the case disappears from list() and get() but the document itself is
    never physically removed — recoverable via direct DB access."""
    headers = _auth(superuser_token)
    resp = await client.post("/cases", json=_case_payload(str(superuser.id)), headers=headers)
    case_id = resp.json()["id"]

    resp = await client.delete(f"/cases/{case_id}", headers=headers)
    assert resp.status_code == 204

    resp = await client.get(f"/cases/{case_id}", headers=headers)
    assert resp.status_code == 404

    resp = await client.get("/cases", headers=headers)
    assert case_id not in [c["id"] for c in resp.json()["items"]]

    doc = await database["cases"].find_one({"_id": ObjectId(case_id)})
    assert doc is not None
    assert doc["deleted"] is True
    assert doc["deleted_at"] is not None
    assert doc["deleted_by"] == superuser.id


async def test_delete_case_404_for_missing_case(client: AsyncClient, superuser_token: str):
    resp = await client.delete("/cases/000000000000000000000000", headers=_auth(superuser_token))
    assert resp.status_code == 404


async def test_delete_case_404_when_already_deleted(
    client: AsyncClient, superuser_token: str, superuser: User
):
    headers = _auth(superuser_token)
    resp = await client.post("/cases", json=_case_payload(str(superuser.id)), headers=headers)
    case_id = resp.json()["id"]

    resp = await client.delete(f"/cases/{case_id}", headers=headers)
    assert resp.status_code == 204

    resp = await client.delete(f"/cases/{case_id}", headers=headers)
    assert resp.status_code == 404


async def test_update_deleted_case_returns_404(
    client: AsyncClient, superuser_token: str, superuser: User
):
    headers = _auth(superuser_token)
    resp = await client.post("/cases", json=_case_payload(str(superuser.id)), headers=headers)
    case_id = resp.json()["id"]

    resp = await client.delete(f"/cases/{case_id}", headers=headers)
    assert resp.status_code == 204

    resp = await client.patch(f"/cases/{case_id}", json={"status": "Pending"}, headers=headers)
    assert resp.status_code == 404


async def test_delete_case_logs_activity_entry(
    client: AsyncClient, superuser_token: str, superuser: User
):
    headers = _auth(superuser_token)
    resp = await client.post("/cases", json=_case_payload(str(superuser.id)), headers=headers)
    case_id = resp.json()["id"]

    resp = await client.delete(f"/cases/{case_id}", headers=headers)
    assert resp.status_code == 204

    entries = await database["activity_log"].find({"case_id": ObjectId(case_id)}).to_list(None)
    summaries = {e["change_summary"] for e in entries}
    assert "Case deleted" in summaries
