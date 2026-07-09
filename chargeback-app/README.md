# Databricks Chargeback — Management App

Next.js app implementing the management interface specified in
[`../databricks_chargeback_methodology.md`](../databricks_chargeback_methodology.md) (§10) per the
implementation guide in [`../nextjs_chargeback_app_implementation.md`](../nextjs_chargeback_app_implementation.md):
**reference-data management** for the mapping and rule tables in `main_dev.cost_reporting`
(catalogue, users, workspaces, jobs, tags, warehouses, runners, AI endpoints, DLT pipelines,
DBU discounts, Azure rules), and **reporting** (dashboard, drill-down, desk invoices, attribution
coverage, analytics, AI + Azure cost views, health checks, monthly publication) on top of the
read-only views.

## Quick start (no Databricks needed)

```bash
npm install
npm run dev
```

With the `DATABRICKS_*` host unset, mock mode enables itself (no `DATABRICKS_HOST` ⇒ `DAL_MOCK`):
the app runs entirely on in-memory fixture data. There is no sign-in — the app runs as one fixed
identity at role `APP_ROLE` (default `publisher`); set `APP_ROLE=viewer` or `steward` to test
role gating. Mock mutations (mapping a job, publishing a month) mutate the fixture store so the
full workflow is demoable.

## Running against Databricks

Copy `.env.example` over `.env.local` and fill in:

- `DATABRICKS_HOST` / `DATABRICKS_HTTP_PATH` — the SQL warehouse. Unset host = mock mode.
- `DATABRICKS_AUTH=azure` (the default) — acquire an Entra ID token via `DefaultAzureCredential`:
  your own `az login` identity for dev (just run `az login`, no secrets), an
  `AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET` SPN in a container, or
  workload/managed identity on an Azure host (no secret shipped at all). The resolved identity
  needs *CAN USE* on the warehouse plus the UC grants below.
- `DATABRICKS_AUTH=databricks-oauth` — Databricks-native OAuth with `DATABRICKS_CLIENT_ID` /
  `DATABRICKS_CLIENT_SECRET` (a Databricks-*generated* OAuth secret, not an Entra credential).
  The default whenever `DATABRICKS_CLIENT_SECRET` is set.
- `APP_ROLE` / `APP_USER` / `APP_USER_EMAIL` — the fixed identity the app runs as (no sign-in).
  `APP_ROLE` (default `publisher`) caps what the app can do; `APP_USER_EMAIL` is written as
  `mapped_by`. Gate who can reach the app at the network/platform layer.

Prerequisites on the Databricks side (see the implementation guide §8.0, §12, §15):

1. All views/tables from the methodology deployed; the §7.1 reconciliation holds.
   `npm run setup:dbx` creates all of them from [`../databricks/setup.sql`](../databricks/setup.sql)
   using the same warehouse env vars as the app (`DATABRICKS_*` / `AZURE_*` / `DBX_SCHEMA`; idempotent —
   tables `IF NOT EXISTS`, views `OR REPLACE`; `-- --dry-run` prints the plan).
2. Audit columns (`mapped_by`, `mapped_at`) added to all mapping tables.
3. UC grants: `SELECT` on the schema + `MODIFY` on the mapping tables and
   `monthly_chargeback_published` for the app SP; `SELECT` on `system.billing.usage` (work queue)
   and `system.query.history` (statement drill — not yet wired).
4. The §9 materialization job — without it, live `cost_fact` reads are expensive.

## Architecture (what's where)

| Layer | Path | Notes |
| --- | --- | --- |
| Request gate | `src/proxy.ts` | Next 16 proxy (ex-middleware): optimistic session-cookie check |
| Identity/RBAC | `src/lib/auth.ts`, `rbac.ts`, `guards.ts` | No sign-in — one fixed identity (`APP_*`); hierarchical roles; `requireRole` for actions, `requirePageRole` for pages |
| DAL | `src/dal/*` | The only SQL in the app. Every read: `'use cache'` + `cacheTag`; every module branches to `mock.ts` fixtures when `DAL_MOCK` |
| Business rules | `src/services/*` | Catalogue versioning (atomic MERGE move, no in-place desk edits, no deletes), §7.4 post-conditions |
| Mutations | `src/actions/*` | Server actions: role → zod parse → service → `updateTag` invalidation; structured `ActionResult`, no raw errors to the client |
| Pages | `src/app/(app)/*` | Dashboard `/`, `/report` (monthly pack), `/drill`, `/analytics`, `/ai`, `/azure`, `/desks(/[desk])`, `/invoices(/[desk])`, `/queue`, `/admin/*`, `/health` |
| Reporting extras | `src/dal/movement.ts`, `src/app/api/export/[report]` | §7.5 MoM movement + driver commentary; CSV exports for reports (viewer+) and queues/catalogue (steward+) |

