# Case Logging Software — Plan (based on "Support Cases 2026.xlsx")

**Status: Planning document only — nothing has been built or executed.**

## 1. Source of Truth for This Plan

This plan is based directly on the structure and content of `Support Cases 2026.xlsx`, currently maintained manually. Key facts pulled from the file:

- **14 sheets**: Overview, Data Insights, Total Case Count, eight month sheets (Jan–Aug), Testing Training &Documentation, Category, OC Implementation.
- **~3,340 support cases** logged across Jan–Aug 2026 (monthly volumes range from 223 to 536 cases).
- The **Overview** sheet documents an intended future state — a "Power BI Guide," "Power BI Cases" (normalized FactCases table), "Power BI Dimensions" (star schema), and "Analysis Summary" sheets — none of which currently exist in the workbook. This tells us reporting/BI is already an acknowledged gap the team wants solved.
- The team supports a suite of travel-agency products (AOS, AQC, CDSR, FO, MPE, RPP, AVH, and many more — 136 distinct product values were found in the data) across a wide set of markets (UAE, Saudi, Nigeria, Kenya, Egypt, and 30+ others).

## 2. Current Workflow (as reflected in the data)

1. A new case is added as a row in the current month's sheet (`Jan`, `Feb`, … `Aug`) by whoever takes the report.
2. Each row captures: Reported Date, Reported by, Customer, Product name, Description, Category, Assigned to, Pending/Closed status, Imp/Supp flag, Remarks, Resolution, Date of Closure, Market.
3. Separately, implementation-type requests are tracked in a dedicated **OC Implementation** sheet (Reported Date, Reported by, Customer, Product name, Description, Assigned to, Status, Date of Closure, Req ID).
4. Non-case work — documentation, testing, training sessions — is logged in its own **Testing Training &Documentation** sheet.
5. A **Total Case Count** sheet is kept up to date by hand as a monthly rollup (Total Cases, AOS Cases, Pending, AOS Pending, AOS Implementations Closed, AOS Deactivations, Revenue).
6. A **Category** sheet holds the reference list of case categories (e.g. "AOS Dev BUG," "AOS-Ticket Pending," "AOS-General Support," "Other Support Cases").
7. **Data Insights** produces a short automatic text summary (e.g. "Aug: 223 cases, 48.9% AOS, 86.1% closed, 31 pending") — a narrative, not an interactive dashboard.
8. A new sheet has to be manually created every month, copying the same 13-column layout.

## 3. Problems This Plan Is Meant To Fix

These are data-quality and process issues visible directly in the workbook, not hypothetical ones:

- **Inconsistent values from free-text entry.** The Status column contains `pending`, `Pending`, and `Closed` as three distinct strings instead of two consistent states. The Assignee column has `subin` and `Subin` as separate values. The Market column has over 10 spellings for what should be a handful of countries (`Cote D Ivorie`, `Cote D Ivory`, `CoteDIvoire`, `Côte d'Ivoire` all refer to the same market; similarly `Nigeria`/`NIGERIA`/`Nigerai`). This breaks any rollup or filter that relies on exact string matches.
- **No enforced category/product list.** 136 distinct product values exist despite the team supporting a known, finite set of products — a strong sign of typos and near-duplicates rather than 136 genuinely different products.
- **Manual monthly setup.** Someone has to remember to create a new month sheet with the correct 13-column layout at the start of every month; the "Data Insights" sheet even instructs the reader to do this ("Add the next month sheet using the standard A:M layout").
- **Rollup by hand.** The Total Case Count sheet is a manually maintained summary — every number in it depends on someone counting/copying correctly from eight separate sheets.
- **No single case history across modules.** A case that starts as a support case and turns into an implementation request has no link between the row in a month sheet and the corresponding row in OC Implementation.
- **Single-file, single-point-of-failure.** Everything lives in one Excel file with no version history, no audit trail of who changed what, and real concurrent-edit risk if more than one person has it open.
- **Reporting is descriptive, not analytical.** "Data Insights" is a hard-coded narrative paragraph, not something you can filter, drill into, or slice by market/product/agent — which is exactly the gap the Overview sheet's planned (but unbuilt) Power BI section is meant to close.

## 4. Proposed Data Model

A single **Case** entity, replacing the month-sheet-per-case pattern with one continuous table:

| Field | Notes |
|---|---|
| Case ID | System-generated, unique, sortable (e.g. `CASE-2026-000001`). Replaces "which row in which month sheet." |
| Reported Date | Date/time captured automatically at entry, editable if backdated. |
| Reported By | Selected from a fixed list of team members, not free text. |
| Customer | Free text, ideally linked to a Customer reference table over time (see §6). |
| Product | Selected from a maintained product list (replaces the 136-variant free-text field). |
| Category | Selected from the existing Category reference sheet, kept as the controlled vocabulary. |
| Description | Free text — same role as today. |
| Assigned To | Selected from a fixed team-member list. |
| Status | Enum: Pending / Closed (and optionally In Progress, Waiting on Customer — to be decided with the team). Replaces inconsistent casing. |
| Type | The existing "Imp/Supp" flag (Implementation / Support / etc.) — formalize what `I`, `D`, `A`, `E` mean and turn into a labeled enum. |
| Market | Selected from a normalized country list (replaces 40+ spelling variants). |
| Remarks | Free text, same as today — often contains WO/IR/task references. |
| Resolution | Free text, filled in at close. |
| Date of Closure | Captured automatically when Status moves to Closed. |
| Linked Req ID | Optional link to an OC Implementation record, so a case and its implementation follow-through are traceable as one thread. |

