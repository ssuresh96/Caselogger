import re
from datetime import UTC, datetime

from bson import ObjectId
from fastapi import HTTPException, status as http_status

from app.auth.schemas import UserSummary
from app.auth.service import get_user_summaries
from app.cases.models import ActivityEntryType
from app.cases.schemas import (
    ActivityEntryOut,
    CaseCreate,
    CaseEmailCreate,
    CaseImportCreate,
    CaseOut,
    CaseUpdate,
)
from app.common.counters import next_case_id
from app.core.database import database
from app.core.rate_limit import rate_limit_delete
from app.reference_data.service import is_closing_status

cases_collection = database["cases"]
activity_log_collection = database["activity_log"]

# Human-readable labels for activity-log diff summaries (plan §12/T12.2).
# `status` and `assigned_to` get their own dedicated phrasing below instead
# of appearing here; anything not listed here (e.g. updated_by/updated_at/
# date_of_closure) is a bookkeeping field, not a user-facing change.
_FIELD_LABELS = {
    "customer": "Customer",
    "product": "Product",
    "category": "Category",
    "description": "Description",
    "market": "Market",
    "type": "Imp/Supp",
    "reporter_type": "Reported By Type",
    "reporter_name": "Reported By Name",
    "remarks": "Remarks",
    "resolution": "Resolution",
    "bug_number": "Bug Number",
    "task_numbers": "Task Numbers",
    "work_order_numbers": "WO Numbers",
}


def _user_ids_in(doc: dict) -> set[ObjectId]:
    return {doc["assigned_to"], doc["created_by"], doc["updated_by"]}


async def _to_case_out(doc: dict, users_map: dict[ObjectId, UserSummary] | None = None) -> CaseOut:
    if users_map is None:
        users_map = await get_user_summaries(_user_ids_in(doc))

    def user_or_unknown(user_id: ObjectId) -> UserSummary:
        return users_map.get(user_id) or UserSummary(id=user_id, name="Unknown User", email="")

    return CaseOut(
        id=doc["_id"],
        case_id=doc["case_id"],
        reported_date=doc["reported_date"],
        reporter_type=doc["reporter_type"],
        reporter_name=doc["reporter_name"],
        customer=doc["customer"],
        product=doc["product"],
        category=doc["category"],
        description=doc["description"],
        assigned_to=user_or_unknown(doc["assigned_to"]),
        status=doc["status"],
        type=doc["type"],
        market=doc.get("market", ""),
        remarks=doc.get("remarks", ""),
        resolution=doc.get("resolution", ""),
        bug_number=doc.get("bug_number"),
        task_numbers=doc.get("task_numbers", []),
        work_order_numbers=doc.get("work_order_numbers", []),
        date_of_closure=doc.get("date_of_closure"),
        linked_implementation_id=doc.get("linked_implementation_id"),
        source=doc.get("source", "manual"),
        email_conversation_id=doc.get("email_conversation_id"),
        created_by=user_or_unknown(doc["created_by"]),
        updated_by=user_or_unknown(doc["updated_by"]),
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
    )


