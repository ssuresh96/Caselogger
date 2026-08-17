from datetime import UTC, datetime, timedelta

from bson import ObjectId

from app.auth.models import User
from app.auth.service import get_user_by_email
from app.cases.schemas import CaseEmailCreate
from app.cases.service import add_comment, create_case_from_email, find_case_by_conversation_id
from app.core.config import settings
from app.core.database import database
from app.email_agent.classifier import classify_email, is_likely_auto_reply
from app.email_agent.graph_client import GraphClientError, list_new_messages
from app.email_agent.graph_settings import get_graph_settings_doc
from app.email_agent.schemas import EmailAgentRunResult, EmailAgentStatusOut, ProcessedEmailOut

state_collection = database["email_agent_state"]
processed_emails_collection = database["processed_emails"]

# First-ever run has no checkpoint yet — start from an hour back rather than
# the epoch, so a freshly-deployed agent doesn't try to backfill the
# mailbox's entire history.
_DEFAULT_LOOKBACK = timedelta(hours=1)


async def is_configured() -> bool:
    """Graph credentials are admin-entered via `/admin/email-agent/graph-
    settings` (stored in Mongo, not a Render env var — see
    app.email_agent.graph_settings); the Anthropic key and the service
    account are still env-based, same as email_agent_internal_token."""
    graph = await get_graph_settings_doc()
    graph_ready = bool(
        graph
        and graph.get("tenant_id")
        and graph.get("client_id")
        and graph.get("client_secret")
        and graph.get("mailbox")
    )
    return bool(graph_ready and settings.anthropic_api_key and settings.email_agent_service_user_email)


async def _get_state() -> dict:
    doc = await state_collection.find_one({"_id": "state"})
    if doc is None:
        return {"last_polled_at": datetime.now(UTC) - _DEFAULT_LOOKBACK, "assignee_cursor": 0}
    # Motor returns naive datetimes on read (Mongo stores UTC without
    # tzinfo) — normalize before comparing against Graph's aware
    # `receivedDateTime` values below (same gotcha as
    # app/auth/router.py's `_is_locked()`).
    last_polled_at = doc["last_polled_at"]
    if last_polled_at.tzinfo is None:
        last_polled_at = last_polled_at.replace(tzinfo=UTC)
    doc["last_polled_at"] = last_polled_at
    return doc


async def _save_state(last_polled_at: datetime, assignee_cursor: int) -> None:
    await state_collection.update_one(
        {"_id": "state"},
        {"$set": {"last_polled_at": last_polled_at, "assignee_cursor": assignee_cursor}},
        upsert=True,
    )


async def _next_assignee(cursor: int) -> tuple[ObjectId, int]:
    """Round-robin over active users — the plan's documented first pass.
    No per-category ownership/workload data exists yet to do anything
    smarter; `assigned_to` is required on `Case`, so *something* has to be
    picked."""
    users = await User.find(User.is_active == True).sort("+name").to_list()  # noqa: E712
    if not users:
        raise RuntimeError("No active users available to assign an email-created case to")
    user = users[cursor % len(users)]
    return user.id, cursor + 1


async def _record(
    *,
    graph_message_id: str,
    conversation_id: str,
    received_at: datetime,
    outcome: str,
    case_id: ObjectId | None,
    detail: str,
) -> None:
    await processed_emails_collection.insert_one(
        {
            "graph_message_id": graph_message_id,
            "conversation_id": conversation_id,
            "received_at": received_at,
            "outcome": outcome,
            "case_id": case_id,
            "detail": detail,
            "created_at": datetime.now(UTC),
        }
    )


