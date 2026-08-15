"""Seed the starting Products/Categories/Markets/Statuses/Types — plan T3.2.
Safe to re-run: skips any (kind, value) pair that already exists.

Usage:
    venv/Scripts/python.exe scripts/seed_reference_data.py
"""

import asyncio
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import database, init_db  # noqa: E402

STATUSES = [
    {"name": "Open", "value": "Open", "tone": "info", "closes_case": False},
    {"name": "In Progress", "value": "InProgress", "tone": "progress", "closes_case": False},
    {"name": "Pending", "value": "Pending", "tone": "warning", "closes_case": False},
    {"name": "Resolved", "value": "Resolved", "tone": "good", "closes_case": True},
]

TYPES = [
    {"name": "Support", "value": "Support", "tone": "info"},
    {"name": "Implementation", "value": "Implementation", "tone": "progress"},
    {"name": "Deactivation", "value": "Deactivation", "tone": "serious"},
    {"name": "Escalation", "value": "Escalation", "tone": "critical"},
]

CATEGORIES = [
    # "Other Support Cases" only offers Workorder (plan §12/T12.7); every
    # other category defaults to all three (allowed_reference_types=None).
    {"name": "Other Support Cases", "allowed_reference_types": ["Workorder"]},
    {"name": "AOS-Queries"},
    {"name": "AOS Dev BUG"},
    {"name": "AOS-General Support"},
    {"name": "AOS-How to do"},
    {"name": "AOS-Customer Config Mismatch"},
    {"name": "AOS-Training"},
    {"name": "AOS-Task"},
    {"name": "AOS-Payment Gateway"},
    {"name": "AOS-Ticket Pending"},
    {"name": "AOS-User Deactivated"},
]

PRODUCTS = ["AOS", "AQC", "CDSR", "FO", "MPE", "RPP", "AVH"]

MARKETS = ["UAE", "Saudi Arabia", "Nigeria", "Kenya", "Egypt", "Qatar", "Oman"]


async def upsert(kind: str, name: str, value: str, order: int, **extra) -> None:
    collection = database["reference_items"]
    now = datetime.now(UTC)
    existing = await collection.find_one({"kind": kind, "value": value})
    if existing:
        # Still patch allowed_reference_types if this run wants to narrow it
        # (e.g. "Other Support Cases" on a DB seeded before T12.7) — every
        # other field on an existing doc is left as admin-edited state.
        if "allowed_reference_types" in extra and existing.get("allowed_reference_types") != extra["allowed_reference_types"]:
            await collection.update_one(
                {"_id": existing["_id"]},
                {"$set": {"allowed_reference_types": extra["allowed_reference_types"], "updated_at": now}},
            )
            print(f"  updated {kind}/{value} allowedReferenceTypes -> {extra['allowed_reference_types']}")
        else:
            print(f"  skip {kind}/{value} (already exists)")
        return
    await collection.insert_one(
        {
            "kind": kind,
            "name": name,
            "value": value,
            "active": True,
            "order": order,
            "tone": extra.get("tone"),
            "closes_case": extra.get("closes_case"),
            "allowed_reference_types": extra.get("allowed_reference_types"),
            "created_at": now,
            "updated_at": now,
        }
    )
    print(f"  created {kind}/{value}")


async def main() -> None:
    await init_db()

    print("Statuses:")
    for i, s in enumerate(STATUSES):
        await upsert("status", s["name"], s["value"], i, tone=s["tone"], closes_case=s["closes_case"])

    print("Types:")
    for i, t in enumerate(TYPES):
        await upsert("type", t["name"], t["value"], i, tone=t["tone"])

    print("Categories:")
    for i, c in enumerate(CATEGORIES):
        await upsert(
            "category", c["name"], c["name"], i, allowed_reference_types=c.get("allowed_reference_types")
        )

    print("Products:")
    for i, p in enumerate(PRODUCTS):
        await upsert("product", p, p, i)

    print("Markets:")
    for i, m in enumerate(MARKETS):
        await upsert("market", m, m, i)


if __name__ == "__main__":
    asyncio.run(main())