async def list_cases(
    *,
    status_filter: str | None,
    type_filter: str | None = None,
    product_filter: str | None = None,
    search: str | None,
    page: int,
    page_size: int,
    assigned_to: ObjectId | None = None,
    reported_date_from: datetime | None = None,
    reported_date_to: datetime | None = None,
) -> tuple[list[CaseOut], int]:
    query: dict = {"deleted": {"$ne": True}}
    if status_filter:
        # comma-separated list lets callers ask for e.g. "not resolved"
        # (Open,InProgress,Pending) without a dedicated endpoint.
        statuses = [s for s in status_filter.split(",") if s]
        query["status"] = statuses[0] if len(statuses) == 1 else {"$in": statuses}
    if type_filter:
        types = [t for t in type_filter.split(",") if t]
        query["type"] = types[0] if len(types) == 1 else {"$in": types}
    if product_filter:
        products = [p for p in product_filter.split(",") if p]
        query["product"] = products[0] if len(products) == 1 else {"$in": products}
    if assigned_to:
        query["assigned_to"] = assigned_to
    if reported_date_from or reported_date_to:
        date_query: dict = {}
        if reported_date_from:
            date_query["$gte"] = reported_date_from
        if reported_date_to:
            date_query["$lte"] = reported_date_to
        query["reported_date"] = date_query
    if search:
        # Security audit H-1: `search` is user-controlled and was previously
        # passed straight into $regex, letting a caller inject regex syntax
        # (unintended wildcard/anchor semantics, and — at larger data volumes
        # than today's — a ReDoS vector via catastrophic backtracking).
        # re.escape() makes it a literal substring match, same as any user
        # would expect "search" to behave, while closing that off.
        escaped = re.escape(search)
        query["$or"] = [
            {"case_id": {"$regex": escaped, "$options": "i"}},
            {"customer": {"$regex": escaped, "$options": "i"}},
            {"description": {"$regex": escaped, "$options": "i"}},
            {"reporter_name": {"$regex": escaped, "$options": "i"}},
        ]

    total = await cases_collection.count_documents(query)
    cursor = (
        cases_collection.find(query)
        .sort("reported_date", -1)
        .skip((page - 1) * page_size)
        .limit(page_size)
    )
    docs = [doc async for doc in cursor]

    all_user_ids: set[ObjectId] = set()
    for doc in docs:
        all_user_ids |= _user_ids_in(doc)
    users_map = await get_user_summaries(all_user_ids)

    items = [await _to_case_out(doc, users_map) for doc in docs]
    return items, total


async def get_case(case_id: ObjectId) -> CaseOut:
    doc = await cases_collection.find_one({"_id": case_id})
    if doc is None or doc.get("deleted"):
        raise HTTPException(http_status.HTTP_404_NOT_FOUND, "Case not found")
    return await _to_case_out(doc)


async def create_case(payload: CaseCreate, current_user_id: ObjectId) -> CaseOut:
    now = datetime.now(UTC)
    is_closing = await is_closing_status(payload.status)
    doc = {
        "case_id": await next_case_id(),
        "reported_date": payload.reported_date,
        "reporter_type": payload.reporter_type,
        "reporter_name": payload.reporter_name,
        "customer": payload.customer,
        "product": payload.product,
        "category": payload.category,
        "description": payload.description,
        "assigned_to": payload.assigned_to,
        "status": payload.status,
        "type": payload.type,
        "market": "",
        "remarks": "",
        "resolution": "",
        "bug_number": None,
        "task_numbers": [],
        "work_order_numbers": [],
        "date_of_closure": now if is_closing else None,
        "linked_implementation_id": None,
        "source": "manual",
        "email_conversation_id": None,
        "created_by": current_user_id,
        "updated_by": current_user_id,
        "created_at": now,
        "updated_at": now,
        "deleted": False,
        "deleted_at": None,
        "deleted_by": None,
    }
    result = await cases_collection.insert_one(doc)
    doc["_id"] = result.inserted_id

    assignee_map = await get_user_summaries({payload.assigned_to})
    assignee = assignee_map.get(payload.assigned_to)
    await _log_activity(
        doc["_id"],
        current_user_id,
        f"Case created and assigned to {assignee.name if assignee else 'Unknown User'}",
    )

    return await _to_case_out(doc)


async def create_case_from_import(payload: CaseImportCreate, current_user_id: ObjectId) -> CaseOut:
    """Historical-data import (plan §13) — like `create_case()` but carries
    the fuller `CaseImportCreate` payload (market/remarks/resolution/Bug/
    Task/WO up front) since imported rows have no later edit-form step."""
    now = datetime.now(UTC)
    is_closing = await is_closing_status(payload.status)
    doc = {
        "case_id": await next_case_id(),
        "reported_date": payload.reported_date,
        "reporter_type": payload.reporter_type,
        "reporter_name": payload.reporter_name,
        "customer": payload.customer,
        "product": payload.product,
        "category": payload.category,
        "description": payload.description,
        "assigned_to": payload.assigned_to,
        "status": payload.status,
        "type": payload.type,
        "market": payload.market,
        "remarks": payload.remarks,
        "resolution": payload.resolution,
        "bug_number": payload.bug_number,
        "task_numbers": payload.task_numbers,
        "work_order_numbers": payload.work_order_numbers,
        "date_of_closure": now if is_closing else None,
        "linked_implementation_id": None,
        "source": "import",
        "email_conversation_id": None,
        "created_by": current_user_id,
        "updated_by": current_user_id,
        "created_at": now,
        "updated_at": now,
        "deleted": False,
        "deleted_at": None,
        "deleted_by": None,
    }
    result = await cases_collection.insert_one(doc)
    doc["_id"] = result.inserted_id

    assignee_map = await get_user_summaries({payload.assigned_to})
    assignee = assignee_map.get(payload.assigned_to)
    await _log_activity(
        doc["_id"],
        current_user_id,
        f"Case created and assigned to {assignee.name if assignee else 'Unknown User'} (imported)",
    )

    return await _to_case_out(doc)


