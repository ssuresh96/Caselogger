from datetime import UTC, datetime

from bson import ObjectId
from fastapi import HTTPException, status as http_status

from app.core.database import database
from app.core.rate_limit import rate_limit_delete
from app.reference_data.models import ReferenceKind
from app.reference_data.schemas import ReferenceItemCreate, ReferenceItemOut, ReferenceItemUpdate

reference_items_collection = database["reference_items"]

FALLBACK_CLOSING_STATUS = "Resolved"  # used only if reference data isn't seeded


async def is_closing_status(status_value: str) -> bool:
    """T3.7 — whether a status counts as 'case closed' comes from the
    matching status ReferenceItem's `closesCase` flag, not a hardcoded
    string comparison. Falls back to the original hardcoded value if
    reference data hasn't been seeded (e.g. a fresh dev DB). Public surface
    for other modules (e.g. `cases`) — plan §11 (T11.5)."""
    doc = await reference_items_collection.find_one({"kind": "status", "value": status_value})
    if doc is None:
        return status_value == FALLBACK_CLOSING_STATUS
    return bool(doc.get("closes_case"))


def _to_out(doc: dict) -> ReferenceItemOut:
    return ReferenceItemOut(
        id=doc["_id"],
        kind=doc["kind"],
        name=doc["name"],
        value=doc["value"],
        active=doc["active"],
        order=doc["order"],
        tone=doc.get("tone"),
        closes_case=doc.get("closes_case"),
        allowed_reference_types=doc.get("allowed_reference_types"),
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
    )


async def list_reference_items(kind: ReferenceKind | None, active_only: bool) -> list[ReferenceItemOut]:
    query: dict = {}
    if kind:
        query["kind"] = kind
    if active_only:
        query["active"] = True
    cursor = reference_items_collection.find(query).sort([("kind", 1), ("order", 1)])
    return [_to_out(doc) async for doc in cursor]


async def create_reference_item(payload: ReferenceItemCreate) -> ReferenceItemOut:
    now = datetime.now(UTC)
    doc = payload.model_dump(by_alias=False)
    doc["created_at"] = now
    doc["updated_at"] = now
    result = await reference_items_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _to_out(doc)


async def update_reference_item(item_id: ObjectId, payload: ReferenceItemUpdate) -> ReferenceItemOut:
    existing = await reference_items_collection.find_one({"_id": item_id})
    if existing is None:
        raise HTTPException(http_status.HTTP_404_NOT_FOUND, "Reference item not found")

    updates = payload.model_dump(exclude_unset=True, by_alias=False)
    updates["updated_at"] = datetime.now(UTC)
    await reference_items_collection.update_one({"_id": item_id}, {"$set": updates})
    updated_doc = await reference_items_collection.find_one({"_id": item_id})
    return _to_out(updated_doc)


async def delete_reference_item(item_id: ObjectId, current_user_id: ObjectId) -> None:
    """Hard delete — unlike Case's soft delete, a reference item is just a
    dropdown option (Case stores category/product/etc. as a plain string,
    not a foreign key), so removing it can't orphan a live reference the
    way deleting a user or a case could. Rate-limited per admin per `kind`
    (10/day) as the safety net against a mass-delete mistake, since there's
    no undo."""
    existing = await reference_items_collection.find_one({"_id": item_id})
    if existing is None:
        raise HTTPException(http_status.HTTP_404_NOT_FOUND, "Reference item not found")
    rate_limit_delete(existing["kind"], current_user_id)
    await reference_items_collection.delete_one({"_id": item_id})
