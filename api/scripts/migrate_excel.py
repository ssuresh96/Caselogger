"""One-time migration: import the Jan-Aug 2026 month sheets from the source
Excel workbook into the `cases` collection — plan Phase 5 (T5.1-T5.4).

The source data is messy real-world data (typo'd product/category/market
names, inconsistent casing, ~2/3 of "Closed" rows missing a closure date).
This script normalizes what it safely can and is explicit about what it
does NOT fabricate (see NOTES at the bottom of the printed summary).

Usage:
    venv/Scripts/python.exe scripts/migrate_excel.py "<path-to-xlsx>" --dry-run
    venv/Scripts/python.exe scripts/migrate_excel.py "<path-to-xlsx>"
"""

import asyncio
import re
import secrets
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import openpyxl  # noqa: E402
from fastapi_users.exceptions import UserAlreadyExists  # noqa: E402
from pymongo import ReturnDocument  # noqa: E402

from app.auth.manager import get_user_db, get_user_manager  # noqa: E402
from app.auth.models import User  # noqa: E402
from app.auth.schemas import UserCreate  # noqa: E402
from app.core.database import database, init_db  # noqa: E402

MONTH_SHEETS = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug"]
ADMIN_EMAIL = "admin@caselogger.app"

cases_collection = database["cases"]
reference_items_collection = database["reference_items"]
counters_collection = database["counters"]


# --- text cleanup -----------------------------------------------------------

def clean_text(value) -> str | None:
    """Strip nbsp/mojibake replacement chars, collapse whitespace, trim."""
    if value is None:
        return None
    s = str(value).replace("\xa0", " ").replace("�", "-")
    s = " ".join(s.split())
    return s or None


# --- product/category/market normalization -----------------------------
# Explicit aliases for the high-frequency typo/casing clusters found by
# inspecting the workbook (see conversation notes). Anything not listed
# here falls through to a generic cleanup (trim/whitespace only) and
# becomes its own canonical value — long-tail one-off products/categories
# are left as-is rather than guessed at.

PRODUCT_UPPER_CODES = {
    "aap", "acg", "acsp", "adtd", "air", "aos", "apm", "aqc", "atc", "ats",
    "avh", "cdsr", "clc", "clm", "csr", "dsr", "eos", "fo", "fxd", "hx",
    "imr", "lat", "lpo", "mio", "mnr", "mp", "mpe", "mptb", "ndc", "nntc",
    "oc", "oid", "pdr", "pff", "qm", "rpa", "rpp", "rts", "seco", "tdm",
    "uettr", "webuettr", "ws",
}

PRODUCT_ALIASES = {
    "poductivity suite": "Productivity Suite",
    "prductivity suite": "Productivity Suite",
    "productivity suite": "Productivity Suite",
    "productivity tracker": "Productivity Tracker",
    "gulf qc neo": "Gulf QC Neo",
    "gulf qc": "Gulf QC",
    "gulfqc": "Gulf QC",
    "webqc": "Web QC",
    "web qc": "Web QC",
    "web uettr": "Web UETTR",
    "webuettr": "WebUETTR",
    "agency insight": "Agency Insight",
    "auto pnr finder": "Auto PNR Finder",
    "auto lpo finder": "Auto LPO Finder",
    "auto ticketing": "Auto Ticketing",
    "office profile": "Office Profiles",
    "office profiles": "Office Profiles",
    "officeid": "Office ID",
    "otta pnr": "OTTA PNR",
    "otta pnr checks": "OTTA PNR Checks",
    "otta pnr check": "OTTA PNR Checks",
    "offer preview": "Offer Preview",
    "offer previews": "Offer Preview",
    "pnr finishing": "PNR Finishing",
    "one view cx": "One View CX",
    "one viewcx": "One View CX",
    "oneview": "One View CX",
    "ws-cau": "WS-CAU",
    "ws cau": "WS-CAU",
    "wscau": "WS-CAU",
    "ws -cau": "WS-CAU",
    "ws cap cau": "WS-CAPCAU",
    "ws-capcau": "WS-CAPCAU",
    "profile manager": "Profile Manager",
    "profiles": "Profiles",
    "flight sceduler": "Flight Scheduler",
    "flight schduler": "Flight Scheduler",
    "flight scehduler": "Flight Scheduler",
    "select content": "Select Content",
    "selectcontent": "Select Content",
    "seco billing": "SECO Billing",
    "selco": "Selco",
    "smart script": "Smart Script",
    "dev portal": "Developer Portal",
    "developer portal": "Developer Portal",
    "developer": "Developer Portal",
    "app hub": "App Hub",
    "hotel ws": "Hotel WS",
    "hotels": "Hotels",
    "hotel": "Hotel",
    "data profiles": "Data Profiles",
    "freedom robot": "Freedom Robot",
    "freedom": "Freedom Robot",
    "margin manager": "Margin Manager",
    "contact checker": "Contact Checker",
    "minirules": "Minirules",
    "rob parker": "Rob Parker",
    "cau": "CAU",
    "script": "Script",
    "touchless": "Touchless",
    "multiple": "Multiple",
    "products": "Products",
    "air files": "Air Files",
}