async def create_case_from_email(payload: CaseEmailCreate, current_user_id: ObjectId) -> CaseOut:
    """Email agent (plan: email-to-case), new-case path — like
    `create_case_from_import()` but stamps `source="email"` and
    `email_conversation_id` so a later reply on the same Microsoft Graph
    thread can be matched back to this case via `find_case_by_conversation_id()`
    instead of creating a duplicate. `current_user_id` is the email agent's
    own service-account user (see `app.email_agent`), not a human."""
    now = datetime.now(UTC)
    is_closing = await is_closing_status(payload.status)
    doc = {
        "case_id": await next_case_id(),
        "reported_date": payload.reported_date,
        "reporter_type": payload.reporter_type,
        "reporter_name": payload.reporter_name,
        "customer": payload.customer,
        "product": payload.product,
        "category": payload.category,
        "description": payload.description,
        "assigned_to": payload.assigned_to,
        "status": payload.status,
        "type": payload.type,
        "market": payload.market,
        "remarks": "",
        "resolution": "",
        "bug_number": None,
        "task_numbers": [],
        "work_order_numbers": [],
        "date_of_closure": now if is_closing else None,
        "linked_implementation_id": None,
        "source": "email",
        "email_conversation_id": payload.email_conversation_id,
        "created_by": current_user_id,
        "updated_by": current_user_id,
        "created_at": now,
        "updated_at": now,
        "deleted": False,
        "deleted_at": None,
        "deleted_by": None,
    }
    result = await cases_collection.insert_one(doc)
    doc["_id"] = result.inserted_id

    assignee_map = await get_user_summaries({payload.assigned_to})
    assignee = assignee_map.get(payload.assigned_to)
    await _log_activity(
        doc["_id"],
        current_user_id,
        f"Case created and assigned to {assignee.name if assignee else 'Unknown User'} (from an inbound email)",
    )

    return await _to_case_out(doc)


async def find_case_by_conversation_id(conversation_id: str) -> CaseOut | None:
    """Email agent reply-detection — plan: email-to-case. A hit means the
    new email is a reply to a thread that already produced a case, so it
    should be appended via `add_comment()` rather than creating a
    duplicate. Deleted cases are excluded like everywhere else."""
    doc = await cases_collection.find_one(
        {"email_conversation_id": conversation_id, "deleted": {"$ne": True}}
    )
    return await _to_case_out(doc) if doc else None


async def update_case(case_id: ObjectId, payload: CaseUpdate, current_user_id: ObjectId) -> CaseOut:
    existing = await cases_collection.find_one({"_id": case_id})
    if existing is None or existing.get("deleted"):
        raise HTTPException(http_status.HTTP_404_NOT_FOUND, "Case not found")

    updates = payload.model_dump(exclude_unset=True, by_alias=False)
    now = datetime.now(UTC)
    updates["updated_by"] = current_user_id
    updates["updated_at"] = now

    new_status = updates.get("status", existing["status"])
    was_closing = await is_closing_status(existing["status"])
    is_closing = await is_closing_status(new_status)
    if is_closing and not was_closing:
        updates["date_of_closure"] = now
    elif not is_closing and was_closing:
        updates["date_of_closure"] = None

    await _log_update_diff(case_id, current_user_id, existing, updates)

    await cases_collection.update_one({"_id": case_id}, {"$set": updates})
    updated_doc = await cases_collection.find_one({"_id": case_id})
    return await _to_case_out(updated_doc)