Cache tags: `reports-live`, `reports-published`, `azure`, `catalogue`, `mappings`, `queue`,
`health` — mutations expire exactly what they affect via `updateTag` (read-your-writes).

Key invariants enforced in code:

- Desk/domain changes never update rows in place — the move is one atomic `MERGE`
  (close old validity window + insert successor), so published history never restates.
- Bridge rows may only reference catalogue products; §7.4 checks run as write post-conditions.
- Invoices read `monthly_chargeback_published` only; they never fall back to live data.
- Publication is publisher-only, gated on reconciliation + integrity server-side at submit time,
  with typed month confirmation.

## Commands

```bash
npm run dev                # dev server (Turbopack)
npm run build              # production build (all routes partially prerendered)
npm run start              # serve the production build
npm run lint               # eslint
npx tsc --noEmit           # type check
npm run setup:dbx          # create all methodology objects from ../databricks/setup.sql
npm run migrate:tag-scope  # one-off: add scope column, fold in azure_tag_product_mapping
```

## Reporting features

- **Monthly report pack** (`/report`): executive summary, §7.5 month-over-month movement by desk
  with auto-generated driver commentary ("rates +$3,576 (+8.0%) — driven by pricing-curves"),
  domain → product → desk breakdown with shares, attribution coverage, limitations footer.
  Print-optimized; CSV downloads inline.
- **CSV exports** (`/api/export/[report]?month=&mode=[&desk=]`): `monthly-chargeback`, `coverage`,
  `movement`, `movement-products`, `scorecard`, `ai-endpoints`, `azure-resources`, `desk-invoice`
  (viewer+); `catalogue`, `queue-*` (steward+).
- **Publication diff** on `/health`: the candidate month's live desk totals (what the snapshot
  will freeze) side-by-side with the last published month, so the publisher signs off on numbers.
- **XLSX report pack** (`/api/export/xlsx?month=&mode=`): the whole monthly report as one
  workbook — Summary (KPIs + commentary + limitations), Movement, Breakdown, Coverage,
  Scorecard, Invoices (published months).
- **Desk self-service** (`/desks`, `/desks/[desk]`): per-desk 12-month trend, product breakdown
  with drill links, published-invoice history, and the desk's TAG coverage. Highlights "your
  desk" when the signed-in user is in `user_mapping`.
- **Tagging scorecard by desk** (report §5 + `scorecard` CSV): TAG% leaderboard from live
  cost_fact — the adoption lever of Methodology §8.
- **Job-bridge janitor** (`/admin/jobs`): bridge rows whose jobs now emit TAG-attributed cost,
  with one-click removal (Methodology §8.3 / Phase 4 pruning, made continuous). An Azure
  equivalent lives on `/admin/azure`.
- **Advanced analytics** (`/analytics`): unit economics (blended $/DBU, run rate, concentration),
  auto-generated key findings, product/desk cost drivers with sparklines, attribution mix trend,
  cross-source tagging scorecard (DATABRICKS / AI / AZURE), biggest movers.
- **AI costs** (`/ai` + `/admin/endpoints`): model-serving/vector-search spend by endpoint and
  product, with the endpoint→product bridge (waterfall rule 4b).
- **Azure costs** (`/azure` + `/admin/azure`): Azure attribution on the same product catalogue
  via resource/tag/RG/subscription rules; unmatched cost stays visible, never billed.
- **DBU discounts** (`/admin/discounts`): reservation-plan windows applied at pricing time
  (`dbu_discount_plan`), with overlap checks on the health page.

## Not yet implemented (backlog, per the guide)

- Scheduled report distribution (email/Teams)
- Budgets & burn-rate (needs a `desk_budget` table), anomaly flags, what-if move preview
- On-demand `statement_text` fetch from `system.query.history` in the drill detail
- Async health-runner via `app_health_runs` table (recon currently runs in-request, cached under
  the `health` tag — fine in mock, slow on a cold warehouse)
- Vitest unit tests for `src/services`, Playwright golden paths
