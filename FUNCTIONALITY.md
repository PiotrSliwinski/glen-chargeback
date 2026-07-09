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
3. [Identity & Roles](#3-identity--roles)
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
| **Reference data** | Full CRUD (within the methodology's rules) on all eight Databricks mapping tables — product catalogue (versioned), job bridge, unified tag rules (one scoped table serving Databricks AND Azure), warehouse classification, AI endpoint bridge, runner rules, users, workspaces — plus the three Azure-specific attribution rule tables (resource bridge, resource-group rules, subscription rules) and DBU reservation-discount windows (`dbu_discount_plan`) |
| **Azure attribution** | Route Azure spend (`azure_cleaned.amortized_costs`) to the same product catalogue via an allowlist waterfall (TAG → resource bridge → tag rule → RG rule → subscription rule), with a 30-day coverage audit, per-desk rollup and a dedicated monthly Azure cost-monitoring screen (`/azure`) — only matched cost reaches a desk |
| **Work queue** | Seven actionable queues of unattributed/unmapped cost — Databricks, Azure and AI — with inline, pre-filled fix forms and bulk actions |
| **Attribution policy** | Category-aware waterfall in `cost_fact`: **interactive spend is user-first** — serverless SQL-warehouse queries and AI serving run by a mapped user bill that user's desk (AD_HOC) BEFORE any tag; **automated spend is tag-first** — jobs (and job-launched `ai_query` batch) and Azure resources attribute by tags/rules, and job cost never defaults to the runner. AI spend with no attributable user (NULL/unmapped `run_as`) falls to tags and the endpoint bridge |
| **Reporting** | Dashboard with KPIs and charts, monthly report pack with auto-commentary, domain→product→desk drill-down, an advanced-analytics page (unit economics, auto-generated key findings, cross-source tagging scorecard), an AI-costs page (model serving incl. `ai_query` batch inference, per-endpoint spend), printable desk invoices, per-desk self-service pages, tagging scorecard |
| **Exports** | 16 CSV reports + a 6-sheet XLSX report workbook |
| **Governance** | One-click health checks (reconciliation + integrity), publication diff, gated monthly publication with typed confirmation |
| **Access control** | No user sign-in — the app runs as one fixed identity; `APP_ROLE` (viewer / steward / publisher) caps capability. Gate reachability at the network/platform layer |
| **Dev experience** | Runs fully on in-memory mock data with no sign-in — `npm run dev` works with zero external services |

---

## 2. Technology & Architecture

- **Next.js 16** (App Router, TypeScript, Turbopack) with **Cache Components** enabled: DAL reads
  are `'use cache'` functions tagged for invalidation; mutations call `updateTag` for
  read-your-writes freshness. All routes build as partially prerendered.
- **`@databricks/sql`** driver over a SQL Warehouse, Entra ID token via `DefaultAzureCredential`.
  One shared
  client per server process, a session per query, **all statements parameterized** — the only
  interpolated value is the schema prefix, regex-validated at boot.
- **No user authentication** — the app runs as one fixed identity (`APP_ROLE` / `APP_USER`);
  access is gated at the network/platform layer, not in-app.
- **zod** at both trust boundaries: every mutation input and every SQL result row.
- Server-rendered UI (Tailwind); the only client components are forms (`useActionState`), the
  month picker, nav highlighting, and the print button. No client charting library — charts are
  server-rendered divs.

**Layer map** (all under `chargeback-app/src/`):

| Layer | Path | Responsibility |
|---|---|---|
| Request boundary | `proxy.ts` | Request-trace marker only (no auth gate — single fixed identity) |
| Identity / RBAC | `lib/auth.ts`, `lib/rbac.ts`, `lib/guards.ts` | Fixed identity, role hierarchy, page/action guards |
| DAL | `dal/*` | The only SQL in the app; every module has a real branch and a mock branch |
| Business rules | `services/*` | Catalogue versioning, integrity post-conditions, typed domain errors |
| Mutations | `actions/*` | Server actions: role → zod → service → cache invalidation → structured result |
| Pages | `app/(app)/*` | Server components; Suspense-wrapped dynamic content |
| Exports | `app/api/export/*` | CSV and XLSX route handlers |

**Cache tags:** `reports-live`, `reports-published`, `catalogue`, `mappings`, `queue`, `health`,
`azure`. Each mutation expires exactly the tags it affects.

---

## 3. Identity & Roles

- **No user sign-in:** the app runs as one fixed identity (`APP_USER` / `APP_USER_EMAIL` /
  `APP_ROLE`) and connects to Databricks as a service principal or via `az login`. Restrict who
  can reach the app at the network/platform layer (VPN, Entra Application Proxy, App Service
  authentication).
- **Roles are hierarchical** — `viewer < steward < publisher`. `APP_ROLE` (default `publisher`)
  is the single role the app runs at; set it to `viewer` for a read-only deployment:

| Capability | viewer | steward | publisher |
|---|---|---|---|
| Dashboard, report pack, drill-down, desks, invoices, CSV/XLSX report exports | ✅ | ✅ | ✅ |
| Work queue + all inline fixes | — | ✅ | ✅ |
| Reference-data admin (all eight tables) | — | ✅ | ✅ |
| Health page, re-run checks, queue/catalogue exports | — | ✅ | ✅ |
| Publish a month | — | — | ✅ |

- **Enforcement depth:** page (`requirePageRole`, redirects) → every server action and export
  route (`requireRole` / `atLeast`, returns structured error). With a single fixed identity these
  enforce the `APP_ROLE` ceiling; UI hiding is a courtesy on top, never the control.

---

## 4. Pages & Navigation

| Route | Role | Purpose |
|---|---|---|
| `/` | viewer | Chargeback dashboard (landing) |
| `/report` | viewer | Monthly report pack |
| `/drill` | viewer | Domain → product → desk → detail drill-down |
| `/analytics` | viewer | Advanced analytics — cost drivers, unit economics, movers, cross-source tagging scorecard |
| `/ai` | viewer | AI cost tracking (model serving, batch inference, vector search) |
| `/azure` | viewer | Azure cost monitoring (the whole Azure bill, attribution mix, per-resource detail) |
| `/desks`, `/desks/[desk]` | viewer | Desk self-service views |
| `/invoices`, `/invoices/[desk]` | viewer | Published desk invoices |
| `/queue` | steward | Work queue (7 tabs, grouped Databricks / Azure / AI) |
| `/admin` (+ 8 sub-pages) | steward | Reference-data management (incl. `/admin/azure`, `/admin/endpoints`, `/admin/discounts`) |
| `/health` | steward (publish: publisher) | Checks, diff, publication |

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

The hierarchy backbone: domain and desk always derive from here, never from tags. A product is
billed to one desk (one row, `cost_split_pct = 1.0`) or **split across several desks by % share**
(one active row per desk, shares summing to 100%) — `cost_fact` fans each cost line out per desk
and scales it by the share.

| Operation | Behavior |
|---|---|
| **Register product** | Key format enforced (`^[a-z0-9]+([_-][a-z0-9]+)*$` — the tag vocabulary); duplicate-active and historical-overlap checks; `valid_from` defaults to first of next month. The desk split editor defaults to one desk at 100%; "Add desk" opens a % split (client + server validated: unique desks, shares in (0, 100], total exactly 100%) |
| **Move / change desk split** | **One atomic `MERGE`** closes ALL active desk rows at the cutover and inserts the successor split — never an in-place UPDATE, so published history never restates. UI states explicitly that history before the cutover keeps the old split |
| **Edit owner** | In-place update on all active desk rows (owner is metadata, not hierarchy) |
| **Retire** | Sets `valid_to` on all active desk rows; **blocked** while job/warehouse bridge rows or tag/runner rules still reference the product; later usage falls to the work queue |
| **Delete** | Not offered, ever (Methodology §10.7.3) |

Each product renders as a card: active version (desk shares shown when split), full **validity
history timeline** (one line per window, past splits with their shares), bridge-reference
badges, and the three operation forms. Every write runs the scoped §7.4 checks as a post-condition.

### 5.2 Job mapping — `/admin/jobs` (`job_product_mapping`, `tag_product_mapping`, `runner_product_mapping`)

One page for the three explicit mechanisms that route job spend to a product. **Job spend never
defaults to the runner's home desk** — jobs are created by the data platform but their output is
consumed by desks, so an unresolved job goes to the work queue instead of silently billing the
platform team. The `USER` rule applies to non-job spend only: it fires FIRST for interactive
spend (serverless warehouse queries, AI serving run by a mapped user) and last-resort for other
ad-hoc spend.

**Job bridge (rule 2):**

- Add mapping (workspace + job id composite key; duplicate-key rejected; product must exist in
  the catalogue — §7.4(b) checked before commit).
- Remove mapping (with a "spend falls back to the queue" warning).
- **Janitor panel**: bridge rows whose jobs emitted TAG-attributed cost in the last 30 days are
  flagged "safe to remove — now tagged at source" with one-click removal (Methodology §8.3 /
  Phase 4 pruning made continuous).

**Tag rules (rule 3, unified):**

- Any tag `key=value` → product; catches workloads tagged with team/project tags but no
  `data_product` tag. One rule covers every current and future item carrying the tag.
- **One table for both clouds**: `tag_product_mapping` carries a `scope` column
  (`databricks` | `azure` | `both`) and drives rule 3 of the Databricks AND the Azure
  waterfall — the same card appears on `/admin/jobs` and `/admin/azure`. Each screen lists
  the rules covering ITS side (own scope + `both`); rules scoped only to the other side sit
  behind a collapsed expander so they can't be mistaken for local ones. The add-form's
  default scope matches the screen. `both` is for organisation-wide tags that mean the same
  thing in either namespace.
- Duplicate `(key, value)` with **overlapping scopes** rejected (a `databricks` rule next to
  an `azure` rule on the same key is fine — they can never match the same record);
  conflicting rules resolve deterministically in the facts (alphabetically first
  `key=value`) and are flagged on the health page.

**Runner rules (rule 5):**

- Everything an identity (typically a platform service principal) runs → product. The explicit
  opt-in replacement for the removed implicit runner default. One rule per `user_id`.

**Rule editing (all four rule tables — tag, runner, RG, subscription):** every rule row has an
in-place **Edit** that re-points it at a different product (note included) — all spend the rule
carries follows. The rule's key (tag key+value+scope / identity / subscription+RG) is its
identity and stays fixed; changing it is remove + re-add.

- Every add form reminds stewards the durable fix is tagging at source with `data_product`.

### 5.3 Warehouses — `/admin/warehouses` (`warehouse_product_mapping`)

- Classify/reclassify each warehouse **Shared** (per-query allocation) or **Dedicated** (whole
  warehouse incl. idle cost → one product). The form makes §7.4(d)-invalid combinations
  (dedicated without product, shared with product) unrepresentable, and the server re-validates.

### 5.3b AI endpoints — `/admin/endpoints` (`endpoint_product_mapping`)

- Waterfall **rule 4b**: one AI/model-serving endpoint → one product — the serving analogue of a
  dedicated warehouse. ALL of the endpoint's spend, realtime inference and `ai_query` batch
  inference alike, bills to that product. Composite key `(workspace_id, endpoint_name)` because
  endpoint names are only unique per workspace; `endpoint_name` must match
  `usage_metadata.endpoint_name` byte-for-byte.
- **Unmapped endpoints live in the work queue** (`/queue?tab=endpoints`): endpoints whose
  trailing-30-day spend fell to `UNALLOCATED` (`attribution_method = NONE` in live `cost_fact`)
  are fixed there, inline and in bulk; this page shows a banner with the count/cost pointing at
  the queue.
- Add mapping (duplicate key rejected; product must exist — §7.4(b) checked before commit) and
  remove mapping (with a "falls back to UNALLOCATED" warning). Every form reminds stewards the
  durable fix is a `data_product` tag on the endpoint at source.

### 5.4 Users — `/admin/users` (`user_mapping`)

- Add / edit (display name, home desk with autocomplete over known desks) / remove.
- `user_id` is **read-only in edit forms** — it must match `executed_by` /
  `identity_metadata.run_as` byte-for-byte; wrong identity = remove + re-add from the work queue
  where the value is pre-filled from system tables.
- Remove warns in waterfall terms: the runner's AD_HOC spend loses its desk (the user-first
  and rule-6 branches stop matching) and the runner resurfaces in the queue if they keep
  spending. The rule only ever applies to non-job spend.

### 5.5 Workspaces — `/admin/workspaces` (`workspace_mapping`)

- Add / rename / remove. Rename is cosmetic (report labels only). Remove warns that a
  still-billing workspace shows as `UNMAPPED: <id>` — spend is never dropped.
- **Schema note:** the deployed table has `workspace_id BIGINT` (methodology DDL says STRING);
  writes cast explicitly and all ID reads coerce via a shared `zId` parser.

### 5.6 Azure attribution — `/admin/azure` (`azure_resource_product_mapping`, `tag_product_mapping` scope azure/both, `azure_rg_product_mapping`, `azure_subscription_product_mapping`)

Attributes Azure spend from `main_dev.azure_cleaned.amortized_costs` to **the same product
catalogue** as Databricks spend — domain, desk, validity versioning and multi-desk % splits all
derive from `data_product_mapping`. Two views, mirroring the jobs screen:

**Mapping rules** — the Azure waterfall (implemented in the `azure_cost_fact` view):

| Rule | Mechanism | Analogue on the jobs screen |
|---|---|---|
| 1 `TAG` | `data_product` tag on the resource itself — always wins | tag at source |
| 2 `RESOURCE_MAPPING` | resource bridge: one ARM resource ID → product (tech debt; janitor panel flags rows whose resource is now tagged at source; per-row and bulk re-map / delete) | job bridge |
| 3 `TAG_RULE` | any Azure resource tag `key=value` → product (the UNIFIED `tag_product_mapping`, rules with scope `azure`/`both` — same table as the Databricks tag rules) | tag rule |
| 4 `RESOURCE_GROUP` | whole (subscription, resource group) → product | dedicated warehouse |
| 5 `SUBSCRIPTION` | whole subscription → product | runner rule |
| 6 `NONE` | stays `UNALLOCATED` — visible in coverage, **never billed to a desk** | work queue |

**Attribution is an allowlist**: only matched cost reaches desks. The unmatched remainder of the
Azure bill (shared platform infrastructure etc.) is expected and is deliberately **not** merged
into the Databricks `cost_fact` / `monthly_chargeback`, so the §7.1 reconciliation invariant
(billing = fact = report) is untouched. Desk-facing Azure rollups read the parallel
`azure_monthly_chargeback` view.

**Coverage — last 30 days** — audit of every Azure resource with cost: its actual tags (chips,
`data_product` highlighted, boilerplate collapsed), the attribution method(s) that carried the
cost, per-desk "Azure cost reaching desks" rollup, method filter buttons, and status chips
("tag landed — bridge removable", "unmatched — not billed", …).

ARM identifiers (resource IDs, subscription GUIDs, RG names) are **lowercased at the write
boundary** and in `azure_usage_view`, so rule joins are case-insensitive. The tags column is
parsed defensively (outer braces restored when the export omits them). Duplicate rule keys are
rejected by the actions and deduplicated (`MIN`) in the view so they can never fan out cost.

### 5.7 DBU discounts — `/admin/discounts` (`dbu_discount_plan`)

Purchased DBU reservation plans (Methodology §4.9): date windows (**both days inclusive**)
billing Databricks DBU spend at list price × (1 − discount). Applied at pricing time inside
`query_view` / `usage_view` — `usage_unit = 'DBU'` rows only, never Azure cost — so
`cost_fact`, reports, invoices and the health reconciliation all inherit the discounted rate.

- KPI tiles: discount in effect today, window count, next scheduled window; rows carry an
  active / scheduled / expired status chip.
- **Add plan** (first day, last day, % off list entered as a percentage, optional contract/PO
  note). The action rejects reversed dates, percentages outside (0, 100], and any overlap with
  an existing window — one discount per day.
- **Remove plan** (to change a plan, remove it and add a corrected one). Changes re-price live
  views immediately; published months keep the figures they were published with.
- Windows edited directly in the DB are re-checked on the health page (`discount_overlap`,
  `discount_range`), and the reconciliation prices billing truth with the same discount so the
  §7.1 invariant keeps holding.

---

## 6. Work Queue

`/queue` — the operational heart (Methodology §10.4): unattributed and unmapped cost drivers over
the trailing 30 days across **all three sources**. KPI strip: total unallocated $ (Databricks +
Azure + AI, each dollar counted once) plus a per-source tile each; the open-item count sits in
the page subtitle and the per-tab badges. Tabs are grouped **Databricks / Azure / AI**; every row
carries an inline, pre-filled fix form and every tab has a bulk action:

| Group | Tab | Source | Inline action (bulk analogue) |
|---|---|---|---|
| Databricks | Untagged jobs | §7.2 first query (rows with an endpoint dimension belong to the AI tab) | "Map to product" → job bridge insert (+ tag-at-source reminder) |
| Databricks | Unknown runners | §7.2 second query | "Add user" → `user_mapping` (user_id read-only, pre-filled) |
| Databricks | Unknown workspaces | §7.2 third query | "Add workspace" → `workspace_mapping` (bulk: names default to the ID) |
| Databricks | Rogue tags | §7.3 | "Register as product" (key pre-filled = tag value) or — for typos — "Map via tag rule" (`data_product=<mis-tag>` → product, scope databricks) |
| Databricks | Unassigned warehouses | dedicated-warehouse candidates with idle share | "Assign warehouse" → shared/dedicated upsert |
| Azure | Unmatched resources | `azure_cost_fact` `NONE` rows | "Map to product" → resource bridge insert; RG/subscription rules stay on `/admin/azure` |
| AI | Unmapped endpoints | endpoint spend fallen to `UNALLOCATED` (was the `/admin/endpoints` panel) | "Map endpoint" → endpoint bridge; user-first reminder links the runners tab |

Queue readers are uncapped, so badges and cost tiles are honest for backlogs of any size (the
page paginates). Fixes affect **live** views immediately (page states this); published months
never change. Each tab has a CSV download. Successful fixes remove the row from the queue.

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
its **attribution-method badge** (TAG green / JOB_MAPPING amber / TAG_RULE teal /
WAREHOUSE_MAPPING sky / ENDPOINT_MAPPING fuchsia / PIPELINE_MAPPING blue / RUNNER_RULE purple / USER indigo / NONE red) — the "why did this land
here" transparency — plus a **compute chip**
(SERVERLESS violet / CLASSIC slate, from `cost_fact.is_serverless`).

### 7.3b AI costs — `/ai`

Dedicated lens on AI-native spend, fed by the **same** `monthly_chargeback` / `cost_fact` reads
as every other report (so AI figures always reconcile with the monthly chargeback):

- **Scope** = the AI billing categories: `MODEL_SERVING` (realtime endpoints and `ai_query`
  batch inference alike), `VECTOR_SEARCH`, `FOUNDATION_MODEL_TRAINING`, `AGENT_EVALUATION`
  (`AI_CATEGORIES` in `src/dal/ai.ts`).
- KPI tiles: AI cost (+ share of the month's bill), MoM Δ, **batch-inference share**
  (`product_features.model_serving.offering_type = 'BATCH_INFERENCE'`), unallocated AI cost.
- AI cost by category with blended $/DBU; 12-month stacked AI trend (live history).
- **AI cost by desk**: per-desk AI cost, MoM Δ, share of AI spend, and **AI intensity**
  (AI cost ÷ the desk's whole bill); desk names link to the self-service pages.
- **Biggest endpoint moves**: endpoints ranked by |MoM Δ| (both months live, compared per
  workspace × endpoint × offering type × category so a re-mapped endpoint compares against
  itself), with "new" / "gone" markers — the list behind the MoM Δ tile.
- **Serving-endpoints table** from live `cost_fact`: endpoint × offering type × product × desk
  with attribution badge, DBUs, cost, MoM Δ ("new" = no spend last month; desk-split endpoints
  show "—" to avoid double-counting) and share of AI spend; rows without an endpoint dimension
  (vector search, training) group under "(no endpoint)"; CSV download. **Stewards get an
  inline Fix column** on unallocated rows offering exactly the action(s) that apply — "Map
  runner" (user-first, rule 0) when the slice carries a run-as identity, "Map endpoint"
  (bridge, rule 4b) when it has an endpoint dimension; bulk fixes live in the work queue's
  AI tab.
- A visible **freshness note**: `system.billing.usage` lags real usage by ~1–2 h (no official
  SLA) and the billing pipeline emits hourly aggregates before DBUs appear in the system
  tables — the current day's AI spend is always incomplete. Month/mode picker as everywhere;
  endpoint detail always reads live `cost_fact` (never snapshotted).

### 7.3c Azure costs — `/azure`

Dedicated monthly monitoring screen for **the whole Azure bill** — separate money from the
Databricks chargeback (the two never mix), fed by `azure_monthly_chargeback` /
`azure_cost_fact` (`src/dal/azure.ts`, cost-monitoring reads):

- KPI tiles: Azure cost (attributed or not), MoM Δ (always live vs live — Azure has no
  published mode), **attributed-to-desks share**, and the UNALLOCATED remainder (expected for
  shared platform cost, never billed).
- **Cost by meter category** (resources, MoM Δ, share) and **cost by desk** — both rolled up
  from the same monthly rows, so every card sums to the KPI tile.
- 12-month **stacked trend by desk** (UNALLOCATED grey) and the month's **attribution mix**
  as a 100%-share bar in waterfall order (TAG → RESOURCE_MAPPING → TAG_RULE → RESOURCE_GROUP
  → SUBSCRIPTION → NONE), coloured by `AZURE_METHOD_STYLE`.
- **Resources behind the month's bill**: top 500 by cost, one row per (resource, method,
  product, desk) — a resource that changed attribution mid-month shows one row per method,
  like the coverage audit — with text filter, pagination, CSV download and a pointer to
  `/admin/azure` for stewards.
- Month picker only (no Live/Published toggle); months come from the Azure data itself
  (`getAzureMonths`). Freshness note: exports land in `azure_cleaned.amortized_costs` daily,
  so the current month is always partial; Azure Databricks meters trail further because the
  Databricks billing pipeline emits hourly aggregates ~1–2 h behind usage (no official SLA)
  before Microsoft picks them up. Renders an Azure-specific limitations footer
  (`<ReportFooter scope="azure" />`).

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

### 7.6 Advanced analytics — `/analytics`

The "why is the bill what it is" page, all live reads (`src/dal/analytics.ts`, `src/dal/insights.ts`):

- **KPI tiles**: blended $/DBU rate, annualized run rate, 3-month growth, top-3 product
  concentration, products to 80% of cost, top desk share.
- **Key findings**: auto-generated narrative insights (`buildInsights`) — growth spikes,
  concentration, coverage gaps — the same engine style as the report-pack commentary.
- **Cost drivers**: product and desk tables with 12-month sparklines and MoM deltas.
- **Unit economics by usage category**: per-category $/DBU with rate deltas, plus a blended
  $/DBU trend chart.
- **Attribution mix**: trailing-12-month 100%-stacked method trend.
- **Tagging scorecard — all sources**: the `tagging_scorecard` view (Methodology §6.5) rendered
  per source — DATABRICKS, AI (the AI slice of the same fact, never added to it) and AZURE —
  cost per attribution method, TAG share vs NONE.
- **Biggest movers**: products ranked by |MoM Δ| with new/gone markers.

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
| `ai-endpoints` | viewer | AI spend per endpoint × offering type × product × desk (live `cost_fact`) |
| `azure-resources` | viewer | The month's Azure cost per resource × method × product × desk (live `azure_cost_fact`) |
| `desk-invoice` (`&desk=`) | viewer | One desk's published statement |
| `catalogue` | steward | Full product catalogue incl. history |
| `queue-jobs` / `queue-runners` / `queue-workspaces` / `queue-tags` / `queue-warehouses` / `queue-azure` / `queue-endpoints` | steward | The seven work queues |

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
- **Azure reconciliation** (informational): the raw Azure bill vs `azure_cost_fact` vs
  `azure_monthly_chargeback` — a gap means the Azure waterfall or a multi-desk split is minting
  or losing money. Never blocks publication, since Azure is not published.
- **Integrity checks** (§7.4 a–f): validity overlaps (per product **and desk** — concurrent rows
  for different desks are a split, not an overlap), desk splits whose shares don't sum to 100%,
  orphan bridge/rule products, duplicate bridge keys, duplicate/conflicting tag and runner rules,
  inconsistent warehouse flags, and overlapping or out-of-range DBU reservation-discount windows
  — listed as explicit violations or a green all-clear.
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

1. **Single write surface** — the app writes only the eight mapping tables and the publication
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

Fixture world: 7 months (2026-01…07) with growth trend, 3 domains, 7 catalogue products (one
with a desk-move history: `pricing-curves`, fx → rates at 2026-05-01), 3 desks, 6 users,
3 workspaces, populated queues (4 untagged jobs, 3 unknown runners, 1 unknown workspace,
2 rogue tags, 2 warehouse candidates), reconciliation rows with sub-dollar gaps, 5 published
months, and one janitor-eligible bridge row. Azure fixtures: 2 subscriptions, 10 resources with
30-day attributions exercising every waterfall method (incl. one janitor-eligible resource
bridge and 3 unmatched resources), 2 resource bridges, 1 tag rule, 1 RG rule, 1 subscription
rule — writes re-attribute the fixture rows so the coverage tab reacts like the real views.
One DBU reservation-discount window (27%, 2025-12-08 → 2026-06-12) exercises the discounts
screen; the mock's static monthly figures do **not** re-price when windows change.
AI fixtures: the `outage-extraction` product (ai_query batch extraction of outage alerts), six
endpoint-usage rows (batch + realtime, one `ENDPOINT_MAPPING`-attributed embedding endpoint,
one unmapped `ml-experiments-llm` endpoint feeding the admin panel, one endpoint-less vector
search row), and one endpoint bridge row. Mapping/unmapping an endpoint re-attributes the
endpoint-usage fixtures live (map → `ENDPOINT_MAPPING`, remove → back to `NONE`); the static
monthly matrix — and therefore the AI KPI tiles — does **not** recompute, same caveat as
discounts.

---

## 12. Configuration Reference

See [`chargeback-app/.env.example`](chargeback-app/.env.example). Summary:

| Variable | Purpose |
|---|---|
| `DATABRICKS_HOST` / `DATABRICKS_HTTP_PATH` | SQL Warehouse (unset host ⇒ mock mode) |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` | Entra SPN for the warehouse token via `DefaultAzureCredential` in a container (unset ⇒ `az login` / managed identity) |
| `DBX_SCHEMA` | Schema prefix (default `main_dev.cost_reporting`), regex-validated |
| `DAL_MOCK` | Force fixture mode |
| `APP_ROLE` | Role the app runs at (default `publisher`; `viewer` = read-only) |
| `APP_USER` / `APP_USER_EMAIL` | Fixed identity name/email; email is written as `mapped_by` |
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
| Pipeline bridge admin screen | `pipeline_product_mapping` (waterfall rule 4c, `PIPELINE_MAPPING`) exists in the data model, feeds `cost_fact`, and is covered by the health checks (orphans + duplicate keys), but has no CRUD screen yet — rows are managed via SQL. An `/admin/pipelines` screen would mirror `/admin/endpoints` |
| Azure in invoiced totals & report pack | Desk statements now show a live, informational Azure section and the health page reconciles the Azure bill against `azure_cost_fact`, but the dashboard/report pack and the invoiced total remain Databricks-only. Billing Azure for real still needs a publish snapshot for Azure |
| Azure bridge-table health checks | Orphan products in the Azure resource/RG/subscription bridge tables are prevented at write time but not yet re-checked on the health page (unified tag rules and all Databricks bridges already are) |
| Budgets & burn rate | Needs a new `desk_budget` reference table + admin screen; then MTD vs budget with month-end projection |
| Anomaly flags | Daily product cost vs trailing baseline (z-score) on the dashboard |
| What-if move preview | Show desk-total impact of a catalogue move before the cutover |
| Scheduled distribution | Email/Teams delivery of published invoices and the report pack |
| Statement-text drill | On-demand `statement_text` fetch from `system.query.history` (needs UC grant) |
| Async health runner | Move §7.1 reconciliation to a scheduled Databricks Workflow writing `app_health_runs`; page reads the latest run |
| Automated tests | Vitest for `services/` (versioning edge cases), Playwright golden paths, RBAC E2E |
| Audit trail screen | Browsable `mapped_by`/`mapped_at` + Delta history feed |
| Correction/restatement workflow | Superseding snapshots with later `published_at` — only if finance ever needs restatements |

---

*End of document.*