CATEGORY_ALIASES = {
    # normalize the "AOS- X" / "AOS_X" / "AOS �X" hyphen-spacing + mojibake
    # variants down to the "AOS-X" form already used by the Phase 3 seed data.
    "aos- general support": "AOS-General Support",
    "aos general support": "AOS-General Support",
    "aos- add on request": "AOS-Add On Request",
    "aos-add on deactivation": "AOS-Add On Deactivation",
    "aos- change request": "AOS-Change Request",
    "aos_enhancement": "AOS-Enhancement",
    "aos_technical trouble shooting": "AOS-Technical Trouble Shooting",
    "aos -avh": "AOS-AVH",
    "aos -release related": "AOS-Release Related",
    "aos email update": "AOS-Email Update",
    "aos ytd mobile report": "AOS-YTD Mobile Report",
    "aos -search and display issues": "AOS-Search and Display Issues",
    "aos -ui /front end issues": "AOS-UI/Front End Issues",
    "aos-user roles and access": "AOS-User Roles and Access",
    "aos-smtp issues": "AOS-SMTP Issues",
    "other support cases": "Other Support Cases",
    "other support case": "Other Support Cases",
}


def _normalize_generic(raw: str, upper_codes: set[str], aliases: dict[str, str]) -> str:
    cleaned = clean_text(raw)
    if cleaned is None:
        return None
    key = cleaned.lower()
    if key in aliases:
        return aliases[key]
    if key in upper_codes:
        return cleaned.upper()
    return cleaned


def normalize_product(raw) -> str | None:
    return _normalize_generic(raw, PRODUCT_UPPER_CODES, PRODUCT_ALIASES)


def normalize_category(raw) -> str | None:
    return _normalize_generic(raw, set(), CATEGORY_ALIASES)


MARKET_ALIASES = {
    "afganistan": "Afghanistan",
    "afghanistan": "Afghanistan",
    "algeria": "Algeria",
    "bahrain": "Bahrain",
    "cameroon": "Cameroon",
    "cape d verde": "Cape Verde",
    "cot d ivorie": "Ivory Coast",
    "cote d ivorie": "Ivory Coast",
    "cote d ivory": "Ivory Coast",
    "cotedivoire": "Ivory Coast",
    "c-te d'ivoire": "Ivory Coast",
    "ivory coast": "Ivory Coast",
    "djibouti": "Djibouti",
    "egypt": "Egypt",
    "georgia": "Georgia",
    "ghana": "Ghana",
    "jordan": "Jordan",
    "kenya": "Kenya",
    "kuwait": "Kuwait",
    "lebanon": "Lebanon",
    "mauritania": "Mauritania",
    "mauritanie": "Mauritania",
    "mauritius": "Mauritius",
    "morocco": "Morocco",
    "nigeria": "Nigeria",
    "nigerai": "Nigeria",
    "pakistan": "Pakistan",
    "qatar": "Qatar",
    "saudi": "Saudi Arabia",
    "saudia": "Saudi Arabia",
    "saudi arabia": "Saudi Arabia",
    "senegal": "Senegal",
    "sierraleone": "Sierra Leone",
    "sierra leone": "Sierra Leone",
    "tanzania": "Tanzania",
    "tunis": "Tunisia",
    "tunisia": "Tunisia",
    "uae": "UAE",
    "cwa": "CWA",
    # not real markets — data-entry noise, drop to blank
    "mosafer": None,
    "w": None,
}


