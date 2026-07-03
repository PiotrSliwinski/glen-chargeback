# Databricks Chargeback App — Implemented Functionality Reference

**Version:** 1.0 — July 2026
**Scope:** what is actually built and working in [`chargeback-app/`](chargeback-app/) today.
**Companions:** [databricks_chargeback_methodology.md](databricks_chargeback_methodology.md) (the data model this app sits on, referenced below as *Methodology*) and [nextjs_chargeback_app_implementation.md](nextjs_chargeback_app_implementation.md) (the original implementation guide).

The app is the management interface specified in Methodology §10: it **writes only to the mapping
tables** in `main_dev.cost_reporting` (plus the publication snapshot), and everything it reports is
a read of the derived views. This document is the feature inventory: every page, action, export,
rule, and known gap.

---

## Table of Contents

1. [At a Glance](#1-at-a-glance)
2. [Technology & Architecture](#2-technology--architecture)
3. [Authentication & Roles](#3-authentication--roles)
4. [Pages & Navigation](#4-pages--navigation)
5. [Reference Data Management](#5-reference-data-management)
6. [Work Queue](#6-work-queue)
7. [Reporting & Analytics](#7-reporting--analytics)
8. [Exports (CSV & XLSX)](#8-exports-csv--xlsx)
9. [Health, Reconciliation & Publication](#9-health-reconciliation--publication)
10. [Business Rules & Invariants Enforced in Code](#10-business-rules--invariants-enforced-in-code)
11. [Mock Mode (Demo Without Databricks)](#11-mock-mode-demo-without-databricks)
12. [Configuration Reference](#12-configuration-reference)
13. [Verification Status](#13-verification-status)
14. [Not Implemented (Backlog)](#14-not-implemented-backlog)

---

## 1. At a Glance

| Area | What you can do |
|---|---|
| **Reference data** | Full CRUD (within the methodology's rules) on all five mapping tables: product catalogue (versioned), job bridge, warehouse classification, users, workspaces |
| **Work queue** | Five actionable queues of unattributed/unmapped cost with inline, pre-filled fix forms |
| **Reporting** | Dashboard with KPIs and charts, monthly report pack with auto-commentary, domain→product→desk drill-down, printable desk invoices, per-desk self-service pages, tagging scorecard |
| **Exports** | 12 CSV reports + a 6-sheet XLSX report workbook |
| **Governance** | One-click health checks (reconciliation + integrity), publication diff, gated monthly publication with typed confirmation |
| **Access control** | Entra ID SSO, three hierarchical roles (viewer / steward / publisher) enforced at proxy, page, and action level |
| **Dev experience** | Runs fully on in-memory mock data with auth bypass — `npm run dev` works with zero external services |

---

## 2. Technology & Architecture

- **Next.js 16** (App Router, TypeScript, Turbopack) with **Cache Components** enabled: DAL reads
  are `'use cache'` functions tagged for invalidation; mutations call `updateTag` for
  read-your-writes freshness. All routes build as partially prerendered.
- **`@databricks/sql`** driver over a SQL Warehouse, service-principal M2M OAuth. One shared
  client per server process, a session per query, **all statements parameterized** — the only
  interpolated value is the schema prefix, regex-validated at boot.
- **NextAuth v5** with Microsoft Entra ID; roles resolved from Entra group claims.
- **zod** at both trust boundaries: every mutation input and every SQL result row.
- Server-rendered UI (Tailwind); the only client components are forms (`useActionState`), the
  month picker, nav highlighting, and the print button. No client charting library — charts are
  server-rendered divs.

**Layer map** (all under `chargeback-app/src/`):

| Layer | Path | Responsibility |
|---|---|---|
| Request gate | `proxy.ts` | Optimistic session-cookie check, redirect to `/login` |
| Auth / RBAC | `lib/auth.ts`, `lib/rbac.ts`, `lib/guards.ts` | Session, role hierarchy, page/action guards |
| DAL | `dal/*` | The only SQL in the app; every module has a real branch and a mock branch |
| Business rules | `services/*` | Catalogue versioning, integrity post-conditions, typed domain errors |
| Mutations | `actions/*` | Server actions: role → zod → service → cache invalidation → structured result |
| Pages | `app/(app)/*` | Server components; Suspense-wrapped dynamic content |
| Exports | `app/api/export/*` | CSV and XLSX route handlers |

**Cache tags:** `reports-live`, `reports-published`, `catalogue`, `mappings`, `queue`, `health`.
Each mutation expires exactly the tags it affects.

---

## 3. Authentication & Roles

- **Sign-in:** Microsoft Entra ID via NextAuth (`/login`, `/api/auth/*`). The app registration
  must emit the **groups claim**; three group object IDs map to roles.
- **Roles are hierarchical** — `viewer < steward < publisher`:

| Capability | viewer | steward | publisher |
|---|---|---|---|
| Dashboard, report pack, drill-down, desks, invoices, CSV/XLSX report exports | ✅ | ✅ | ✅ |
| Work queue + all inline fixes | — | ✅ | ✅ |
| Reference-data admin (all five tables) | — | ✅ | ✅ |
| Health page, re-run checks, queue/catalogue exports | — | ✅ | ✅ |
| Publish a month | — | — | ✅ |

- **Enforcement depth:** proxy (cookie presence) → page (`requirePageRole`, redirects) → every
  server action and export route (`requireRole` / `atLeast`, returns structured error). UI
  hiding is a courtesy on top, never the control.
- **Dev bypass:** `AUTH_DEV_BYPASS=true` skips SSO and acts as a fixed user with
  `AUTH_DEV_ROLE` (default `publisher`) — local development only.

---

## 4. Pages & Navigation

| Route | Role | Purpose |
|---|---|---|
| `/` | viewer | Chargeback dashboard (landing) |
| `/report` | viewer | Monthly report pack |
| `/drill` | viewer | Domain → product → desk → detail drill-down |
| `/desks`, `/desks/[desk]` | viewer | Desk self-service views |
| `/invoices`, `/invoices/[desk]` | viewer | Published desk invoices |
| `/queue` | steward | Work queue (5 tabs) |
| `/admin` (+ 5 sub-pages) | steward | Reference-data management |
| `/health` | steward (publish: publisher) | Checks, diff, publication |
| `/login` | public | Sign-in |

Shared UI state: **month and live/published mode live in the URL** (`?month=2026-06&mode=published`)
so every view is linkable. Default month is the last closed month. A colored **mode banner** makes
live vs published unmistakable; a **mock-mode banner** shows when fixtures are serving the data.
Every reporting page renders the Methodology §11 **limitations footer**.

**Info tooltips**: every page title and KPI tile carries an ⓘ tooltip (hover or keyboard focus)
explaining what the page does and exactly how the figure is calculated — source table, formula,
and mode behavior. Copy is centralised in `src/lib/kpi-help.ts`; the CSS-only `<InfoTip>`
component (`src/components/ui.tsx`) is server-rendered and hidden in print.

---

## 5. Reference Data Management

The write surface (Methodology §4). All writes: steward+, zod-validated, audited
(`mapped_by`/`mapped_at` where columns exist), integrity-checked, cache-invalidating.

### 5.1 Product catalogue — `/admin/products` (`data_product_mapping`)

The hierarchy backbone: domain and desk always derive from here, never from tags.

| Operation | Behavior |
|---|---|
| **Register product** | Key format enforced (`^[a-z0-9]+([_-][a-z0-9]+)*$` — the tag vocabulary); duplicate-active and historical-overlap checks; `valid_from` defaults to first of next month |
| **Move to another desk/domain** | **One atomic `MERGE`** closes the active validity window at the cutover and inserts the successor row — never an in-place UPDATE, so published history never restates. UI states explicitly that history before the cutover keeps the old desk |
| **Edit owner** | In-place update (owner is metadata, not hierarchy) |
| **Retire** | Sets `valid_to`; **blocked** while job/warehouse bridge rows still reference the product; later usage falls to the work queue |
| **Delete** | Not offered, ever (Methodology §10.7.3) |

Each product renders as a card: active version, full **validity history timeline**, bridge-reference
badges, and the three operation forms. Every write runs the scoped §7.4 checks as a post-condition.

### 5.2 Job bridge — `/admin/jobs` (`job_product_mapping`)

- Add mapping (workspace + job id composite key; duplicate-key rejected; product must exist in
  the catalogue — §7.4(b) checked before commit).
- Remove mapping (with a "spend falls back to the queue" warning).
- **Janitor panel**: bridge rows whose jobs emitted TAG-attributed cost in the last 30 days are
  flagged "safe to remove — now tagged at source" with one-click removal (Methodology §8.3 /
  Phase 4 pruning made continuous).
- Every add form reminds stewards the durable fix is tagging at source.

### 5.3 Warehouses — `/admin/warehouses` (`warehouse_product_mapping`)

- Classify/reclassify each warehouse **Shared** (per-query allocation) or **Dedicated** (whole
  warehouse incl. idle cost → one product). The form makes §7.4(d)-invalid combinations
  (dedicated without product, shared with product) unrepresentable, and the server re-validates.

### 5.4 Users — `/admin/users` (`user_mapping`)

- Add / edit (display name, home desk with autocomplete over known desks) / remove.
- `user_id` is **read-only in edit forms** — it must match `executed_by` /
  `identity_metadata.run_as` byte-for-byte; wrong identity = remove + re-add from the work queue
  where the value is pre-filled from system tables.
- Remove warns in waterfall terms: the runner's AD_HOC spend loses its desk (rule 4 stops
  matching) and the runner resurfaces in the queue if they keep spending.

### 5.5 Workspaces — `/admin/workspaces` (`workspace_mapping`)

- Add / rename / remove. Rename is cosmetic (report labels only). Remove warns that a
  still-billing workspace shows as `UNMAPPED: <id>` — spend is never dropped.
- **Schema note:** the deployed table has `workspace_id BIGINT` (methodology DDL says STRING);
  writes cast explicitly and all ID reads coerce via a shared `zId` parser.

---

## 6. Work Queue

`/queue` — the operational heart (Methodology §10.4): unattributed and unmapped cost drivers over
the trailing 30 days, with a KPI strip (total unallocated $, open item count) and five tabs, each
row carrying an inline, pre-filled fix form:

| Tab | Source (Methodology) | Inline action |
|---|---|---|
| Untagged jobs | §7.2 first query | "Map to product" → job bridge insert (+ tag-at-source reminder) |
| Unknown runners | §7.2 second query | "Add user" → `user_mapping` (user_id read-only, pre-filled) |
| Unknown workspaces | §7.2 third query | "Add workspace" → `workspace_mapping` |
| Rogue tags | §7.3 | "Register as product" (key pre-filled = tag value) or flag for tag fix at source |
| Unassigned warehouses | dedicated-warehouse candidates with idle share | "Assign warehouse" → shared/dedicated upsert |

Fixes affect **live** views immediately (page states this); published months never change. Each
tab has a CSV download. Successful fixes remove the row from the queue.

---

## 7. Reporting & Analytics

### 7.1 Dashboard — `/`

- KPI tiles: total cost · MoM Δ (abs + %) · TAG coverage % · **unallocated cost** (clicks through
  to the work queue for stewards).
- Cost by domain (bar list, click-through to drill), 12-month stacked trend by domain,
  attribution-coverage 100%-stacked bar with method legend.
- Live/published toggle; published mode refuses to silently fall back when a month isn't published.

### 7.2 Monthly report pack — `/report`

The distribution-ready document, print-optimized, five numbered sections:

1. **Executive summary** — KPI tiles.
2. **Month-over-month movement by desk** (Methodology §7.5) — prev/current/Δ/Δ% table plus
   **auto-generated driver commentary** (e.g. *"rates: +$3,576 (+8.0%) — driven by
   pricing-curves (+$2,024)"* — largest same-direction product move per desk).
3. **Cost breakdown** — domain → product → desk with domain subtotals and share-of-total.
4. **Attribution coverage** — chart + exact-cost table, with the §6.3 goal state stated.
5. **Tagging scorecard by desk** — TAG% leaderboard from live `cost_fact`, unattributed (NONE)
   cost per desk. The adoption lever of Methodology §8.

Plus a downloads strip (XLSX workbook + 5 CSVs) and the limitations footer.

### 7.3 Drill-down — `/drill`

Three linked, URL-driven panels: domains → products in domain (with desk links) → product detail
(top 200 `cost_fact` lines: category, job/warehouse, runner, DBUs, cost). Every detail line shows
its **attribution-method badge** (TAG green / JOB_MAPPING amber / WAREHOUSE_MAPPING blue / USER
indigo / NONE red) — the "why did this land here" transparency — plus a **compute chip**
(SERVERLESS violet / CLASSIC slate, from `cost_fact.is_serverless`; per-query warehouse rows
show "—").

### 7.4 Desk self-service — `/desks`, `/desks/[desk]`

- Desk cards with live month totals; **"your desk" highlighted** when the signed-in user's email
  is in `user_mapping`.
- Per-desk detail: KPI strip (month cost, MoM, the desk's own TAG coverage and NONE cost),
  12-month cost trend, published-invoice history with statement links, product breakdown with
  share-of-desk and drill links.
- **"How this number was built"**: usage category × compute rollup (bar list + table) with the
  desk's serverless / classic / per-query-warehouse split, sourced from live `cost_fact`.
- **Line-item construction**: every `cost_fact` slice that landed on the desk (top 500), grouped
  by usage category with subtotals — product (drill link), job or warehouse, runner, compute
  chip, attribution badge, DBUs, cost, share of desk.

### 7.5 Desk invoices — `/invoices`, `/invoices/[desk]`

- Read the **published snapshot only** — never live data, no silent fallback (an unpublished
  month shows an explicit notice instead).
- Printable statement: desk header, domain/product breakdown, exact totals, immutability note,
  limitations footer; Print/PDF button and CSV download.

---

## 8. Exports (CSV & XLSX)

### CSV — `GET /api/export/[report]?month=YYYY-MM&mode=live|published[&desk=]`

| Report | Role | Content |
|---|---|---|
| `monthly-chargeback` | viewer | Full month × domain × product × desk × category rows |
| `coverage` | viewer | Attribution method shares |
| `movement` | viewer | Desk MoM deltas |
| `movement-products` | viewer | Product-level MoM deltas |
| `scorecard` | viewer | Per-desk TAG%/NONE leaderboard |
| `desk-invoice` (`&desk=`) | viewer | One desk's published statement |
| `catalogue` | steward | Full product catalogue incl. history |
| `queue-jobs` / `queue-runners` / `queue-workspaces` / `queue-tags` / `queue-warehouses` | steward | The five work queues |

RFC-4180 escaping, attachment filenames like `movement-2026-06-live.csv`, 404 for unknown
reports, 401/403 on auth failures.

### XLSX — `GET /api/export/xlsx?month=&mode=` (viewer+)

One workbook, six sheets: **Summary** (KPIs, driver commentary, limitations), **Movement**,
**Breakdown**, **Coverage**, **Scorecard**, **Invoices** (all desks; included only when the month
is published). Currency/percent number formats, bold frozen headers, auto-width columns.

---

## 9. Health, Reconciliation & Publication

`/health` (steward+; publishing publisher-only):

- **Reconciliation table** (Methodology §7.1): billing truth vs `cost_fact` vs report, per month,
  with pass/fail chips against the configurable tolerance (`RECON_TOLERANCE_USD`, default $1).
- **Integrity checks** (§7.4 a–d): validity overlaps, orphan bridge products, duplicate bridge
  keys, inconsistent warehouse flags — listed as explicit violations or a green all-clear.
- **Re-run checks** button (expires the `health` cache tag).
- **Publication diff**: before publishing, the candidate month's **live desk totals (what the
  snapshot will freeze)** side-by-side with the last published month, with per-desk deltas — the
  publisher signs off on numbers, not just green checks.
- **Gated publication**: enabled only when reconciliation is within tolerance, integrity is
  clean, the month is closed, and not already published. Requires **typing the month** to
  confirm. The gate **re-runs server-side at submit** — a stale green button cannot publish a
  broken month. Publishing is one atomic `INSERT…SELECT` into `monthly_chargeback_published`.
- Re-publication of an already-published month is refused.

---

## 10. Business Rules & Invariants Enforced in Code

1. **Single write surface** — the app writes only the five mapping tables and the publication
   snapshot; all reporting is derived reads.
2. **History never restates** — desk/domain changes are atomic close-and-insert (single `MERGE`,
   because Databricks has single-statement atomicity only); no catalogue deletes; published
   snapshots are immutable and invoices read only them.
3. **Referential integrity before commit** — bridge rows may only reference existing catalogue
   products; §7.4 checks run as post-conditions on catalogue writes.
4. **Identity fidelity** — user/workspace IDs are pre-filled from system data in queue flows and
   read-only in edit forms.
5. **Nothing is silently dropped** — unmapped workspaces render as `UNMAPPED: <id>`, unclaimed
   spend as `UNALLOCATED`, and removals warn about where the cost will reappear.
6. **No raw errors cross the wire** — every mutation returns a typed
   `ActionResult` (`ok` / `code` + human message); unexpected errors are logged server-side only.
7. **Least-visibility RBAC** — enforcement at action/route level with UI gating as convenience.

---

## 11. Mock Mode (Demo Without Databricks)

Auto-enabled when `DATABRICKS_HOST` is unset (or forced with `DAL_MOCK=true`); a banner shows
whenever fixtures are live. Every DAL module branches to a shared in-memory store
(`dal/mock.ts`, HMR-stable via `globalThis`), so the **entire workflow is demoable**, including
mutations: mapping a job removes it from the queue, publishing adds the month, the janitor row
disappears when removed.

Fixture world: 7 months (2026-01…07) with growth trend, 3 domains, 6 catalogue products (one
with a desk-move history: `pricing-curves`, fx → rates at 2026-05-01), 3 desks, 5 users,
3 workspaces, populated queues (4 untagged jobs, 3 unknown runners, 1 unknown workspace,
2 rogue tags, 2 warehouse candidates), reconciliation rows with sub-dollar gaps, 5 published
months, and one janitor-eligible bridge row.

---

## 12. Configuration Reference

See [`chargeback-app/.env.example`](chargeback-app/.env.example). Summary:

| Variable | Purpose |
|---|---|
| `DATABRICKS_HOST` / `DATABRICKS_HTTP_PATH` / `DATABRICKS_CLIENT_ID` / `DATABRICKS_CLIENT_SECRET` | SQL Warehouse + service-principal M2M OAuth (unset host ⇒ mock mode) |
| `DBX_SCHEMA` | Schema prefix (default `main_dev.cost_reporting`), regex-validated |
| `DAL_MOCK` | Force fixture mode |
| `AUTH_SECRET`, `AUTH_URL`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | SSO |
| `ENTRA_GROUP_VIEWER` / `_STEWARD` / `_PUBLISHER` | Group-object-id → role mapping |
| `AUTH_DEV_BYPASS`, `AUTH_DEV_ROLE` | Local dev bypass |
| `RECON_TOLERANCE_USD` | Publication gate tolerance (default 1) |

All config is zod-validated at boot (fail fast). Databricks-side prerequisites (UC grants, audit
columns, materialization job) are listed in the app README and the implementation guide.

---

## 13. Verification Status

Honest statement of what has and hasn't been exercised:

- ✅ `tsc --noEmit`, ESLint, and `next build` pass (all routes partially prerendered).
- ✅ Every page smoke-tested against the production build in mock mode (HTTP 200 + expected
  content), including drill paths, invoices, queue, admin screens, health.
- ✅ CSV endpoints verified row-by-row against fixtures; XLSX verified as a valid workbook with
  all six sheets; unknown-report 404 verified.
- ✅ Mock mutations verified end-to-end where UI-visible (queue row removal, janitor).
- ⚠️ The **real-Databricks SQL branch is faithful to the methodology but untested against a live
  warehouse** (no credentials in the dev environment). First run against real data should start
  with the health page and a read-only browse.
- ⚠️ No automated test suite yet (see backlog).

---

## 14. Not Implemented (Backlog)

| Item | Notes |
|---|---|
| Budgets & burn rate | Needs a new `desk_budget` reference table + admin screen; then MTD vs budget with month-end projection |
| Anomaly flags | Daily product cost vs trailing baseline (z-score) on the dashboard |
| What-if move preview | Show desk-total impact of a catalogue move before the cutover |
| Scheduled distribution | Email/Teams delivery of published invoices and the report pack |
| Statement-text drill | On-demand `statement_text` fetch from `system.query.history` (needs UC grant) |
| Async health runner | Move §7.1 reconciliation to a scheduled Databricks Workflow writing `app_health_runs`; page reads the latest run |
| Automated tests | Vitest for `services/` (versioning edge cases), Playwright golden paths, RBAC E2E |
| Audit trail screen | Browsable `mapped_by`/`mapped_at` + Delta history feed |
| Correction/restatement workflow | Superseding snapshots with later `published_at` — only if finance ever needs restatements |
| Multi-desk splits | `data_product_split` (Methodology §4.6) — deliberately deferred |

---

*End of document.*
