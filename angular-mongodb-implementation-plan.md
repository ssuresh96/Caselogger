# Case Logging Software — Angular + FastAPI + MongoDB Implementation Plan

**Status: Planning document.** Backend stack decision changed again: **Python FastAPI** instead of NestJS, still on **MongoDB**. This revision replaces every NestJS/TypeScript-backend detail below with a FastAPI/Python equivalent — the frontend plan (§5), data model shape (§3), and phase structure (§6) carry over unchanged in substance.

---

## 0. Current State (read this first)

Frontend work has already happened, and the shape of a few things changed along the way. This plan reflects what's actually in the repo today, not a from-scratch design:

- **Angular app scaffolded and largely built** (`case-logger/`) — Dashboard, All Cases / My Cases, Case Detail, Reports (Monthly Dashboard + drill-downs), and a Create Case **modal dialog** are all implemented and working against a **mock, in-memory data layer** (`useMockAuth` flag in `environment.ts`), so the UI is fully clickable without any backend yet.
- **Auth is currently mocked** (`AuthService` in `core/services/auth.service.ts`) — any email/password "logs in," a demo user is seeded. This needs to become real.
- **The `Case` data model is settled** (`core/models/case.model.ts`), current shape as of Phase 10:
  `caseId, reportedDate, reporterType, reporterName, customer, product, category, description, assignedTo, status, type, market, remarks, resolution, dateOfClosure, linkedImplementationId, createdAt, updatedAt, createdBy, updatedBy`
  — `status` is `'Open' | 'InProgress' | 'Pending' | 'Resolved'`, `type` is `'Support' | 'Implementation' | 'Deactivation' | 'Escalation'` (the Imp/Supp column), `reporterType` is `'Customer' | 'Internal'`. The original Excel-derived shape had `reportedBy` as a user reference like `assignedTo` — Phase 10 replaced it with `reporterType`/`reporterName` once real migrated data showed reporters are overwhelmingly customer contacts, not team members.
- **Implementations and Activity Log were removed** from the sidebar/routes to trim scope to what the spreadsheet actually needed. The Angular feature folders still exist on disk but are unreferenced — **deferred, not cancelled**, see Phase 6.
- **A full Admin Panel is in scope** — Users, Products, Categories, Markets, and the Status/Type lists all need real management screens, not hard-coded constants. See Phase 3.
- **Reports (Monthly Dashboard)** is now **fully live**, current-month and multi-month trend sections alike — reading from the real `cases` collection (3,344 cases migrated from the source workbook in Phase 5) via `/reports/monthly` and `/reports/team-workload`, fetched for every month from Jan 2026 through whichever month is selected. No more static/archived split. Phase 4 and Phase 5 both done.
- **Nothing has been deployed. No backend exists yet — not NestJS, not FastAPI. No MongoDB cluster exists yet.**

The work from here: stand up a FastAPI + MongoDB API, then swap the Angular app's mock services for real HTTP calls — the UI itself doesn't need a redesign, just rewiring.

---

## 1. Technology Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend framework | Angular (already scaffolded) | Standalone components, Angular Router, Reactive Forms — unchanged |
| UI component library | Angular Material (already in use) | Unchanged |
| State management | Angular signals + services (unchanged) | `CaseService`/`AuthService` already follow a swappable pattern — see §5 |
| Backend framework | **FastAPI** (Python) | ASGI, async-first, Pydantic request/response validation built in — no separate validation library needed the way NestJS needed `class-validator` |
| Database | **MongoDB** (Atlas for hosted, or local for dev) | Document store; schema shape stays close to the current Angular `Case` interface |
| Data access | **Motor** (async MongoDB driver) + hand-written **Pydantic** models, for every collection *except* `users` | No ODM layer for Cases/ReferenceItem/Counter — plain `AsyncIOMotorCollection`s, validated via Pydantic schemas. **Correction found while scaffolding:** `fastapi-users` v15 dropped its old Motor-only Mongo adapter — its only maintained MongoDB path now is via **Beanie** (`fastapi-users[beanie]`), so the `users` collection alone is Beanie-backed. Beanie is itself Motor + Pydantic under the hood, so this is the smallest deviation available, not a switch to a different stack. |
| Auth | **`fastapi-users`** (Beanie-backed for MongoDB) — JWT auth, user CRUD, password hashing all included | Chosen specifically to avoid hand-rolling user management for Phase 3's Admin Panel — see §3.1 and Phase 1 for the trade-offs this brings |
| API style | REST (JSON) | Simplest fit for FastAPI + Angular `HttpClient` |
| Hosting (API) | Render / Railway / Fly.io (pick one) | All support Python/Docker deploys same as they would Node |
| Hosting (DB) | MongoDB Atlas (free/shared tier to start) | Managed backups, no ops burden |
| Hosting (frontend) | Static hosting (Netlify/Vercel/Nginx) | The Angular app is still just a static SPA — backend language doesn't change this |

---

## 2. Architecture Overview

Still a real three-tier app:

```
Angular SPA  --HTTPS/JSON-->  FastAPI API  --Motor-->  MongoDB
   (browser)                  (Python/ASGI)              (Atlas)
```

- Angular talks only to the FastAPI REST API — no direct database access from the browser.
- Auth: Angular posts credentials to `POST /auth/jwt/login` (this is `fastapi-users`' default route — note it expects an `application/x-www-form-urlencoded` body via `OAuth2PasswordRequestForm`, **not JSON**, which is different from every other endpoint in this API and needs deliberate handling in the Angular login call). Receives a JWT, attached as `Authorization: Bearer <token>` on subsequent requests via an `HttpInterceptor`.
- Authorization: `fastapi-users` gives two built-in dependencies — `current_active_user` (any logged-in user) and a custom `current_superuser`-style dependency for admin-only routes. The Admin Panel (Users, Products, Categories, Markets, Statuses, Types) is gated behind the superuser check end to end.
- No serverless-functions equivalent needed — rollup calculations, case-ID generation, and validation all live in FastAPI route handlers / service functions.
- **Refresh tokens are not built into `fastapi-users` out of the box.** This plan defaults to a single longer-lived JWT (e.g. 12–24h) for MVP simplicity rather than hand-rolling refresh-token rotation on top of the library. Flagged as an explicit trade-off in §7 — revisit if the security posture needs to tighten later.

---

## 3. MongoDB Data Model

### 3.1 `users` (managed by `fastapi-users`, not hand-written)

`fastapi-users` owns this collection's shape via its MongoDB/Motor adapter (`fastapi_users_db_mongodb.MongoDBUserDatabase`). The base fields it provides — `id`, `email`, `hashed_password`, `is_active`, `is_superuser`, `is_verified` — are extended with one custom field:

```py
class User(BaseUser):
    name: str  # custom field; everything else comes from fastapi-users' base schema
```

Two deliberate reuses of `fastapi-users`' built-in semantics, to avoid building custom admin/role plumbing:
- **`is_superuser` *is* the admin/agent role.** `True` → Admin, `False` → Agent. The Angular UI still displays "Admin"/"Agent" labels; only the API field name is borrowed from the library. No separate `role` enum field.
- **`is_active` *is* the deactivate/reactivate toggle** the Admin Panel's Users tab needs (T3.3) — already built into `fastapi-users`' user-management router, no custom endpoint required.

Since every `assignedTo` value in the app is a team member's name, **Users double as the Team Members list** — no separate collection. (`reportedBy` is **not** a user reference — see §3.2/Phase 10; most reporters turned out to be customer-side contacts, not team members, once real data was migrated in Phase 5.)

**Phase 10 addition — account lockout** (T10.4-T10.6): two more custom fields alongside `name`:
```py
class User(BeanieBaseUserDocument):
    name: str
    failed_login_attempts: int = 0
    locked_until: datetime | None = None
```
3 wrong passwords locks the account for 15 minutes (`UserManager.authenticate()` override — the library's own login route can't be decorated per-route, so the lockout/attempts-remaining logic lives inside `authenticate()` itself, raising a structured `HTTPException` detail the frontend reads). An admin can also clear the lock early via `POST /users/{id}/unlock`. Both auto-expiry and manual admin unlock are supported, not just one.

### 3.2 `cases` (manual Motor collection + Pydantic models, matches `core/models/case.model.ts`)

```py
class Case(BaseModel):
    id: ObjectId
    case_id: str            # e.g. "CASE-2026-000001", unique + indexed, generated server-side (§3.5)
    reported_date: datetime
    reporter_type: Literal["Customer", "Internal"]  # Phase 10 — see below
    reporter_name: str                              # free text, not a user reference
    customer: str
    product: str
    category: str
    description: str
    assigned_to: ObjectId   # references users._id
    status: Literal["Open", "InProgress", "Pending", "Resolved"]
    type: Literal["Support", "Implementation", "Deactivation", "Escalation"]
    market: str
    remarks: str
    resolution: str
    date_of_closure: datetime | None
    linked_implementation_id: ObjectId | None  # unused while Phase 6 is deferred
    created_by: ObjectId
    updated_by: ObjectId
    created_at: datetime
    updated_at: datetime
```

Separate Pydantic schemas for the API boundary (standard FastAPI pattern, replaces what NestJS DTOs would have done): `CaseCreate`, `CaseUpdate` (partial — deliberately comprehensive, every field above except identity/audit fields is editable, backing Phase 10's inline case editing), `CaseOut` (response shape, camelCase-aliased to match the Angular `Case` interface — use Pydantic's `alias_generator`/`by_alias=True` so the API speaks `caseId`/`reportedDate` on the wire while Python code stays `snake_case`).

**`reportedBy` is not, and was never settled as, a user reference — corrected in Phase 10.** The original assumption (`reported_by: ObjectId`, same shape as `assigned_to`) held through Phases 0–5, including the Excel migration — which is exactly what exposed the problem: real migrated data showed reporters are overwhelmingly customer-side contacts (~300 distinct names), not internal team members, so forcing a user reference either meant fabricating hundreds of placeholder accounts or losing the real name. Phase 10 replaces it with `reporter_type` (`Customer`/`Internal`) + `reporter_name` (free text) — see Phase 10 below for the full rationale and what changed.

⚠️ **Pydantic v2 serialization gotcha, found via Phase 10's testing**: the app's `PyObjectId` annotated type (`app/common/object_id.py`) must declare its string serializer with `when_used="json"`. Without that guard, `model_dump()` in *Python* mode (not just JSON mode) also stringifies `ObjectId` fields — which silently broke `update_case()` (built via `payload.model_dump(exclude_unset=True)`) any time a request PATCHed a `PyObjectId` field like `assigned_to`: it got written back into Mongo as a plain string, and every later read failed to populate it (showing "Unknown User"). `create_case()` was never affected since it reads `payload.field` attributes directly rather than through `model_dump()`. Worth remembering for any *future* `PyObjectId`-typed field, not just `assigned_to`.

### 3.3 `reference_items` (Admin Panel — Products/Categories/Markets, Statuses/Types)

```py
class ReferenceItem(BaseModel):
    id: ObjectId
    kind: Literal["category", "product", "market", "status", "type"]
    name: str             # display label, e.g. "AOS-Payment Gateway", "Resolved"
    value: str             # stable machine value used in Case documents
    active: bool            # soft-delete: hide from dropdowns without breaking existing cases
    order: int               # dropdown/badge display order
    tone: Literal["good", "warning", "progress", "info", "serious", "critical"] | None  # status/type only
    closes_case: bool | None  # status only: true marks the "case closed" state
    created_at: datetime
    updated_at: datetime
```

**Products/Categories/Markets** are straightforward CRUD — the frontend already treats these as plain strings.

**Statuses and Types are more sensitive** — `status = 'Resolved'` currently drives `dateOfClosure` auto-setting (T2.6) and both fields drive hardcoded badge-color logic in `shared/utils/case-display.util.ts` (`statusTone()`, `typeTone()`). Making these admin-manageable means:
- `case-display.util.ts`'s hardcoded switches get replaced with a lookup against fetched reference data (cache it client-side, don't refetch per badge).
- The dateOfClosure auto-set logic keys off `closes_case: true` on the matching status document, not a hardcoded string comparison.
- The 4 current statuses and 4 current types ship as seeded starting rows (T3.2) — `name` can be renamed freely, `value` stays stable once cases reference it.