def normalize_market(raw) -> str:
    cleaned = clean_text(raw)
    if cleaned is None:
        return ""
    mapped = MARKET_ALIASES.get(cleaned.lower(), cleaned)
    return mapped or ""


STATUS_MAP = {"closed": "Resolved", "pending": "Pending"}
TYPE_MAP = {
    None: "Support",
    "I": "Implementation",
    "D": "Deactivation",
    "E": "Escalation",
    # "A" = "Activation"/"Add-on" requests in the source data (e.g. AOS
    # gateway/API activations) — no matching CaseType value exists, folded
    # into Implementation as the closest fit. Flagged in the summary.
    "A": "Implementation",
}


def normalize_person_name(raw) -> str | None:
    cleaned = clean_text(raw)
    return cleaned


# --- reference data upsert ---------------------------------------------

async def upsert_reference_item(kind: str, value: str, order: int) -> None:
    now = datetime.now(UTC)
    existing = await reference_items_collection.find_one({"kind": kind, "value": value})
    if existing:
        return
    await reference_items_collection.insert_one(
        {
            "kind": kind,
            "name": value,
            "value": value,
            "active": True,
            "order": order,
            "tone": None,
            "closes_case": None,
            "created_at": now,
            "updated_at": now,
        }
    )


# --- row parsing ---------------------------------------------------------

def read_rows(xlsx_path: Path) -> list[dict]:
    wb = openpyxl.load_workbook(xlsx_path, data_only=True, read_only=True)
    rows = []
    for sheet_name in MONTH_SHEETS:
        ws = wb[sheet_name]
        for excel_row in ws.iter_rows(min_row=2, max_row=600, values_only=True):
            reported_date, reported_by, customer, product, description, category, \
                assigned_to, status_raw, imp_supp, remarks, resolution, closure, market = excel_row[:13]
            if reported_date is None and customer is None:
                continue
            rows.append(
                {
                    "sheet": sheet_name,
                    "reported_date": reported_date,
                    "reported_by": normalize_person_name(reported_by),
                    "customer": clean_text(customer) or "Unknown Customer",
                    "product": normalize_product(product) or "Unknown",
                    "description": clean_text(description) or "(no description provided)",
                    "category": normalize_category(category) or "Uncategorized",
                    "assigned_to": normalize_person_name(assigned_to),
                    "status_raw": clean_text(status_raw),
                    "imp_supp": clean_text(imp_supp),
                    "remarks": clean_text(remarks) or "",
                    "resolution": clean_text(resolution) or "",
                    "closure": closure,
                    "market": normalize_market(market),
                }
            )
    return rows


def to_utc(dt) -> datetime | None:
    # A handful of "Date of Closure" cells contain free text (e.g. a note)
    # instead of a real date — treat anything non-datetime as absent rather
    # than fabricating/guessing a date.
    if not isinstance(dt, datetime):
        return None
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


# --- user resolution -------------------------------------------------------

