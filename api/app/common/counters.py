from datetime import UTC, datetime

from pymongo import ReturnDocument

from app.core.database import database

counters_collection = database["counters"]


async def next_case_id() -> str:
    """Atomically increments the `caseId` counter and formats it as
    CASE-<year>-<6-digit sequence>, matching the existing Angular mock's ID
    shape (plan §3.5)."""
    doc = await counters_collection.find_one_and_update(
        {"_id": "caseId"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    year = datetime.now(UTC).year
    return f"CASE-{year}-{doc['seq']:06d}"
