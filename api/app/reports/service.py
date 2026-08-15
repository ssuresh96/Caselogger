from calendar import monthrange
from collections import Counter
from datetime import datetime, UTC

from app.core.database import database
from app.reports.schemas import MixRow, MonthlyReportOut, TeamWorkloadRowOut

cases_collection = database["cases"]
users_collection = database["users"]


def _month_bounds(month: str) -> tuple[datetime, datetime]:
    """'2026-08' -> (2026-08-01T00:00:00Z, 2026-09-01T00:00:00Z)."""
    year, mon = (int(part) for part in month.split("-"))
    start = datetime(year, mon, 1, tzinfo=UTC)
    last_day = monthrange(year, mon)[1]
    end = datetime(year, mon, last_day, 23, 59, 59, 999999, tzinfo=UTC)
    return start, end


def _share_rows(counter: Counter, total: int, top_n: int = 10) -> list[MixRow]:
    if total == 0:
        return []
    return [
        MixRow(label=label, cases=count, share=round(count / total * 100, 1))
        for label, count in counter.most_common(top_n)
    ]


async def get_monthly_report(month: str) -> MonthlyReportOut:
    """Simple Python-side aggregation over the month's cases — expected case
    volumes for this app are modest, so this stays easy to read/verify
    rather than a hand-tuned Mongo `$group` pipeline. Swap for a real
    aggregation pipeline if/when volume ever makes that worthwhile."""
    start, end = _month_bounds(month)
    cursor = cases_collection.find({"reported_date": {"$gte": start, "$lte": end}})
    docs = [doc async for doc in cursor]

    total = len(docs)
    aos_cases = sum(1 for d in docs if d.get("product") == "AOS")
    pending = sum(1 for d in docs if d["status"] == "Pending")
    resolved = sum(1 for d in docs if d["status"] == "Resolved")
    impl_closed = sum(1 for d in docs if d["type"] == "Implementation" and d["status"] == "Resolved")
    deactivations = sum(1 for d in docs if d["type"] == "Deactivation")

    category_counts = Counter(d["category"] for d in docs)
    product_counts = Counter(d["product"] for d in docs)

    return MonthlyReportOut(
        month=month,
        total_cases=total,
        aos_cases=aos_cases,
        aos_share=round(aos_cases / total * 100, 1) if total else 0.0,
        pending=pending,
        close_rate=round(resolved / total * 100, 1) if total else 0.0,
        impl_closed=impl_closed,
        deactivations=deactivations,
        pending_pct=round(pending / total * 100, 1) if total else 0.0,
        category_mix=_share_rows(category_counts, total),
        product_mix=_share_rows(product_counts, total),
    )


async def get_team_workload(month: str) -> list[TeamWorkloadRowOut]:
    start, end = _month_bounds(month)
    cursor = cases_collection.find({"reported_date": {"$gte": start, "$lte": end}})
    docs = [doc async for doc in cursor]

    by_user: dict = {}
    for doc in docs:
        user_id = doc["assigned_to"]
        bucket = by_user.setdefault(user_id, {"assigned": 0, "closed": 0, "pending": 0})
        bucket["assigned"] += 1
        if doc["status"] == "Resolved":
            bucket["closed"] += 1
        elif doc["status"] == "Pending":
            bucket["pending"] += 1

    if not by_user:
        return []

    users_cursor = users_collection.find({"_id": {"$in": list(by_user.keys())}})
    names = {u["_id"]: u["name"] async for u in users_cursor}

    rows = [
        TeamWorkloadRowOut(
            member=names.get(user_id, "Unknown User"),
            assigned=counts["assigned"],
            closed=counts["closed"],
            pending=counts["pending"],
            close_rate=round(counts["closed"] / counts["assigned"] * 100, 1)
            if counts["assigned"]
            else 0.0,
        )
        for user_id, counts in by_user.items()
    ]
    rows.sort(key=lambda r: r.assigned, reverse=True)
    return rows