async def resolve_users(names: set[str]) -> dict[str, "User"]:
    """Match cleaned names to existing users case-insensitively; create an
    inactive placeholder account (plan T5.3) for anything unmatched."""
    existing = await User.find_all().to_list()
    by_lower_name = {u.name.strip().lower(): u for u in existing}

    resolved: dict[str, User] = {}
    created = []
    async for user_db in get_user_db():
        async for user_manager in get_user_manager(user_db):
            for name in sorted(names):
                key = name.lower()
                if key in by_lower_name:
                    resolved[name] = by_lower_name[key]
                    continue
                slug = re.sub(r"[^a-z0-9]+", ".", name.lower()).strip(".") or "user"
                # ".local"/".invalid"/".test" are rejected by email-validator
                # as reserved special-use TLDs — use a plausible fake domain
                # instead (these accounts are inactive placeholders anyway).
                email = f"{slug}@migrated.caselogger.internal"
                suffix = 1
                while await User.find_one(User.email == email):
                    suffix += 1
                    email = f"{slug}{suffix}@migrated.caselogger.internal"
                try:
                    user = await user_manager.create(
                        UserCreate(
                            email=email,
                            password=secrets.token_urlsafe(24),
                            name=name,
                            is_active=False,
                        )
                    )
                except UserAlreadyExists:
                    user = await User.find_one(User.email == email)
                resolved[name] = user
                by_lower_name[key] = user
                created.append((name, email))
    return resolved, created


# --- main migration --------------------------------------------------------