### 3.4 `Implementation` and `ActivityEntry` — deferred

Same shape as previously proposed (Customer/Product/Description/AssignedTo/Status/DateOfClosure/ReqId for Implementation; Date/Type/Note/LoggedBy for Activity Log). **Not building these now** — see Phase 6.

### 3.5 Case ID generation

A small `counters` collection (`{ _id: "caseId", seq: int }`), incremented atomically via Motor's `find_one_and_update` with `$inc` and `return_document=ReturnDocument.AFTER` inside the case-creation service function — same atomicity guarantee `$inc` gave under the Mongoose version of this plan, just called through Motor directly instead of through an ODM method.

### 3.6 Indexes

- `cases.case_id` — unique
- `cases.status`, `cases.assigned_to`, `cases.reported_date` — compound index for Case List's filter/search/sort combination
- `users.email` — unique (already enforced by `fastapi-users`' adapter)

---

## 4. FastAPI API Structure

```
api/
  app/
    main.py                       # FastAPI() instance, CORSMiddleware, include_router() calls
    core/
      config.py                    # pydantic-settings BaseSettings: MONGODB_URI, JWT_SECRET, JWT_LIFETIME_SECONDS
      database.py                   # AsyncIOMotorClient instance, get_database() dependency
    auth/
      users.py                      # User/UserCreate/UserUpdate schemas (extend fastapi-users' base schemas + `name`)
      user_manager.py                # UserManager(BaseUserManager) — hooks (on_after_register, etc.)
      backend.py                      # BearerTransport + JWTStrategy + AuthenticationBackend
      dependencies.py                  # fastapi_users instance; current_active_user, current_superuser deps
    cases/
      models.py                      # Case Pydantic model (§3.2)
      schemas.py                      # CaseCreate / CaseUpdate / CaseOut
      router.py                       # APIRouter: GET/POST /cases, GET/PATCH /cases/{id}
      service.py                      # Motor query functions (list/get/create/update)
    reference_data/
      models.py / schemas.py / router.py / service.py   # Products/Categories/Markets/Statuses/Types CRUD
    reports/
      router.py                       # GET /reports/monthly, GET /reports/team-workload (Phase 4)
      service.py                       # MongoDB aggregation pipelines
    common/
      counters.py                     # atomic case-ID sequence helper (§3.5)
      pagination.py                    # shared query-param schema (page/pageSize/status/search)
    app_module.py                     # (optional) central router-registration if main.py gets crowded
  requirements.txt                  # fastapi, uvicorn[standard], motor, fastapi-users[mongodb], pydantic-settings, python-dotenv
  Dockerfile
  .env                              # MONGODB_URI, JWT_SECRET — gitignored
```

Pydantic schemas on every request/response replace what `class-validator` DTOs did in the NestJS version — this is arguably less boilerplate, since FastAPI derives OpenAPI docs and validation from the same schema class instead of needing separate decorator-based rules.

---

## 5. Angular-Side Changes

Unchanged in substance from the NestJS version of this plan — the frontend doesn't need a redesign, it needs its two mock services replaced with real ones, following the pattern they were already built with:

- **`AuthService`** (`core/services/auth.service.ts`) already branches on `environment.useMockAuth`. Add the real branch: `login()` posts to `/auth/jwt/login` — **remember this endpoint wants form-encoded `username`/`password` fields, not a JSON body**, so this call needs `HttpParams`/`URLSearchParams` + the right `Content-Type` header, unlike every other API call this app will make. Drop `loginWithGoogle()`/the Google button entirely (no Firebase, no OAuth provider wired up in FastAPI either — see §7). `currentUser$` derives from a `GET /users/me` call using the stored token.
- **`CaseService`** (`core/services/case.service.ts`) already branches on the same flag with an in-memory `BehaviorSubject` as the mock. Add the real branch: `list()`/`getById()`/`create()`/`update()` call `HttpClient` against `/cases` endpoints.
- **Remove** the `@angular/fire` dependency entirely (never wired to a live Firebase project anyway — `environment.firebase` still has placeholder `REPLACE_ME` values).
- **Add** an `HttpInterceptor` for attaching the JWT. Given §2's single-long-lived-token decision, there's no refresh-and-retry flow to build for MVP — a 401 just routes back to `/login`. Revisit if/when refresh tokens are added.
- **New: Admin Panel feature area.** The orphaned `reference-data/` feature folder gets rebuilt (not resurrected as-is) into a real admin UI — a `/admin` route, gated on the user's `is_superuser` flag (displayed as "Admin" in the UI), with tabs or a sub-nav for **Users, Products, Categories, Markets, Statuses, Types**. Re-add an "Admin" sidebar item (mirroring how "Reports" already does a nested sub-nav) visible only for admins — the `roleGuard` from the original build is still in the codebase, unused; this is what it was built for. Note it now checks `is_superuser` rather than a `role` string.
- Once Phase 3 lands, `case-intake.component.ts`'s hard-coded `CATEGORIES`/`PRODUCTS`/`STATUSES`/`TYPES` arrays get replaced with data fetched from `/reference-data`, and `case-display.util.ts`'s hardcoded tone switches get replaced with a lookup.

---

## 6. Task Breakdown by Phase

### Phase 0 — Backend Project Setup
- [ ] T0.1 Create MongoDB Atlas project + free/shared cluster (dev), separate cluster or DB for prod later
- [ ] T0.2 Scaffold FastAPI project (`app/` layout above), `requirements.txt` with `fastapi`, `uvicorn[standard]`, `motor`, `fastapi-users[mongodb]`, `pydantic-settings`, `python-dotenv`
- [ ] T0.3 `.env` handling via `pydantic-settings.BaseSettings` — `MONGODB_URI`, `JWT_SECRET`, `JWT_LIFETIME_SECONDS`, gitignored
- [ ] T0.4 Wire `AsyncIOMotorClient` in `core/database.py`, confirm connection to Atlas dev cluster on startup
- [ ] T0.5 Add `CORSMiddleware` (allow the Angular dev origin + prod origin); evaluate whether a lightweight security-headers middleware is worth adding (no direct `helmet` equivalent in FastAPI — decide if the hosting platform already covers this)
- [ ] T0.6 Set up API repo CI: lint (`ruff`), type-check (`mypy`, optional), test on PR
- [ ] T0.7 Dockerfile for the API (`python:3.12-slim` base, `uvicorn`/`gunicorn -k uvicorn.workers.UvicornWorker` entrypoint) — same hosting targets as any Docker image, language swap doesn't change Phase 9

### Phase 1 — Auth & Users (`fastapi-users`, replaces Firebase Auth)
- [ ] T1.1 Extend `fastapi-users`' base `User`/`UserCreate`/`UserUpdate` schemas with the custom `name` field (§3.1)
- [ ] T1.2 Wire the MongoDB/Motor user database adapter (`fastapi_users_db_mongodb.MongoDBUserDatabase`) to the `users` collection
- [ ] T1.3 Configure `BearerTransport` + `JWTStrategy` (single-token lifetime per §2) + `AuthenticationBackend`
- [ ] T1.4 Mount `fastapi-users`' auth router (`/auth/jwt/login`, `/auth/jwt/logout`) and users router (`/users/me`, admin CRUD at `/users/{id}`) — **mount the register router behind the `current_superuser` dependency**, not publicly, since this is an internal tool with admin-provisioned accounts, not open sign-up
- [ ] T1.5 `UserManager(BaseUserManager)` — implement `on_after_register` (no-op or logging is fine), decide whether to implement `validate_password` for a minimum-strength policy
- [ ] T1.6 Bootstrap script: create the first admin user directly via `UserManager.create(..., is_superuser=True)` — needed because public registration is disabled, so the system can't self-bootstrap otherwise
- [ ] T1.7 Angular: implement the real branch of `AuthService` (§5) — handle the form-encoded login body, add the JWT `HttpInterceptor`, remove `loginWithGoogle()`/the Google button
- [ ] T1.8 Angular: point `authGuard`/`roleGuard` at the real `currentUser$`, admin check now reads `is_superuser` instead of a `role` string
- [ ] T1.9 Turn `environment.useMockAuth` off once T1.7 is verified working end-to-end; keep mock mode available for local demos without a running API

### Phase 2 — Cases API (Core MVP)
- [ ] T2.1 `Case` Pydantic model (§3.2) + `counters` collection helper (§3.5)
- [ ] T2.2 **Decide and implement** how `assigned_to`/`reported_by`/`created_by`/`updated_by` resolve on the frontend: look up + return user objects in `CaseOut`, or denormalize a name field onto the case document at write time. Pick one — don't build both.
- [ ] T2.3 `POST /cases` — `CaseCreate` schema validates against the same 9 fields the Create Case modal already collects, mirroring `case-intake.component.ts`'s form group exactly
- [ ] T2.4 `GET /cases` — pagination, status filter, text search (customer/description/caseId) matching what `case-list.component.ts` currently does client-side; move that filtering server-side via query params
- [ ] T2.5 `GET /cases/{id}`, `PATCH /cases/{id}` (status changes, etc.)
- [ ] T2.6 Auto-set `date_of_closure` server-side when `status` transitions to `Resolved` (currently not set anywhere in the mock)
- [ ] T2.7 Angular: implement the real branch of `CaseService` (§5) against the new endpoints
- [ ] T2.8 Angular: `case-list.component.ts`'s client-side filter/search/pagination logic moves to query params against T2.4 (or stays client-side over a fetched page if data volume stays small — decide from real case counts, not assumption)
- [ ] T2.9 Error handling: surface FastAPI's `422` validation-error responses in the Create Case modal (currently there's no error path since the mock never fails)

