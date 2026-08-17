from datetime import UTC, datetime

import pytest
import pytest_asyncio

from app.auth.manager import get_user_db, get_user_manager
from app.auth.models import User
from app.auth.schemas import UserCreate
from app.cases.schemas import CaseEmailCreate
from app.cases.service import cases_collection, create_case_from_email, list_activity
from app.core.config import settings
from app.email_agent import service
from app.email_agent.classifier import ClassificationResult
from app.email_agent.graph_settings import graph_settings_collection

_SERVICE_USER_EMAIL = "email-agent@test.caselogger.internal"


def _message(msg_id, conversation_id, subject, body, sender, received="2026-08-17T10:00:00Z", headers=None):
    return {
        "id": msg_id,
        "conversationId": conversation_id,
        "subject": subject,
        "from": {"emailAddress": {"address": sender}},
        "body": {"content": body},
        "receivedDateTime": received,
        "internetMessageHeaders": headers or [],
    }


@pytest_asyncio.fixture
async def service_user() -> User:
    async for user_db in get_user_db():
        async for user_manager in get_user_manager(user_db):
            return await user_manager.create(
                UserCreate(email=_SERVICE_USER_EMAIL, password="AgentBotPass123!", name="Email Agent")
            )


@pytest_asyncio.fixture
async def configured(monkeypatch):
    # Anthropic key + service account stay env-based; Graph credentials are
    # admin-entered via /admin/email-agent/graph-settings (DB-backed) — see
    # app/email_agent/graph_settings.py.
    monkeypatch.setattr(settings, "anthropic_api_key", "sk-test")
    monkeypatch.setattr(settings, "email_agent_service_user_email", _SERVICE_USER_EMAIL)
    await graph_settings_collection.update_one(
        {"_id": "settings"},
        {
            "$set": {
                "tenant_id": "tenant",
                "client_id": "client",
                "client_secret": "secret",
                "mailbox": "support@test.caselogger.internal",
            }
        },
        upsert=True,
    )


async def test_run_poll_noop_when_not_configured(monkeypatch):
    called = False

    async def _fail(_since, **_kwargs):
        nonlocal called
        called = True
        return []

    monkeypatch.setattr("app.email_agent.service.list_new_messages", _fail)

    result = await service.run_poll()

    assert result.checked == 0
    assert called is False


async def test_run_poll_creates_case_for_valid_email(
    configured, service_user: User, regular_user: User, monkeypatch
):
    msg = _message("m1", "conv-1", "Login broken", "I can't log in", "customer@acme.com")

    async def _list(_since, **_kwargs):
        return [msg]

    async def _classify(**_kwargs):
        return ClassificationResult(
            should_create_case=True,
            reason="Actionable support request",
            customer="Acme",
            product="CaseLogger",
            category="Support",
            description="Cannot log in",
            reporter_name="Jane",
            market="",
        )

    monkeypatch.setattr("app.email_agent.service.list_new_messages", _list)
    monkeypatch.setattr("app.email_agent.service.classify_email", _classify)
    monkeypatch.setattr("app.email_agent.service.is_likely_auto_reply", lambda *a, **kw: False)

    result = await service.run_poll()

    assert result.checked == 1
    assert result.created == 1
    assert result.skipped == 0
    assert result.errors == 0

    case = await cases_collection.find_one({"email_conversation_id": "conv-1"})
    assert case is not None
    assert case["source"] == "email"
    assert case["customer"] == "Acme"
    assert case["created_by"] == service_user.id

    activity = await list_activity(case["_id"])
    assert any("inbound email" in e.change_summary for e in activity)


async def test_run_poll_skips_when_classifier_declines(
    configured, service_user: User, regular_user: User, monkeypatch
):
    msg = _message("m2", "conv-2", "Weekly newsletter", "Check out our new features!", "marketing@vendor.com")

    async def _list(_since, **_kwargs):
        return [msg]

    async def _classify(**_kwargs):
        return ClassificationResult(should_create_case=False, reason="Marketing newsletter, not a support request")

    monkeypatch.setattr("app.email_agent.service.list_new_messages", _list)
    monkeypatch.setattr("app.email_agent.service.classify_email", _classify)
    monkeypatch.setattr("app.email_agent.service.is_likely_auto_reply", lambda *a, **kw: False)

    result = await service.run_poll()

    assert result.skipped == 1
    assert result.created == 0
    assert await cases_collection.count_documents({}) == 0


async def test_run_poll_skips_auto_reply_without_calling_classifier(
    configured, service_user: User, regular_user: User, monkeypatch
):
    msg = _message(
        "m3", "conv-3", "Automatic reply: Out of Office", "I am away", "person@acme.com",
        headers=[{"name": "Auto-Submitted", "value": "auto-replied"}],
    )

    async def _list(_since, **_kwargs):
        return [msg]

    async def _classify(**_kwargs):
        raise AssertionError("classifier must not be called for an auto-reply")

    monkeypatch.setattr("app.email_agent.service.list_new_messages", _list)
    monkeypatch.setattr("app.email_agent.service.classify_email", _classify)

    result = await service.run_poll()

    assert result.skipped == 1
    assert result.created == 0