async def delete_case(case_id: ObjectId, current_user_id: ObjectId) -> None:
    """Soft delete — the case is hidden from `list_cases()`/`get_case()`
    but never physically removed, so a mistaken delete stays recoverable.
    Rate-limited 10/day per user (security audit M-2) — same protection
    already applied to reference-data delete, closing the gap where a
    compromised or careless account could script through the whole backlog
    with no cap at all."""
    existing = await cases_collection.find_one({"_id": case_id})
    if existing is None or existing.get("deleted"):
        raise HTTPException(http_status.HTTP_404_NOT_FOUND, "Case not found")
    rate_limit_delete("case", current_user_id)

    now = datetime.now(UTC)
    await cases_collection.update_one(
        {"_id": case_id},
        {"$set": {"deleted": True, "deleted_at": now, "deleted_by": current_user_id}},
    )
    await _log_activity(case_id, current_user_id, "Case deleted")


# --- Activity log (plan §12/Part A) ---


async def _log_activity(
    case_id: ObjectId,
    user_id: ObjectId,
    change_summary: str,
    entry_type: ActivityEntryType = "system",
) -> None:
    await activity_log_collection.insert_one(
        {
            "case_id": case_id,
            "user_id": user_id,
            "entry_type": entry_type,
            "change_summary": change_summary,
            "created_at": datetime.now(UTC),
        }
    )


async def _log_update_diff(case_id: ObjectId, user_id: ObjectId, existing: dict, updates: dict) -> None:
    """One activity entry per changed field, diffed against the pre-update
    document — plan §12/T12.2. Skips bookkeeping fields (updated_by/
    updated_at/date_of_closure) since those aren't user-facing changes."""
    for field, new_value in updates.items():
        if field in ("updated_by", "updated_at", "date_of_closure"):
            continue
        if existing.get(field) == new_value:
            continue
        if field == "status":
            await _log_activity(
                case_id, user_id, f"Status changed from {existing.get(field)} to {new_value}"
            )
        elif field == "assigned_to":
            names = await get_user_summaries({new_value})
            new_assignee = names.get(new_value)
            await _log_activity(
                case_id, user_id, f"Reassigned to {new_assignee.name if new_assignee else 'Unknown User'}"
            )
        elif field in _FIELD_LABELS:
            await _log_activity(case_id, user_id, f"{_FIELD_LABELS[field]} updated")


async def list_activity(case_id: ObjectId) -> list[ActivityEntryOut]:
    cursor = activity_log_collection.find({"case_id": case_id}).sort("created_at", -1)
    docs = [doc async for doc in cursor]

    user_ids = {doc["user_id"] for doc in docs}
    users_map = await get_user_summaries(user_ids)

    def user_or_unknown(user_id: ObjectId) -> UserSummary:
        return users_map.get(user_id) or UserSummary(id=user_id, name="Unknown User", email="")

    return [
        ActivityEntryOut(
            id=doc["_id"],
            case_id=doc["case_id"],
            user=user_or_unknown(doc["user_id"]),
            entry_type=doc["entry_type"],
            change_summary=doc["change_summary"],
            created_at=doc["created_at"],
        )
        for doc in docs
    ]


async def add_comment(case_id: ObjectId, message: str, user_id: ObjectId) -> ActivityEntryOut:
    case = await cases_collection.find_one({"_id": case_id})
    if case is None:
        raise HTTPException(http_status.HTTP_404_NOT_FOUND, "Case not found")

    now = datetime.now(UTC)
    doc = {
        "case_id": case_id,
        "user_id": user_id,
        "entry_type": "comment",
        "change_summary": message,
        "created_at": now,
    }
    result = await activity_log_collection.insert_one(doc)
    doc["_id"] = result.inserted_id

    users_map = await get_user_summaries({user_id})
    user = users_map.get(user_id) or UserSummary(id=user_id, name="Unknown User", email="")
    return ActivityEntryOut(
        id=doc["_id"],
        case_id=case_id,
        user=user,
        entry_type="comment",
        change_summary=message,
        created_at=now,
    )