### Phase 3 — Admin Panel (Users, Products, Categories, Markets, Statuses, Types)
- [ ] T3.1 `ReferenceItem` model (§3.3) + CRUD endpoints under `/reference-data` (`GET` open to any authed user for dropdowns, writes gated on `current_superuser`)
- [ ] T3.2 Seed script: insert the 4 current statuses (`Open`/`InProgress`/`Pending`/`Resolved`, `Resolved` flagged `closes_case: true`) and 4 current types (`Support`/`Implementation`/`Deactivation`/`Escalation`), plus the current hard-coded product/category/market lists from `case-intake.component.ts`
- [ ] T3.3 **Users tab needs no custom backend work** — `fastapi-users`' built-in `/users` router already provides list/get/patch/delete, superuser-gated, and `is_active` already covers deactivate/reactivate. Angular's Admin Panel Users tab just consumes these existing endpoints. (If per-user password reset/invite is wanted, that pulls in `fastapi-users`' reset-password router, which needs an email-sending integration — see §7.)
- [ ] T3.4 Angular: build the Admin Panel UI — `/admin` route (gated on `is_superuser`), tabbed or sub-nav layout for Users / Products / Categories / Markets / Statuses / Types, each a simple list + create/edit form + active toggle (matches table/form patterns already used elsewhere in the app)
- [ ] T3.5 Angular: re-add the "Admin" sidebar nav item, point `case-intake.component.ts`'s dropdowns at live `/reference-data` data instead of hard-coded arrays
- [ ] T3.6 Angular: replace `case-display.util.ts`'s hardcoded `statusTone()`/`typeTone()` switches with a lookup against fetched Statuses/Types reference data (cache it)
- [ ] T3.7 API: the "auto-set `date_of_closure`" logic (T2.6) reads `closes_case` off the matching status `ReferenceItem` instead of hardcoding `status == "Resolved"`
- [ ] T3.8 Guard against breaking existing cases: deactivating (not deleting) a Product/Category/Market/Status/Type just hides it from new-case dropdowns — existing cases keep displaying correctly
- [ ] T3.9 Decide who can reach `/admin`: everyone with `is_superuser=True`, or a narrower tier if the team wants day-to-day admins who can't touch Statuses/Types — see Open Decisions (note: `fastapi-users` only gives you one boolean, a finer-grained tier needs a custom field beyond what §3.1 proposes)

### Phase 4 — Live Reporting (replace hard-coded Reports data) ✅ done
- [x] T4.1 Python-side aggregation in `app/reports/service.py` over `cases.find()` for the requested month: totals, AOS share, close rate, pending, category/product mix (top 10). Deliberately not a Mongo `$group` pipeline — expected volume doesn't need it; revisit if that changes.
- [x] T4.2 `GET /reports/monthly?month=YYYY-MM` — returns the shape above via `MonthlyReportOut`
- [x] T4.3 `GET /reports/team-workload?month=YYYY-MM` — per-member assigned/closed/pending/close-rate, replaces the hard-coded `WORKLOAD_ROWS`
- [x] T4.4 Angular: new `ReportsService` (`core/services/reports.service.ts`) calling both endpoints; `reports.component.ts` now drives the stat cards, Story in Brief, status donut, Current-Month Workload table, and Current-Month Category & Product Mix tables from live data via a `selectedMonth` signal (`toObservable` + `switchMap`), with a matching previous-month fetch for the vs-prev deltas
- [x] Month-picker is now a functional `<input type="month">` bound to `selectedMonth`
- [x] T4.5 resolved pragmatically without a full historical migration: the Jan–Jul 2026 multi-month trend table/charts and the multi-month Team Workload matrix stay as static **archived reference data** (clearly labeled "Archived Jan–Jul 2026" in the UI) sourced from the original workbook, since real multi-month `Case` documents don't exist yet (Phase 5 is blocked — see below). Only the current-month-specific sections are live. Seeded 30 realistic demo cases spread across Aug 1–14, 2026 (varied customers/products/categories/statuses/users) so the live sections have representative data instead of the 3 sparse test cases from earlier phases.
- Verified end-to-end via Playwright: live stat cards/workload/mix tables match `curl` output from `/reports/monthly` and `/reports/team-workload` exactly; switching the month picker to July 2026 (a month with no seeded cases) correctly shows an honest empty state (0s, empty donut, "No cases assigned yet") rather than fabricated numbers.

### Phase 5 — Data Migration from Excel ✅ done
- [x] T5.1 `api/scripts/migrate_excel.py` (`openpyxl`, direct Motor writes bypassing the HTTP API for speed) reads `Support Cases 2026 (1).xlsx`'s Jan–Aug month sheets. Supports `--dry-run` to preview normalization/user-creation/status-mapping counts before writing anything.
- [x] T5.2 Normalized Category/Product/Market casing+typo variants via explicit alias tables built from inspecting the real distinct values (37 categories, 100 products, 28 markets after cleanup — source data had far more raw variants: trailing `\xa0`, mojibake, casing, typos like "Poductivity Suite"). Status: `Closed`→`Resolved`, `Pending`/`pending`→`Pending`. Type: blank→`Support`, `I`→`Implementation`, `D`→`Deactivation`, `E`→`Escalation`, `A` (Activation/Add-on requests, no matching CaseType)→folded into `Implementation` as closest fit.
- [x] T5.3 resolved with a narrower rule than originally scoped, found necessary once real data was inspected: **only "Assigned to" names get real User accounts** (6 real team members: Nasbeen, Riswana, Shamees, Shebin, Sudheer, Thasneem — created inactive, `@migrated.caselogger.internal` placeholder emails, flagged for admin review in the Users panel). "Reported by" in the source data turned out to be ~300 mostly customer-side contacts/role-inboxes ("Sales", "Contact us", messy typo'd names) — creating 300 placeholder accounts for these was rejected (user decision) as it would pollute Admin → Users. Unmatched `reportedBy` values fall back to that row's `assignedTo` user, with the real original name preserved via a prepended "Originally reported by: X." note in `remarks` so the information isn't lost, just not structured.
- [x] T5.4 Imported 3,344 of 3,346 parsed rows (2 skipped — missing assignee/date) into `cases`, preserving real `reportedDate` values. Closure dates left `null` (not fabricated) for the ~2,119 "Closed" rows (70%) that had no closure date on file in the source — status still correctly maps to `Resolved`.
- [x] T5.5 Ran against local dev MongoDB; validated total row count (3,344 inserted, DB total 3,377 including pre-existing test/demo cases) and spot-checked individual documents against the source spreadsheet rows via direct Mongo queries and the `/cases` API.
- [ ] T5.6 Archive the original `.xlsx` read-only — not yet done; file still sits at the project root as `Support Cases 2026 (1).xlsx`.
- **Known data-quality finding, not a bug**: `reportedDate` doesn't always fall within its source sheet's nominal month (~10% of rows, e.g. a case first reported in 2025 but tracked in the "Jan 2026" sheet). Live `/reports/monthly` totals (grouped by real `reportedDate`) therefore differ slightly from the original workbook's "Total Case Count" control sheet (e.g. live Jan 2026 = 539 vs. control sheet's 536) — expected and accepted as the honest reading of the real date field, not corrected/forced to match.
- **Follow-on fix, not originally scoped but necessary**: migrating in 3,300+ real cases exposed that `case-list.component.ts`/`dashboard.component.ts` fetched a single capped page of cases (100) and did all filtering/pagination/aggregate counting client-side — accurate only while case volume was tiny. Rewired `CaseService.list()` and the backend `GET /cases` (added `type`/`assignedTo` filters, comma-separated `status`/`type` for "one of" queries) for real server-side pagination/search/filtering; Dashboard's stat cards and "Open Cases by Type" donut now read `total` from lightweight filtered `pageSize:1` queries instead of counting a local sample.
- **Phase 4 follow-through**: the "Archived Jan–Jul" static tables/charts flagged in Phase 4 (T4.5) as a temporary stand-in are now gone — `reports.component.ts` fetches `/reports/monthly` and `/reports/team-workload` for every month from Jan 2026 through the selected month (via `forkJoin`) and builds the multi-month trend table, charts, and team workload matrix from that, same as the current-month sections. One live aggregation path, no more static/live split.

### Phase 6 — Implementation Tracking + Activity Log (deferred)
Not being built right now — nav items and routes were removed. Revisit only if the team asks for these back.
- [ ] T6.1 `Implementation` model + CRUD API (shape in §3.4)
- [ ] T6.2 `ActivityEntry` model + CRUD API (shape in §3.4)
- [ ] T6.3 Re-route the existing (currently orphaned) Angular `implementations/` and `activity-log/` feature folders to real endpoints
- [ ] T6.4 Re-add the sidebar nav items, wire "link implementation" from Case Detail's `⋯` menu (button already exists in the UI, currently does nothing)

### Phase 7 — Security Hardening ✅ done
- [x] T7.1 **Correction found while implementing**: `slowapi`'s `Limiter.limit(...)` is a decorator meant to wrap a route function you own — it can't be attached to `fastapi-users`' own `/auth/jwt/login` handler, which the app never defines directly (mounted via `fastapi_users.get_auth_router(...)`). Used the `limits` library (slowapi's own underlying dependency) directly instead: `app/core/rate_limit.py` implements a `MovingWindowRateLimiter` + in-memory storage, keyed per-client-IP, as a plain FastAPI dependency (`rate_limit_login`), attached via `dependencies=[Depends(rate_limit_login)]` on the `include_router(...)` call in `app/main.py` for the whole `/auth/jwt` router (login + logout — logout being weakly rate-limited too is harmless, it's already behind a valid-token check). Limit: 10/minute per IP, returns `429` with a message the Angular login form now recognizes and surfaces distinctly from "wrong password" (`login.component.ts`). In-memory storage is single-process only — documented in the module docstring as a caveat if the API ever runs multiple workers.
- [x] T7.2 Strengthened `UserManager.validate_password` (`app/auth/manager.py`) beyond the existing 8-char minimum: rejects all-numeric passwords and passwords equal to the user's own email/name. Deliberately did **not** add upper/lower/digit/symbol complexity classes — this is an internal, admin-provisioned tool (no public registration), so "not trivially guessable" was judged the right bar, not consumer-app-grade complexity rules. Confirmed hashing: `fastapi-users`' default `PasswordHelper` uses **argon2id** (`m=65536, t=3, p=4`) — a strong, currently-recommended default; no change needed.
- [x] T7.3 Confirmed already correct: `settings.cors_origins` (from `.env`, `CORS_ORIGINS=["http://localhost:4300"]`) locks `CORSMiddleware` to the dev frontend origin only. Will need the prod frontend URL added to that list at deploy time (Phase 9) — not a Phase 7 gap, just a forward pointer.
- [x] T7.4 Revisited and accepted as a conscious MVP trade-off, not an oversight: single 12h JWT, no refresh-token rotation, no revocation/blocklist. A stolen token is valid until it expires (worst case ~12h). Acceptable given this is an internal tool with a small user base and admin-provisioned accounts; revisit if the security posture needs to tighten (e.g. before exposing this beyond the internal team).
- [x] T7.5 Audited every mutating endpoint (`POST`/`PATCH`; no `PUT`/`DELETE` in custom code) across `app/cases`, `app/reference_data`, `app/reports`, `app/auth`, plus `fastapi-users`' own `/auth/register`, `/users/{id}` PATCH/DELETE routes. **Nothing missing auth** — every route correctly carries `Depends(current_active_user)` or `Depends(current_superuser)`, and admin-only routes (reference-data writes, user registration, `/users/{id}` mutations) are all `current_superuser`-gated. One non-blocking observation: `GET /users` (the custom list endpoint) returns `isActive`/`isSuperuser` for every user to any authenticated agent, not just admins — reasonable for a small internal team roster, flagged here as a conscious choice rather than a silent gap.

### Phase 8 — Testing & QA ✅ done
- [x] T8.1 + T8.2 combined: `api/tests/` (`pytest` + `pytest-asyncio`, 35 tests across `test_cases.py`, `test_auth.py`, `test_reference_data.py`, `test_reports.py`, `test_smoke.py`) run as real `httpx.AsyncClient` ASGI-transport integration tests against a **real local MongoDB** (a dedicated `case_logger_test` database on the same local `mongo:7` container, never `mongomock-motor` — chose the real-instance option the plan already flagged, since Motor/Beanie behavior against a mock is a common source of false confidence). `tests/conftest.py` sets `MONGODB_DB_NAME=case_logger_test` before any `app.*` import (verified in isolation before ever running a test, given the real DB has 3,344 migrated cases), clears all collections before each test, and resets the Phase 7 rate limiter's in-memory bucket between tests (shared module-level state otherwise bleeds across tests sharing one fake client IP). **Correction found while wiring up the harness**: `pytest-asyncio`'s default per-test event loop conflicts with `app.core.database`'s module-level Motor client (created once at import time) — fixed via `asyncio_default_fixture_loop_scope = "session"` **and** `asyncio_default_test_loop_scope = "session"` in `pyproject.toml` (both were needed; fixtures alone left tests on a different loop). Coverage includes the T3.7 closing-status logic (both the fallback rule and proof it's reference-data-driven, not hardcoded), status/type/assignedTo/search filtering, pagination, the Phase 7 password policy and rate limiter, superuser-gating on admin routes, and `/reports/monthly`/`/reports/team-workload` totals against known seeded cases.
- [x] T8.3 Angular: fixed 5 pre-existing scaffold-generated spec files that had never been updated since real `HttpClient`/`ActivatedRoute`/`MatDialogRef`-based services replaced the original mock-only versions (`CaseIntakeComponent`, `CaseDetailComponent`, `DashboardComponent`, `CaseListComponent`, `LoginComponent` — all failed with `NullInjectorError` the first time `ng test` was actually run this session) and one truly broken spec (`app.component.spec.ts` referenced a `title` property that no longer exists on `AppComponent`). Added real coverage for the two services named in this task: `auth.service.spec.ts` (8 tests — login's form-encoding and token storage, the deferred-refresh-on-page-load behavior and its NG0200-avoidance timing, logout success/failure, role mapping) and `case.service.spec.ts` (7 tests — query param forwarding for the Phase 5 pagination/filter rewrite, graceful degradation on HTTP error, the `refresh$`-triggers-refetch pattern). Used `fakeAsync`/`tick()` rather than manual `await Promise.resolve()` chains after discovering the latter is timing-fragile around `HttpTestingController.flush()`. All 26 Angular tests + 35 backend tests pass.
- [x] T8.4 Ran the full golden path live against the real dev servers (not the test DB): admin created a new user via Admin → Users → logged out → logged in as that user → created a case via the modal → confirmed it in All Cases (search) and noted it did *not* land in Dashboard's "Recent Cases" top-5 — expected, not a bug, given 3,377 real cases with many sharing today's date → opened the case, changed status to Resolved, reloaded, confirmed it persisted. **Real gap found and fixed**: `dateOfClosure` was computed correctly end-to-end (verified by both the pytest suite and this manual pass) but was never displayed anywhere in `case-detail.component.html` — added a "Date of Closure" field to the Details tab, shown only when set. Test user and test case cleaned up from the real database afterward; verified count back to exactly 3,377 cases / 8 users.
- [x] T8.5 Checked mobile (390×844) and tablet (834×1112) viewports: hamburger → sliding drawer nav with backdrop works correctly, Create Case modal stays single-column and fully usable, the All Cases table doesn't reflow but correctly scrolls horizontally within its `overflow-x: auto` wrapper (confirmed via actual scroll, not just visual inspection — a static screenshot alone would have looked like a bug), Reports' stat-card grid and charts reflow cleanly on tablet. No regressions found.

### Phase 9 — Deployment & Handover
- [ ] T9.1 MongoDB Atlas prod cluster (separate from dev), IP allowlist or VPC peering depending on host choice
- [ ] T9.2 Deploy FastAPI (Docker image, `uvicorn`/`gunicorn` entrypoint) to chosen host (Render/Railway/Fly.io), env vars set there
- [ ] T9.3 Deploy Angular build to static hosting, point at prod API URL via `environment.prod.ts`
- [ ] T9.4 Custom domain + HTTPS on both frontend and API
- [ ] T9.5 Bootstrap prod admin user (T1.6's script, run once against prod), onboard the team
- [ ] T9.6 Post-launch monitoring window (API error logs, Atlas metrics) before calling the migration complete

### Phase 10 — Reporter Rework, Account Lockout, Inline Case Editing ✅ done
User-requested changes discovered after real usage of the built app (not in the original spreadsheet-derived scope) — added here rather than silently folded into earlier phases so the "why" stays visible.

**Reported By rework (T10.1–T10.3)**
- [x] T10.1 Replaced `reportedBy: ObjectId` (a user reference) with `reporterType: 'Customer' | 'Internal'` + `reporterName: string` (free text) across the full stack: `app/cases/models.py`, `app/cases/schemas.py` (`CaseCreate`/`CaseUpdate`/`CaseOut`), `app/cases/service.py`, the Angular `Case` model, `CaseService`, the Create Case modal, and Case Detail's display + inline edit form. Decision (user-confirmed): replace entirely, don't keep the old dropdown alongside it.
- [x] T10.2 `migrate_excel.py` updated to match — this actually **improves** the Phase 5 migration's fidelity: the old "reporter unmatched → fall back to assignee, note the real name in remarks" workaround is gone, replaced by directly setting `reporterType`/`reporterName` (Internal + team-member name when the raw Excel value matches a team member, Customer + the raw name otherwise). Not re-run against the real data this pass (the database was cleared per a separate request before Phase 10 started), but ready for the next migration run.
- [x] T10.3 `list_cases`' search now also matches `reporter_name`, on top of `case_id`/`customer`/`description`.

**Account lockout (T10.4–T10.7)** — both an auto-expiring cooldown and manual admin unlock (user-confirmed: "both", not one or the other)
- [x] T10.4 `User.failed_login_attempts`/`User.locked_until` fields; `UserManager.authenticate()` overridden (the library's own login route can't be decorated per-route, so the logic has to live inside `authenticate()`, raising a structured `HTTPException` detail instead of returning `None`) — 3 wrong passwords locks the account for 15 minutes. Attempts-remaining is shown starting from the *first* wrong attempt (not the second), matching the request literally: "show the number of attempts left after the first wrong password attempt."
- [x] T10.5 `POST /users/{id}/unlock` (superuser-only) clears the lock early. Admin → Users shows a red "Locked" chip + inline "Unlock" action for any locked account, alongside the existing role/active toggles — this is also what "user role management should be editable" turned out to mean in practice: account-security state being manageable from the same screen as role/active.
- [x] T10.6 Login screen (`login.component.ts`) distinguishes three error cases with different copy: wrong password with attempts left ("2 attempts left before this account is locked"), locked ("Try again in 15 minutes, or ask an admin to unlock it"), and the pre-existing Phase 7 per-IP rate limit (429) — these are independent mechanisms that both apply (per-IP blunts spray attacks across many accounts; per-account lockout protects one specific account regardless of source IP).
- [x] T10.7 Found and fixed a real, pre-existing bug while testing this (not introduced by Phase 10, just never triggered before): `PyObjectId`'s Pydantic serializer stringified `ObjectId` fields even in Python-mode `model_dump()`, so any `CaseUpdate` PATCH touching `assignedTo` silently corrupted the stored reference (wrote a string instead of a real ObjectId), making the case show "Unknown User" on every later read. Fixed with `when_used="json"` on the serializer (§3.2 above has the full explanation) — this was only ever exercised by `update_case()`, `create_case()` was unaffected since it doesn't go through `model_dump()`.

**Inline case editing (T10.8–T10.9)** — "everything should be in a single page," no separate route/modal
- [x] T10.8 Case Detail's previously-inert "Edit" button now toggles an inline edit form (reporter type/name, customer, product, category, description, market, type, assigned-to) directly in place of the read-only Details card, with Save/Cancel — same page, no navigation, no dialog. Backed by `CaseUpdate`, which was already comprehensive enough (no backend schema gap beyond adding the two new reporter fields).
- [x] T10.9 Remarks got its own always-visible textarea + "Save Remarks" button, deliberately separate from the general Edit flow (matches the request's framing as its own feature: "a field where he can enter the remarks and save"). Also fixed a real, unrelated UI gap found while building this: `dateOfClosure` was computed correctly by the backend the whole time (T3.7) but was never actually displayed anywhere on Case Detail — now shown when set.

**Testing**: 46 backend tests (11 new: attempts-remaining, lockout, admin unlock, unlock authorization, locked-status visibility, reporter fields, remarks+reporter PATCH, the ObjectId-serialization regression) + 26 frontend tests, all passing. Verified live end-to-end via Playwright: full lockout sequence (3 wrong attempts → exact "N attempts left" messages → lock → correct password still rejected while locked → admin unlock → login works again), and the create → edit → remarks → reload round trip on Case Detail.

### Phase 11 — Modular MVC Architecture Formalization ✅ done

User request: be able to add new modules without hindering existing ones — an explicit extensibility requirement, not just a code-quality nice-to-have. This phase **documents and formalizes** the architecture already largely in place rather than introducing a new one from scratch.

**Current state, restated explicitly in MVC terms:**
- Backend (`api/app/`) is already organized one folder per feature, each following the same internal shape: `models.py` (Model), `schemas.py` (API-boundary DTOs — the "View" layer for a JSON API, no templates involved), `service.py` (business logic — "Controller" logic), `router.py` (HTTP entry points — the "Controller" surface). `cases/`, `auth/`, `reference_data/` all follow this. `reports/` is `schemas.py` + `service.py` + `router.py` only — no `models.py`, since it doesn't own a collection, it's a pure aggregation module. `common/` holds shared building blocks (`CamelModel`, `PyObjectId`, `next_case_id`) every module depends on. `core/` holds cross-cutting infra (`config.py`, `database.py`'s Motor singleton + `init_db()`, `rate_limit.py`). `main.py` assembles everything: CORS middleware, `init_db()` in the lifespan hook, one `app.include_router(...)` call per module.
- Frontend (`case-logger/src/app/`) is modular by construction — Angular's DI system already prevents one feature from reaching into another's private internals. `core/services/` holds cross-cutting singletons (`CaseService`, `AuthService`, `UsersService`, `ReferenceDataService`, `ReportsService`), `core/models/` holds shared TS interfaces, and `features/<name>/` holds one folder per page (`dashboard`, `case-list`, `case-detail`, `case-intake`, `auth/login`, `reports`, `admin/admin-users`, `admin/admin-reference-list`, plus the still-deferred Phase 6 `implementations`/`activity-log`/`reference-data` folders). Features only ever talk to each other through `core/services/*` — **the frontend module boundary is effectively already clean**; this phase's real work is on the backend.

**The gap that existed — backend modules reaching into each other's MongoDB collections directly:**
- [x] T11.1 `app/cases/service.py`'s `_fetch_users_map()` read `database["users"]` directly instead of calling something `auth` exposed.
- [x] T11.2 `app/cases/service.py`'s `_is_closing_status()` read `database["reference_items"]` directly instead of calling something `reference_data` exposed.
- [x] T11.3 `app/reports/service.py` reads `database["cases"]` and `database["users"]` directly — documented as an **intentional, named exception**, left as-is (no code change): aggregation modules reading other modules' collections read-only is reasonable; routing it through a service call would add ceremony without adding safety.

Because MongoDB doesn't enforce schema ownership, these direct reads worked fine day-to-day — but they meant a future change to the `users` or `reference_items` document shape had to be cross-checked against `cases/service.py` by hand, with no compiler/interface boundary catching a mismatch. That's exactly the "hindering other modules" risk the user named.

**Remediation — done:**
- [x] T11.4 Added `app/auth/service.py` (new file — `auth` didn't have one yet) with `get_user_summaries(user_ids: set[ObjectId]) -> dict[ObjectId, UserSummary]`, built on Beanie's `User.find(In(User.id, ...))` rather than a raw Motor collection handle, since `auth` already owns `User` as a Beanie document. Also moved `UserSummary` itself from `app/cases/schemas.py` into `app/auth/schemas.py` — a "summary of a user" is auth's concept to own; `cases/schemas.py` now imports it from there instead of defining its own copy.
- [x] T11.5 Promoted `_is_closing_status()` (with its `FALLBACK_CLOSING_STATUS` constant) into `app/reference_data/service.py` as a public `is_closing_status(status_value: str) -> bool`, reusing the module's existing `reference_items_collection` handle — no new collection reference needed.
- [x] T11.6 `app/cases/service.py` now imports `get_user_summaries` from `app.auth.service` and `is_closing_status` from `app.reference_data.service`; its own `users_collection`/`reference_items_collection` handles are gone entirely. Verified no circular imports (`auth` and `reference_data` don't import from `cases`, so the dependency direction is one-way) and all 46 backend tests still pass unchanged after the refactor — this was a pure internal reshuffle, no behavior or API contract changed.
- [x] T11.7 **"Adding a new module" checklist** (for Phase 6, Phase 12, Phase 13, or anything else built after this point):
  - **Backend**: own folder under `app/`; own `models.py` (if it owns a collection) / `schemas.py` / `service.py` / `router.py`; exactly one `app.include_router(...)` line added to `main.py`; if another module needs data your module owns, add a function to your `service.py` for it to call — never let another module hold its own handle to your collection. Cross-cutting aggregation modules (like `reports`) reading other modules' collections read-only is the one accepted exception — name it explicitly in this doc if you add another one, don't let it become an unstated pattern.
  - **Frontend**: own folder under `features/<name>/`; communicate with the rest of the app only through `core/services/*`; never import a component/file directly from another feature's folder.

### Phase 12 — Real Activity Log + Remarks Preview + Bug/Task/WO Reference Fields ✅ done

User-requested after using the built app. Two related but separable changes to Case Detail, both scoped narrowly — not a rebuild of the page.

**Part A — Real activity log, replacing the hardcoded "Neeraj Sharma" entries**

`case-detail.component.ts` currently has a fully hardcoded signal, unrelated to the actual case:
```ts
readonly activity = signal<ActivityEntry[]>([
  { author: 'Neeraj Sharma', timestamp: 'Reported', message: 'Case created and assigned.' },
  { author: 'Neeraj Sharma', timestamp: 'In progress', message: 'Investigating the issue. Reproduced on UAT.' },
]);
```
This is also where the original plan's deferred Phase 6 `ActivityEntry` model lives (§3.4) — this request revives a scoped slice of that (a real audit trail on Case Detail), not the full standalone Activity Log page/nav item.

- [x] T12.1 New `activity_log` collection + `ActivityEntry` model: `case_id`, `user_id`, `entry_type: Literal["system", "comment"]`, `change_summary`, `created_at` (`app/cases/models.py`, `app/cases/schemas.py` — `ActivityEntryOut`, `ActivityCommentCreate`).
- [x] T12.2 `create_case()` logs "Case created and assigned to `<name>`"; `update_case()` diffs `existing` vs `updates` field-by-field via `_log_update_diff()`/`_log_activity()` in `app/cases/service.py`, with dedicated phrasing for `status` ("Status changed from X to Y") and `assigned_to` ("Reassigned to `<name>`"), and a `_FIELD_LABELS`-driven "`<Label>` updated" for every other tracked field (including `bugNumber`/`taskNumbers`/`workOrderNumbers`). Bookkeeping fields (`updatedBy`/`updatedAt`/`dateOfClosure`) are deliberately not logged.
- [x] T12.3 `GET /cases/{id}/activity` and `POST /cases/{id}/activity` (`app/cases/router.py`) — newest first, real `UserSummary` populated via the existing `get_user_summaries()` (Phase 11).
- [x] T12.4 Frontend: `CaseService.listActivity()`/`postComment()` (real HTTP + a parallel mock-mode implementation that mirrors the same diff logic for `useMockAuth`), replacing the hardcoded `activity` signal in `case-detail.component.ts`. Comments and system entries share one chronological feed, visually distinguished by a muted avatar style for `entryType: "comment"` (`.timeline-comment` in `case-detail.component.scss`).

**Part B — Remarks: preview/edit toggle + Bug/Task/WO reference fields**

Today's Remarks card (built in Phase 10) is a plain always-editable `<textarea>` + "Save Remarks" button — no preview mode, no reference-number fields.

**Second correction to this phase's design** (first draft: one combined `workorderNumber` field; second draft: two fields, Task Number + WO Number — both superseded). The user's fuller requirements: three independent reference types (**Bug**, **Task**, **Workorder/WO**), not two, in any combination including none; **Task and WO are multi-valued** ("multiple tasks and workorders assigned to a single case") while Bug stays single-valued (confirmed); a "which type(s) apply" selector should progressively disclose the relevant input(s) while working a case; and a **category-conditional rule** — when Category is "Other Support Cases," only Workorder is offered (Bug/Task not applicable), implemented as a reference-data-driven flag (confirmed) rather than hardcoded, defaulting every other category to all three types allowed.

- [x] T12.5 Data model — `bug_number: str | None = None`, `task_numbers: list[str] = []`, `work_order_numbers: list[str] = []` on `Case`/`CaseUpdate`/`CaseOut` (`app/cases/models.py`, `app/cases/schemas.py`) and the Angular `Case`/`UpdateCaseInput`. Deliberately **not** on `CaseCreate` — collected later via Case Detail's edit form, once a case exists. No separate "which types apply" flag is persisted — pure form-UI state (T12.7); what's saved is just whichever of the three fields end up populated.
- [x] T12.6 Read-only display: Case Detail's info-grid (`case-detail.component.html`) shows Bug Number, Task Numbers, and WO Numbers (comma-separated), each conditionally rendered only when populated — same `@if` pattern as Market/Date of Closure/Resolution.
- [x] T12.7 Bug / Task / Workorder checkbox selector in the Edit form (T10.8): checking Bug reveals a single text input (`bugNumberDraft`); checking Task or WO reveals a chip-list + "Add" control (`taskNumbersDraft`/`workOrderNumbersDraft`, with `addTaskNumber()`/`removeTaskNumber()` etc.).
  - **Category rule, reference-data-driven**: `allowed_reference_types: list[Literal['Bug','Task','Workorder']] | None` on category `ReferenceItem`s (`app/reference_data/models.py`/`schemas.py`, Angular `ReferenceItem.allowedReferenceTypes`) — `null` = all three allowed (default), explicit list = only those. Seeded "Other Support Cases" → `['Workorder']` (`scripts/seed_reference_data.py`, applied to the existing dev DB via the same idempotent `upsert()` extended to patch this one field on already-seeded docs). `ReferenceDataService.allowedReferenceTypes(categoryValue)` resolves it with the same-pattern fallback as `statusTone()`/`typeTone()`. Also exposed as an admin-editable checkbox group on the Admin → Categories "Add Category" form (`admin-reference-list.component.ts/html`), same set-at-creation pattern already used for status's `closesCase`. **Superseded by Phase 12.1** — the checkboxes now live in their own card, keyed off the case's actual saved category rather than the general edit form's live value.
  - **Bug stays single-valued**, as planned.
- [x] T12.8 Case Detail's Remarks card (`case-detail.component.ts/html`) has its own `isEditingRemarks` toggle, independent of the general Edit form: default state renders a read-only preview (`.remarks-preview`, or "No remarks yet." when empty); the edit icon swaps in the textarea + Save/Cancel; after Save it reverts to preview.
- [x] T12.9 Preview is plain text with `white-space: pre-wrap` (line breaks preserved, no markdown parsing), as planned.

**Verification**: 54/54 backend pytest (new coverage: activity-log creation/diffing/comments, Bug/Task/WO round-trip, `allowedReferenceTypes` create/patch), 26/26 Angular unit tests, `ng build` clean, and a full Playwright run against the real dev servers (create a case → real "Case created and assigned to `<name>`" activity entry with no hardcoded names → post a comment → edit Bug/Task/WO fields and confirm they appear read-only + generate activity entries → confirm category="Other Support Cases" hides Bug/Task checkboxes while keeping Workorder → Remarks preview/edit/save round-trip) — 21/21 checks passed.

### Phase 12.1 — Post-Launch UI Refinements (Case List WO column, standalone Bug/Task/WO card, Edit/Delete row actions) ✅ done

Three small user-requested changes after using the Phase 12 build in the browser — not a new phase, just follow-up polish.

- [x] **WO Number column on Case List** (`case-list.component.html/ts`) — "All Cases"/"My Cases" tables gained a WO Number column between Category and Assigned To, showing `item.workOrderNumbers.join(', ')` or `—` when empty. Task Numbers/Bug Number were not requested for the list view and were left off to avoid an overly wide table.
- [x] **Bug/Task/WO decoupled from the general Edit form into its own card** — originally (T12.7) the checkbox/chip-list selector only appeared inside "Edit Case"; the user asked for it to be enterable in the same kind of dedicated area as Remarks. It's now its own "Bug / Task / Workorder" card (`case-detail.component.ts/html`) directly below Remarks, with its own `isEditingReferenceNumbers` preview/edit toggle (`startEditReferenceNumbers()`/`cancelEditReferenceNumbers()`/`saveReferenceNumbers()`), independent of `isEditing()`. `allowedTypes` now reads the case's actual saved `category` (not the edit form's live value, since this card no longer lives inside that form) — switching category still only takes effect after that edit is saved, which is an acceptable trade-off since Bug/Task/WO editing and Category editing are now two separate actions. The read-only Bug/Task/WO entries were removed from the Description card's info-grid (would otherwise be duplicated across two cards).
- [x] **Case List row actions: Edit shortcut + Soft Delete** — each row gets a `more_vert` kebab menu (`MatMenuModule`, matching the existing pattern from Case Detail's header) with two items:
  - **Edit** — navigates straight to `/cases/{id}?edit=1`; `case-detail.component.ts` reads that query param once on load and auto-calls `startEdit()` after the case loads, skipping the extra "click Edit" step.
  - **Delete** — opens `ConfirmDialogComponent` (new shared component, `shared/components/confirm-dialog/`) naming the exact Case ID before doing anything, per the user's explicit ask for a warning popup. Only on confirm does it call the new `DELETE /cases/{id}` endpoint.
  - **Soft delete, not hard delete** (user's explicit choice over the alternative of a hard delete): `Case` gained `deleted: bool`, `deleted_at`, `deleted_by` (`app/cases/models.py`). `list_cases()` and `get_case()` both exclude/404 on `deleted: true` (`app/cases/service.py`); the document itself is never removed from Mongo, so a mistaken delete stays recoverable via direct DB access (no restore UI was requested, so none was built). `delete_case()` logs a "Case deleted" activity entry before the case disappears from view. No permission restriction beyond being signed in — matches the existing `update_case`/`create_case` pattern, which also has no extra role check today; revisit if the team wants delete restricted to superusers only.
  - **Rows are no longer clickable** (a follow-up correction to this same phase) — the table previously also navigated to Case Detail (read-only) on row click; the user asked for opening a case to happen only through the action button, so `[routerLink]`/`clickable-row` was removed from the `<tr>` and the kebab menu's **Edit** is now the sole way to open a case from the list.

**Verification**: 60/60 backend pytest (added: soft-delete hides from list/get, 404 on double-delete/missing/deleted-case-update, "Case deleted" activity entry, auth required), 26/26 Angular unit tests (fixed a stale `ActivatedRoute` test mock that was missing `queryParamMap`), `ng build` clean, and a Playwright run against the real dev servers driving the actual kebab menu → Edit (confirms direct navigation to edit mode) → Save, then kebab menu → Delete → Cancel (case still listed) → Delete → Confirm (case gone from list, `GET /cases/{id}` returns 404) — 9/9 checks passed, navigating strictly by the case id captured from the create response rather than by row position (a lesson from a near-miss during Phase 12 verification, where relying on row position briefly overwrote the user's own manually-created test case).

### Phase 13 — Excel Import Template for Historical Data ✅ done

User request: a proper Excel **template** (not the messy one-off source workbook Phase 5 dealt with) whose columns map cleanly onto the **current** schema, so historical/legacy data can be uploaded and dumped into the database with every field landing correctly — repeatable, not a one-time developer script. **Resolved: full Admin Panel upload feature** (not a simpler CLI-only script) — any admin can self-serve a historical-data import without needing a developer to run anything.

**Why this is different from Phase 5's `migrate_excel.py`**: that script existed to reverse-engineer a messy, pre-existing real-world workbook (typo'd values, inconsistent casing, a `reported_by` column that turned out to mean something different than assumed) after the fact. This phase is the opposite direction — define the clean template *first*, matching today's schema exactly (including Phase 10's `reporterType`/`reporterName` and Phase 12's `bugNumber`/`taskNumbers`/`workOrderNumbers`), so filling it in and importing it never needs that kind of normalization guesswork.

- [x] T13.1 **Template file** (`app/import_data/service.py::build_template_workbook()`) — an `.xlsx` with exactly this header row, human-fillable (no raw ObjectIds): Reported Date, Reporter Type, Reporter Name, Customer, Product, Category, Description, Assigned To (a name, resolved to a real user on import), Status, Type, Market, Remarks, Bug Number, Task Numbers, WO Numbers, Resolution — Task Numbers/WO Numbers accept a comma-separated list in one cell. `Case ID`/`Date of Closure` are excluded (server-generated). Built on a new `CaseImportCreate` schema (`app/cases/schemas.py`) and `create_case_from_import()` (`app/cases/service.py`) — deliberately kept separate from the live Create Case dialog's `CaseCreate`/`create_case()`, since T12.5 intentionally excludes market/remarks/resolution/Bug/Task/WO from case *creation* (they're added later via the edit form) — imported historical rows have no such later step, so they need the fuller payload up front.
- [x] T13.2 **Data validation dropdowns** — Reporter Type/Status/Type are fixed `Literal` values off the `Case` model; Product/Category are read live via `reference_data.service.list_reference_items()`. All five live on a hidden "Lists" sheet (Excel's inline dropdown-list formula has a ~255-char limit, too short for the full product/category lists) and are wired via `DataValidation` range references, applied down 2000 rows.
- [x] T13.3 `POST /admin/import/cases` (`app/import_data/router.py`, `current_superuser`-gated) — accepts an uploaded `.xlsx`, parses row-by-row (`parse_and_import()`), resolves "Assigned To" by case-insensitive name match against `auth.service.list_all_user_summaries()` (a new public cross-module function, matching the `get_user_summaries()`/T11.4 precedent), and calls `create_case_from_import()` per valid row.
- [x] T13.4 `GET /admin/import/cases/template` (`current_superuser`-gated) — streams the generated workbook with a `Content-Disposition: attachment` header, so download → fill in → upload stays entirely inside the Admin Panel.
- [x] T13.5 Frontend: new **Admin → Import Cases** page (`admin-import-cases.component.ts/html/scss`, routed at `/admin/import-cases`, nav entry added under the existing Admin section) — a download-template button, a file picker + "Import Cases" button, and a result summary card (Rows Read / Imported / Rejected counts, plus a table of `{row, reason}` for every rejected row). `ImportService` (`core/services/import.service.ts`) handles the blob download and multipart upload — the one core service in this codebase without a `useMockAuth` branch, since faking a real `.xlsx` byte round-trip isn't worth building for a mode nothing in this project actually runs against.
- [x] T13.6 Validation policy, resolved as planned — reject with a specific per-row reason and keep going (never silently skip): missing required field(s) (named explicitly, e.g. "Missing required field(s): Customer"), invalid Reporter Type/Status/Type value, or an Assigned To name matching no existing user. No placeholder account auto-creation, unlike Phase 5's `migrate_excel.py`.

**Verification**: 69/69 backend pytest (added: template superuser-gating + valid-workbook shape, import superuser-gating, valid rows create cases with every field landing correctly + an "imported" activity entry, rejection reasons for a missing field/invalid status/unmatched assignee, mixed valid+invalid rows in one upload), 26/26 Angular unit tests, `ng build` clean, and a Playwright run against the real dev servers — logged in, downloaded the real template, uploaded a 2-row file (1 valid historical row with Bug/Task/WO/Market/Remarks/Resolution all populated, 1 row with a deliberately invalid Status), confirmed the result card's counts and rejection reason, then confirmed the imported case's fields via a direct API call — 14/14 checks passed.

### Phase 14 — Visual Design Refresh (light sidebar, indigo palette, new login layout) ✅ done

User supplied a full mockup (a bundled HTML deck covering ~20 screens: Dashboard, My/All Cases, Create Case, Case Detail, all 5 Reports views, Login, and every Admin screen including Import Cases) and asked for the running app's UI to match it exactly. Because the app was already built on a CSS-custom-property design-token system (`--accent`, `--text-primary`, `--status-*`, etc. in `styles.scss`, consumed everywhere via `var(...)`, never hardcoded per-component), this was mostly a **token swap**, not a rebuild — updating the values in one place cascaded correctly into badges, buttons, tables, and cards across every already-built screen automatically. The remaining work was the two places that don't scale off shared tokens: the sidebar's light/dark theme switch and the Login page's layout/copy.

- [x] **Design tokens** (`styles.scss`) — replaced the old dark-navy-sidebar palette with the mockup's indigo palette: `--accent: #5b45d6` (was `#4f3df5`), light `--page-bg`/`--surface`, new `--status-*` tint/text pairs matching the mockup's Open=purple/Resolved=teal/Pending=orange/Escalation=red scheme, a `--brand-gradient` (purple→teal, used on the logo mark) and dedicated `--avatar-bg`/`--avatar-text` tokens, plus base font-family switched to `'Helvetica Neue', Helvetica, Arial, sans-serif` to match the mockup's type.
- [x] **Sidebar/topbar** (`core/layout/shell.component.scss`) — the one structural change tokens alone couldn't do: flipped the sidebar from dark navy to white/light (`--sidebar-bg`, `--sidebar-text`, `--sidebar-bg-active` redefined), added a border-right divider, resized the brand mark to the gradient square, and switched nav-item/avatar colors to the new light-theme values. The HTML structure (nav items, expandable Reports/Admin children, user footer) was already an exact match to the mockup and needed no changes.
- [x] **Login page rebuilt** (`features/auth/login/`) — swapped panel order (form now left, indigo gradient panel now right, matching the mockup), rewrote copy ("Sign in" / "Use your work account…"), added the gradient panel's headline + 3 feature bullet points. **Two deliberate deviations from the mockup**: the mockup's 4 numeric stat tiles ("62 open cases", "78.4% close rate") were dropped — they're fabricated marketing numbers on a pre-auth screen for a tool now handling real data, which conflicts with this project's standing rule against fabricating data (and the real system currently has 2 cases, not 62 — showing the mockup's numbers verbatim would be actively misleading). The "Continue with company SSO" button was also dropped rather than added as a non-functional decoration, since a fake auth affordance on a real login screen risks misleading a user trying to actually sign in (unlike inert placeholder items elsewhere in the app like "Print case").
- [x] **Verified via token-cascade, not per-page rewrites**: Dashboard, All/My Cases (including the WO Number column and row action menu from Phase 12.1), Create Case dialog, Case Detail (info-grid, Remarks card, Bug/Task/Workorder card, Activity timeline), all 5 Reports views, and every Admin screen (Users, Products, Categories with Allowed Reference Types, Markets, Statuses, Types, Import Cases) all restyled correctly with zero component-level changes — confirmed via Playwright screenshots against the real dev servers, each checked against its corresponding mockup screen.
- [x] A repo-wide grep for old-palette hardcoded hex values (`#4f3df5`, `#1a1440`, `#1a1a2e`, etc.) turned up zero remaining references outside the design tokens themselves, and a second grep for any hardcoded hex at all turned up only 3 deliberate exceptions (the login gradient's exact navy/purple stops and the topbar search-bar background), confirming the whole app is consistently token-driven with no leftover old-theme color debt.

**Verification**: `ng build` clean, 26/26 Angular unit tests, and a Playwright screenshot pass over Login, Dashboard, All Cases, Case Detail (Details + Activity tabs), Create Case, Reports → Monthly Dashboard, Admin → Categories, Admin → Users, and Admin → Import Cases against the real dev servers — each visually cross-checked against its mockup counterpart. No backend changes in this phase.

---

## 7. Open Decisions Still Needed From the Team

- **§2 / T7.4 (resolved)**: kept the single long-lived JWT (no refresh-token rotation) as a conscious MVP trade-off — see Phase 7. Revisit only if the security posture needs to tighten.
- **T2.2 (resolved for `assignedTo`, moot for `reportedBy`)**: populate-on-read, confirmed working throughout. `reportedBy` no longer applies — Phase 10 replaced it with a plain `reporterName` string, nothing to populate.
- **T3.3 / password resets**: if admins need to send password-reset/invite emails (rather than setting a temp password by hand), that requires wiring `fastapi-users`' reset-password router to an actual email-sending service — a new dependency nothing else in this plan needs. Decide if that's needed for launch or can wait.
- **T3.9**: is a single `is_superuser` boolean enough for "admin," or does the team want a narrower tier (day-to-day admin vs. one who can touch Statuses/Types)? The chosen library only gives one boolean out of the box — a finer split is custom work.
- **T4.5 (resolved)**: Phase 5's migration produced real `Case` documents for Jan–Aug 2026, so the archived static table/charts were deleted and folded into the same live `/reports/monthly` + `/reports/team-workload` aggregation used for the current month — see Phase 4/5.
- **Phase 6 (partially answered and built via Phase 12)**: the Activity Log half turned out to be genuinely wanted — Phase 12/Part A built a real audit trail on Case Detail specifically (not the full standalone Activity Log page/nav item, which remains out of scope). Implementation Tracking (linking cases to implementations) is still an open question — deferred-but-wanted, or delete the orphaned feature code outright?
- **Hosting choice** (T9.2): Render vs. Railway vs. Fly.io — pick based on the team's familiarity/budget, not covered by this plan.
- **Google sign-in**: dropped from this plan entirely (§5) — revisit only if someone actually asks for SSO, which would mean adding an OAuth provider integration to `fastapi-users` (it supports this, just not scoped here).
- **T12.4 (resolved)**: the Activity tab's "post a comment" box writes into the same `activity_log` collection as system-generated entries, distinguished by `entry_type: "system" | "comment"` — one unified chronological feed, structurally distinguishable.
- **T12.7 — Bug singularity (resolved)**: Bug Number stays single-valued; only Task and WO are multi-valued lists.
- **T12.7 — category default (resolved)**: every category other than "Other Support Cases" defaults to all three reference types allowed; narrower per-category rules can be set later via Admin → Categories without a code change, since the rule is reference-data-driven.
- **T12.7 — reference-data-driven vs. hardcoded (resolved)**: reference-data-driven — `allowed_reference_types` on category `ReferenceItem`s, matching the T3.7 `closes_case` precedent.
- **T12.9 (resolved)**: plain-text remarks preview, line breaks preserved — no markdown/rich-text.
- **T13.6 (resolved)**: an unmatched "Assigned To" name during Excel import **rejects the row** (with a clear reason in the result summary) rather than auto-creating a placeholder account — a deliberate change from Phase 5's T5.3 precedent, since this is now a repeatable admin-facing flow rather than a one-off developer script.
- **Phase 13 scope (resolved)**: full upload-based Admin UI feature (template download + upload endpoint + result summary) — not a simpler CLI-only script.

---

## 8. Notes on Scope Control

- This plan does **not** re-litigate the UI — Dashboard/Case List/Case Detail/Create Case modal/Reports layout are all already built and approved by use; the work here is backend + rewiring, not redesign.
- `fastapi-users` was chosen specifically to cut Phase 1/Phase 3 custom-auth work — resist the urge to bypass it and hand-roll auth anyway "for control," that reintroduces the exact work the library choice was meant to avoid.
- Phase 3 (Admin Panel) is firmly in scope — Products/Categories/Markets/Statuses/Types being hard-coded is exactly the kind of drift the original spreadsheet plan was trying to eliminate.
- Phase 6 (Implementations/Activity Log) is still the one deliberately deferred area — resist building it unless the team actually asks.
- Phase 4 (live Reports) and Phase 5 (data migration) are both done — Reports is fully live, no static/archived split remaining.
- Phase 7 (Security Hardening) and Phase 8 (Testing & QA) are both done — see their sections above for what was actually verified vs. what's a documented conscious trade-off.
- Phase 10 (Reporter Rework, Account Lockout, Inline Case Editing) is done — user-requested after real usage of the built app, not originally in scope, added here rather than silently merged into earlier phases.
- Phase 11 (Modular MVC formalization) is done — the two direct-collection-access coupling points are fixed, `main.py` and the module boundaries otherwise didn't need to change since the structure was already sound.
- Phase 12 (real Activity Log + Remarks preview + Bug/Task/WO reference fields) is done — see its section above for what was built and verified. Phase 13 (Excel import template) remains **documented only, not started** — do not start its code until asked.
- No NgRx, SSR, or offline support on the frontend — unchanged from every earlier version of this plan.

---

*Phases 0–5, 7–8, and 10–14 (including Phase 12.1) are built and verified against a real local MongoDB (`mongo:7` in Docker) — this is no longer a plan-only document for those phases. The `cases`/`reference_items`/non-admin `users` collections were cleared at the user's request after Phase 8 (a separate "unrelated data" cleanup, not a Phase 10 side effect) — the 3,344-case Phase 5 migration is fully re-runnable via `scripts/migrate_excel.py` whenever needed, now against the corrected Phase 10 schema. Phase 6 remains deliberately unbuilt (deferred). Phase 9 (Deployment & Handover) has not started — no prod MongoDB Atlas cluster, no deployed API/frontend host, no custom domain — it's the only phase in this plan with no work done and no explicit decision to defer it; everything else is either built or a conscious scope call. See §6 for the full per-phase status.*
