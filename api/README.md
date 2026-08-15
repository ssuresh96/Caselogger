# Case Logger API

FastAPI + MongoDB backend for the Case Logger app. See
`../angular-mongodb-implementation-plan.md` for the full plan — this is the
Phase 0–3 backend slice of it.

## Local setup

Requires a running MongoDB (local install, Docker, or an Atlas connection
string) — nothing in this repo starts one for you.

```bash
python -m venv venv
venv/Scripts/activate        # venv\Scripts\activate.bat on plain cmd.exe
pip install -r requirements.txt
cp .env.example .env         # then edit MONGODB_URI if not using localhost:27017
```

Run the API:

```bash
uvicorn app.main:app --reload --port 8000
```

Docs at `http://localhost:8000/docs`.

## Bootstrapping

Public registration is admin-gated (see `app/main.py`), so the first admin
user has to be created directly:

```bash
python scripts/seed_admin.py you@example.com "a-strong-password" "Your Name"
python scripts/seed_reference_data.py
```

## What's implemented

- **Auth** (`app/auth/`) — `fastapi-users`, JWT (`/auth/jwt/login`), admin-gated
  registration, `/users/me` + admin user management (`is_superuser` = Admin
  role, `is_active` = deactivate toggle).
- **Cases** (`app/cases/`) — `/cases` CRUD, matches the Angular `Case` model
  and the Create Case modal's 9 fields exactly. `reportedBy`/`assignedTo` are
  real user references, populated on read (plan T2.2's decision). Auto-sets
  `dateOfClosure` when status becomes `Resolved`.
- **Reference Data** (`app/reference_data/`) — `/reference-data` CRUD for
  Products/Categories/Markets/Statuses/Types, admin-gated writes, open reads.

## Not yet done

- Angular side still points at its mock data layer — nothing in `case-logger/`
  has been rewired to call this API yet (plan §5).
- Reports aggregation endpoints (plan Phase 4).
- Data migration script from the original Excel workbook (plan Phase 5).
- Rate limiting, CI, tests (plan Phase 7/8).