Two related entities carry over directly from the workbook:

- **Implementation Record** — mirrors the OC Implementation sheet (Customer, Product, Description, Assigned To, Status, Date of Closure, Req ID), linkable to a originating Case.
- **Activity Log Entry** — mirrors Testing Training &Documentation (Date, Documentation/Testing note, Training note), kept as its own log rather than folded into cases, since it isn't case-specific.

## 5. Proposed Modules

1. **Case Intake** — a form (not a spreadsheet row) with dropdowns for Product, Category, Assigned To, Market, and Status, so the data-quality issues in §3 can't recur. Description remains free text.
2. **Case List & Detail View** — replaces "open the right month tab." One continuous, filterable/searchable list across all dates, with a detail view per case showing its full history (including any linked implementation record).
3. **Implementation Tracking** — same fields as today's OC Implementation sheet, with the option to link back to the case that spawned it.
4. **Training & Documentation Log** — same purpose as today's sheet, kept separate from case records.
5. **Reference Data Admin** — a maintained screen (not a raw sheet) for the controlled lists: Categories, Products, Team Members, Markets. This is what prevents the free-text drift seen in the current file.
6. **Reporting Dashboard** — replaces both Total Case Count and Data Insights with live, filterable views:
   - Monthly totals (auto-computed, not hand-maintained) — direct replacement for Total Case Count.
   - Case volume by Product, Category, Market, Assigned To.
   - Open/Pending aging — how long cases have sat unresolved.
   - Close rate and AOS-share style metrics like the ones already in Data Insights, but computed live and filterable by month/product instead of hard-coded text.
   - Optional export to the Power BI star-schema shape the Overview sheet already anticipates (a FactCases table plus dimension tables), so the "planned but not built" Power BI layer described in the workbook becomes a natural export target rather than a from-scratch effort.

## 6. Migration From the Existing Workbook

1. **Normalize before importing.** Build a mapping table for the known messy values before migration — e.g. all Market spelling variants → one canonical value per country, `pending`/`Pending` → one `Pending` status, name-casing variants → one canonical team-member name. This is a one-time cleanup pass, ideally reviewed with the team since some ambiguous product values may need a human judgment call on what they were meant to be.
2. **Import each month sheet (Jan–Aug)** into the new Case table, preserving Reported Date so historical trends stay intact.
3. **Import OC Implementation** as Implementation Records; where a Req ID or description clearly matches an existing case, link them (best-effort automatic match, with a manual review pass for anything ambiguous).
4. **Import Testing Training &Documentation** as-is into the Activity Log.
5. **Rebuild Total Case Count and Data Insights as computed views**, not migrated data — they should never need manual maintenance again.
6. **Keep the original xlsx as a read-only archive** for historical reference/audit even after cutover.

## 7. Roles & Permissions (to confirm with the team)

- **Agent** — can create/update cases, log implementations and activity entries.
- **Team Lead / Admin** — everything an Agent can do, plus managing reference data (Categories, Products, Team Members, Markets) and viewing full reporting.
- Whether customers or external stakeholders ever need read-only visibility into case status is an open question for the team.

## 8. Build Approach Options (not decided — for discussion)

- **Lightweight**: a structured spreadsheet/database (e.g. Airtable, Smartsheet, or a Google Sheet with enforced dropdowns/validation) — fastest to stand up, closest to the team's current comfort zone, weakest on custom reporting.
- **Low-code app**: a purpose-built form + database app (e.g. Airtable interfaces, Power Apps given the team already anticipates Power BI) — moderate effort, strong fit since Power BI integration is already a stated goal in the workbook.
- **Custom web app**: a dedicated case-logging application with its own database — most effort, most control, best long-term fit if case volume or team size keeps growing.

## 9. Open Questions For The Team

- What should the full Status list be — just Pending/Closed, or does the team want more granular states (In Progress, Waiting on Customer, etc.)?
- What do the `I`, `D`, `A`, `E` values in "Imp/Supp" actually stand for? Needed to design that field properly.
- Should Customers be a proper reference list (to catch spelling drift the same way Products/Markets will be), or stay free text?
- Who should have access to reference-data management (Categories/Products/Markets/Team) versus just case entry?
- Is the Power BI export a near-term requirement or a later phase?

## 10. Suggested Phasing

1. **Phase 1** — Data cleanup mapping tables + reference lists (Category, Product, Market, Team) agreed with the team.
2. **Phase 2** — Case Intake + Case List/Detail built on the new data model; historical data migrated in.
3. **Phase 3** — Implementation Tracking + Activity Log modules, linked back to cases.
4. **Phase 4** — Reporting Dashboard (replacing Total Case Count and Data Insights), including the Power BI-ready export.

---

*This document is a plan only. No system has been built, no data has been migrated, and the original workbook has not been modified.*