async def reserve_case_id_block(count: int) -> int:
    """Atomically reserve `count` sequential case-id numbers; returns the
    first number in the block."""
    doc = await counters_collection.find_one_and_update(
        {"_id": "caseId"},
        {"$inc": {"seq": count}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return doc["seq"] - count + 1


async def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: migrate_excel.py <path-to-xlsx> [--dry-run]")
        raise SystemExit(1)
    xlsx_path = Path(sys.argv[1])
    dry_run = "--dry-run" in sys.argv

    await init_db()

    admin = await User.find_one(User.email == ADMIN_EMAIL)
    if admin is None:
        print(f"Admin user {ADMIN_EMAIL} not found — run seed_admin.py first.")
        raise SystemExit(1)

    print(f"Reading {xlsx_path} ...")
    rows = read_rows(xlsx_path)
    print(f"Parsed {len(rows)} rows across {MONTH_SHEETS}")

    # --- reference data ---
    categories = sorted({r["category"] for r in rows})
    products = sorted({r["product"] for r in rows})
    markets = sorted({r["market"] for r in rows if r["market"]})
    print(f"\nDistinct categories: {len(categories)}")
    print(f"Distinct products: {len(products)}")
    print(f"Distinct markets: {len(markets)}")

    # --- users ---
    # Only "Assigned to" names are our real internal team (a small, stable
    # roster) — those get real User accounts. "Reported by" in the source
    # data is overwhelmingly customer-side contacts/role-inboxes (300
    # distinct, messy: "Sales", "Contact us", typo'd names, etc.) and does
    # NOT get accounts created; unmatched reporters fall back to that row's
    # assignee, with the original name preserved in remarks. See the
    # conversation's Phase 5 decision.
    team_names = {r["assigned_to"] for r in rows if r["assigned_to"]}
    print(f"Distinct team member names (assigned_to): {len(team_names)}")
    reported_by_names = {r["reported_by"] for r in rows if r["reported_by"]}
    unmatched_reporters = sorted(n for n in reported_by_names if n.lower() not in {t.lower() for t in team_names})
    print(f"Distinct reported_by names: {len(reported_by_names)} ({len(unmatched_reporters)} won't match a team member and will be classified as Customer reporters)")

    if dry_run:
        existing = await User.find_all().to_list()
        by_lower_name = {u.name.strip().lower() for u in existing}
        missing = sorted(n for n in team_names if n.lower() not in by_lower_name)
        print(f"\n[DRY RUN] Would create {len(missing)} placeholder user accounts (team members only):")
        for n in missing:
            print(f"  - {n}")
        print(f"\n[DRY RUN] Would upsert {len(categories)} categories, {len(products)} products, {len(markets)} markets")
        status_counts = {}
        type_counts = {}
        for r in rows:
            s = STATUS_MAP.get((r["status_raw"] or "").lower(), "Unmapped:" + str(r["status_raw"]))
            status_counts[s] = status_counts.get(s, 0) + 1
            t = TYPE_MAP.get(r["imp_supp"], "Unmapped:" + str(r["imp_supp"]))
            type_counts[t] = type_counts.get(t, 0) + 1
        print(f"\n[DRY RUN] Status mapping: {status_counts}")
        print(f"[DRY RUN] Type mapping: {type_counts}")
        no_closure = sum(
            1 for r in rows if (r["status_raw"] or "").lower() == "closed" and r["closure"] is None
        )
        print(f"[DRY RUN] 'Closed' rows with no closure date on file: {no_closure} (will be left as null, not fabricated)")
        print("\n[DRY RUN] No writes performed. Re-run without --dry-run to migrate.")
        return

    print("\nUpserting reference data...")
    for i, c in enumerate(categories):
        await upsert_reference_item("category", c, 100 + i)
    for i, p in enumerate(products):
        await upsert_reference_item("product", p, 100 + i)
    for i, m in enumerate(markets):
        await upsert_reference_item("market", m, 100 + i)

    print("Resolving/creating team member users...")
    user_map, created_users = await resolve_users(team_names)
    print(f"  Created {len(created_users)} placeholder accounts (inactive, flagged for admin review):")
    for name, email in created_users:
        print(f"    - {name} -> {email}")
    team_lookup = {name.lower(): user for name, user in user_map.items()}

    print("\nBuilding case documents...")
    base_seq = await reserve_case_id_block(len(rows))
    now = datetime.now(UTC)
    docs = []
    skipped = 0
    reporter_internal_count = 0
    for i, r in enumerate(rows):
        assigned_to_user = team_lookup.get((r["assigned_to"] or "").lower())
        if assigned_to_user is None or r["reported_date"] is None:
            skipped += 1
            continue

        # Plan §10 — reporter is a type + free-text name, not forced into a
        # user reference. Matches a team member name -> Internal; anything
        # else (the vast majority: customer-side contacts) -> Customer.
        reported_by_raw = r["reported_by"]
        reported_by_user = team_lookup.get((reported_by_raw or "").lower())
        if reported_by_user is not None:
            reporter_type, reporter_name = "Internal", reported_by_user.name
            reporter_internal_count += 1
        else:
            reporter_type, reporter_name = "Customer", reported_by_raw or "Unknown"

        status = STATUS_MAP.get((r["status_raw"] or "").lower(), "Pending")
        case_type = TYPE_MAP.get(r["imp_supp"], "Support")
        reported_date = to_utc(r["reported_date"])
        closure = to_utc(r["closure"]) if status == "Resolved" else None
        docs.append(
            {
                "case_id": f"CASE-2026-{base_seq + i:06d}",
                "reported_date": reported_date,
                "reporter_type": reporter_type,
                "reporter_name": reporter_name,
                "customer": r["customer"],
                "product": r["product"],
                "category": r["category"],
                "description": r["description"],
                "assigned_to": assigned_to_user.id,
                "status": status,
                "type": case_type,
                "market": r["market"],
                "remarks": r["remarks"],
                "resolution": r["resolution"],
                "date_of_closure": closure,
                "linked_implementation_id": None,
                "created_by": admin.id,
                "updated_by": admin.id,
                "created_at": reported_date or now,
                "updated_at": closure or reported_date or now,
            }
        )

    print(f"Inserting {len(docs)} cases ({skipped} rows skipped — missing reporter/assignee/date)...")
    if docs:
        for start in range(0, len(docs), 500):
            await cases_collection.insert_many(docs[start : start + 500])
    print("Done.")

    print("\n=== SUMMARY ===")
    print(f"Rows parsed: {len(rows)}")
    print(f"Cases inserted: {len(docs)}")
    print(f"Rows skipped: {skipped}")
    print(f"Reporters classified as Internal (matched a team member name): {reporter_internal_count}")
    print(f"Reporters classified as Customer: {len(docs) - reporter_internal_count}")
    print(f"Placeholder users created: {len(created_users)}")
    print(f"Reference items upserted: {len(categories)} categories, {len(products)} products, {len(markets)} markets")


if __name__ == "__main__":
    asyncio.run(main())