async def test_run_poll_appends_reply_to_existing_case_instead_of_duplicating(
    configured, service_user: User, regular_user: User, monkeypatch
):
    existing = await create_case_from_email(
        CaseEmailCreate(
            reportedDate=datetime.now(UTC),
            reporterType="Customer",
            reporterName="Jane",
            customer="Acme",
            product="CaseLogger",
            description="Cannot log in",
            category="Support",
            assignedTo=regular_user.id,
            status="Open",
            type="Support",
            market="",
            emailConversationId="conv-4",
        ),
        service_user.id,
    )

    msg = _message("m4", "conv-4", "Re: Login broken", "Still broken, any update?", "customer@acme.com")

    async def _list(_since, **_kwargs):
        return [msg]

    async def _classify(**_kwargs):
        raise AssertionError("classifier must not be called for a reply on an already-logged thread")

    monkeypatch.setattr("app.email_agent.service.list_new_messages", _list)
    monkeypatch.setattr("app.email_agent.service.classify_email", _classify)
    monkeypatch.setattr("app.email_agent.service.is_likely_auto_reply", lambda *a, **kw: False)

    result = await service.run_poll()

    assert result.appended == 1
    assert result.created == 0
    assert await cases_collection.count_documents({}) == 1

    activity = await list_activity(existing.id)
    assert any("Still broken" in e.change_summary for e in activity)


async def test_run_poll_is_idempotent_across_overlapping_runs(
    configured, service_user: User, regular_user: User, monkeypatch
):
    msg = _message("m5", "conv-5", "Cannot export report", "Export button does nothing", "customer@acme.com")

    async def _list(_since, **_kwargs):
        return [msg]  # simulates the same message appearing in two overlapping poll windows

    async def _classify(**_kwargs):
        return ClassificationResult(
            should_create_case=True, reason="ok", customer="Acme", product="CaseLogger",
            category="Support", description="Export is broken", reporter_name="Jane", market="",
        )

    monkeypatch.setattr("app.email_agent.service.list_new_messages", _list)
    monkeypatch.setattr("app.email_agent.service.classify_email", _classify)
    monkeypatch.setattr("app.email_agent.service.is_likely_auto_reply", lambda *a, **kw: False)

    first = await service.run_poll()
    second = await service.run_poll()

    assert first.created == 1
    assert second.created == 0  # already recorded by graph_message_id — not reprocessed
    assert await cases_collection.count_documents({}) == 1


async def test_run_email_agent_endpoint_requires_internal_token(client, configured):
    resp = await client.post("/internal/email-agent/run")
    assert resp.status_code == 401

    resp = await client.post("/internal/email-agent/run", headers={"X-Internal-Token": "wrong"})
    assert resp.status_code == 401


async def test_run_email_agent_endpoint_accepts_correct_token(client, monkeypatch):
    monkeypatch.setattr(settings, "email_agent_internal_token", "secret-token")

    resp = await client.post(
        "/internal/email-agent/run", headers={"X-Internal-Token": "secret-token"}
    )

    assert resp.status_code == 200
    assert resp.json()["checked"] == 0  # not configured beyond the token — no-op, not an error


# --- Admin-entered Graph settings (frontend-managed, not a Render env var) ---


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_graph_settings_requires_auth(client):
    resp = await client.get("/admin/email-agent/graph-settings")
    assert resp.status_code == 401


async def test_graph_settings_requires_superuser(client, regular_user_token: str):
    resp = await client.get("/admin/email-agent/graph-settings", headers=_auth(regular_user_token))
    assert resp.status_code == 403

    resp = await client.put(
        "/admin/email-agent/graph-settings",
        json={"tenantId": "t"},
        headers=_auth(regular_user_token),
    )
    assert resp.status_code == 403


async def test_graph_settings_empty_by_default(client, superuser_token: str):
    resp = await client.get("/admin/email-agent/graph-settings", headers=_auth(superuser_token))
    assert resp.status_code == 200
    body = resp.json()
    assert body["tenantId"] == ""
    assert body["hasClientSecret"] is False
    assert "clientSecret" not in body  # the raw secret must never round-trip to the client


async def test_graph_settings_update_and_read_back(client, superuser_token: str):
    resp = await client.put(
        "/admin/email-agent/graph-settings",
        json={
            "tenantId": "tenant-123",
            "clientId": "client-456",
            "clientSecret": "super-secret-value",
            "mailbox": "support@amadeus.ae",
        },
        headers=_auth(superuser_token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["tenantId"] == "tenant-123"
    assert body["clientId"] == "client-456"
    assert body["mailbox"] == "support@amadeus.ae"
    assert body["hasClientSecret"] is True
    assert "clientSecret" not in body

    resp = await client.get("/admin/email-agent/graph-settings", headers=_auth(superuser_token))
    assert resp.json()["tenantId"] == "tenant-123"


async def test_graph_settings_blank_secret_leaves_existing_value_unchanged(
    client, superuser_token: str
):
    await client.put(
        "/admin/email-agent/graph-settings",
        json={"tenantId": "t1", "clientId": "c1", "clientSecret": "original-secret", "mailbox": "a@b.com"},
        headers=_auth(superuser_token),
    )

    # Re-saving without a new secret (e.g. just editing the mailbox) must not
    # wipe the previously-stored one.
    resp = await client.put(
        "/admin/email-agent/graph-settings",
        json={"tenantId": "t1", "clientId": "c1", "mailbox": "new-mailbox@b.com"},
        headers=_auth(superuser_token),
    )
    assert resp.status_code == 200
    assert resp.json()["hasClientSecret"] is True
    assert resp.json()["mailbox"] == "new-mailbox@b.com"

    stored = await graph_settings_collection.find_one({"_id": "settings"})
    assert stored["client_secret"] == "original-secret"