async def run_poll() -> EmailAgentRunResult:
    """One poll cycle — called by `POST /internal/email-agent/run`, which
    the scheduled GitHub Actions workflow triggers every 5-10 minutes.
    Fully automatic: a qualifying email becomes a real case with no
    staging/review step, so every branch below writes a `ProcessedEmail`
    record — that's the only after-the-fact audit trail for a process
    nobody is watching in real time."""
    result = EmailAgentRunResult(checked=0, created=0, appended=0, skipped=0, errors=0)
    if not await is_configured():
        return result

    service_user = await get_user_by_email(settings.email_agent_service_user_email)
    if service_user is None:
        return result

    graph = await get_graph_settings_doc()

    state = await _get_state()
    cursor = state.get("assignee_cursor", 0)
    latest_received = state["last_polled_at"]

    try:
        messages = await list_new_messages(
            state["last_polled_at"],
            tenant_id=graph["tenant_id"],
            client_id=graph["client_id"],
            client_secret=graph["client_secret"],
            mailbox=graph["mailbox"],
        )
    except GraphClientError as exc:
        await _record(
            graph_message_id="",
            conversation_id="",
            received_at=datetime.now(UTC),
            outcome="error",
            case_id=None,
            detail=f"Graph fetch failed: {exc}",
        )
        result.errors += 1
        return result

    for message in messages:
        result.checked += 1
        message_id = message["id"]
        conversation_id = message.get("conversationId", "")
        received_at = datetime.fromisoformat(message["receivedDateTime"].replace("Z", "+00:00"))
        latest_received = max(latest_received, received_at)

        # Idempotency guard — a poll run whose time window overlaps the
        # previous one (or a retried run) must not double-process a message.
        if await processed_emails_collection.find_one({"graph_message_id": message_id}):
            continue

        subject = message.get("subject", "")
        sender_email = message.get("from", {}).get("emailAddress", {}).get("address", "")
        body_text = message.get("body", {}).get("content", "")
        headers = message.get("internetMessageHeaders", [])

        try:
            existing_case = (
                await find_case_by_conversation_id(conversation_id) if conversation_id else None
            )
            if existing_case is not None:
                await add_comment(
                    existing_case.id,
                    f"Email reply from {sender_email}: {body_text[:2000]}",
                    service_user.id,
                )
                await _record(
                    graph_message_id=message_id,
                    conversation_id=conversation_id,
                    received_at=received_at,
                    outcome="appended",
                    case_id=existing_case.id,
                    detail="Appended as a remark to the existing case",
                )
                result.appended += 1
                continue

            if is_likely_auto_reply(subject, headers):
                await _record(
                    graph_message_id=message_id,
                    conversation_id=conversation_id,
                    received_at=received_at,
                    outcome="skipped",
                    case_id=None,
                    detail="Auto-reply header/subject heuristic",
                )
                result.skipped += 1
                continue

            classification = await classify_email(
                subject=subject, body_text=body_text, sender_email=sender_email
            )
            if not classification.should_create_case:
                await _record(
                    graph_message_id=message_id,
                    conversation_id=conversation_id,
                    received_at=received_at,
                    outcome="skipped",
                    case_id=None,
                    detail=classification.reason,
                )
                result.skipped += 1
                continue

            assignee_id, cursor = await _next_assignee(cursor)
            payload = CaseEmailCreate(
                reportedDate=received_at,
                reporterType="Customer",
                reporterName=classification.reporter_name or sender_email,
                customer=classification.customer or sender_email,
                product=classification.product,
                description=classification.description or subject,
                category=classification.category,
                assignedTo=assignee_id,
                status="Open",
                type="Support",
                market=classification.market,
                emailConversationId=conversation_id,
            )
            case = await create_case_from_email(payload, service_user.id)
            await _record(
                graph_message_id=message_id,
                conversation_id=conversation_id,
                received_at=received_at,
                outcome="created",
                case_id=case.id,
                detail=classification.reason,
            )
            result.created += 1
        except Exception as exc:  # noqa: BLE001 — one bad email must not abort the whole run
            await _record(
                graph_message_id=message_id,
                conversation_id=conversation_id,
                received_at=received_at,
                outcome="error",
                case_id=None,
                detail=str(exc),
            )
            result.errors += 1

    await _save_state(latest_received, cursor)
    return result


async def get_status() -> EmailAgentStatusOut:
    state = await state_collection.find_one({"_id": "state"})
    cursor = processed_emails_collection.find().sort("created_at", -1).limit(20)
    recent = [
        ProcessedEmailOut(
            id=doc["_id"],
            graphMessageId=doc["graph_message_id"],
            conversationId=doc["conversation_id"],
            receivedAt=doc["received_at"],
            outcome=doc["outcome"],
            caseId=doc.get("case_id"),
            detail=doc["detail"],
            createdAt=doc["created_at"],
        )
        async for doc in cursor
    ]
    return EmailAgentStatusOut(
        enabled=await is_configured(),
        lastCheckpoint=state.get("last_polled_at") if state else None,
        recent=recent,
    )
