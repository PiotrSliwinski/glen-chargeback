# Chargeback Management App — Next.js Implementation Guide

**Companion to:** [databricks_chargeback_methodology.md](databricks_chargeback_methodology.md) (referenced below as *Methodology*)
**Version:** 1.1 — July 2026 (updated to as-built)
**Purpose:** end-to-end implementation guide for a React / Next.js web application that (a) manages the reference data of the chargeback model — the mapping and rule tables in `main_dev.cost_reporting` (product catalogue, users, workspaces, job/tag/warehouse/runner/endpoint/pipeline rules, DBU discounts, Azure rules) — and (b) serves the reporting layer (dashboard, drill-down, analytics, AI and Azure cost views, invoices, coverage, health checks, monthly publication) effectively.

> **Status note.** This guide was written before the build and has been updated to match the app as built. The authoritative description of current behavior is [FUNCTIONALITY.md](FUNCTIONALITY.md) plus [`chargeback-app/README.md`](chargeback-app/README.md); `databricks/setup.sql` is canonical for the data model. Where the build deliberately diverged from the original plan (caching model, client stack, async health runner), this doc now records what was built and why.

The app implements Methodology §10 exactly: **it writes only to the mapping tables; everything else is a read of the views**. That single constraint shapes the whole architecture.

---

## Table of Contents

1. [Scope & Design Principles](#1-scope--design-principles)
2. [Architecture Overview](#2-architecture-overview)
3. [Technology Stack](#3-technology-stack)
4. [Deployment Options](#4-deployment-options)
5. [Authentication & Authorization (RBAC)](#5-authentication--authorization-rbac)
6. [Data Access Layer](#6-data-access-layer)
7. [Project Structure](#7-project-structure)
8. [Reference Data Management (Write Path)](#8-reference-data-management-write-path)
9. [Work Queue](#9-work-queue)
10. [Reporting (Read Path)](#10-reporting-read-path)
11. [Health, Reconciliation & Publication](#11-health-reconciliation--publication)
12. [Performance & Caching Strategy](#12-performance--caching-strategy)
13. [Validation, Error Handling & Auditing](#13-validation-error-handling--auditing)
14. [Testing Strategy](#14-testing-strategy)
15. [Environment & Configuration](#15-environment--configuration)
16. [Delivery Plan](#16-delivery-plan)

---

## 1. Scope & Design Principles

### What the app does

| Capability | Backed by | Access |
|---|---|---|
| Chargeback dashboard (KPIs, domain rollups, trends) | `monthly_chargeback`, `attribution_coverage` | Viewer+ |
| Drill-down: Domain → Product → Desk → line detail | `monthly_chargeback`, `cost_fact`, `desk_monthly_invoice` | Viewer+ |
| Monthly report pack, advanced analytics, desk self-service, AI costs, Azure costs | `monthly_chargeback`, `cost_fact`, `tagging_scorecard`, `azure_monthly_chargeback`, `azure_cost_fact` | Viewer+ |
| Work queue (7 tabs, grouped Databricks / Azure / AI): untagged jobs, unknown runners/workspaces, rogue tags, unassigned warehouses, unmatched Azure resources, unmapped AI endpoints | Methodology §7.2 / §7.3 queries + Azure/AI equivalents | Steward+ |
| Reference-data CRUD: `data_product_mapping`, `job_product_mapping`, `tag_product_mapping` (unified, scoped), `warehouse_product_mapping`, `runner_product_mapping`, `endpoint_product_mapping`, `user_mapping`, `workspace_mapping`, `dbu_discount_plan`, and the three Azure rule tables | mapping tables | Steward+ |
| Health checks (reconciliation + integrity, incl. Azure reconciliation) | Methodology §7.1 / §7.4 | Steward+ |
| Monthly publication snapshot | `monthly_chargeback_published` | Publisher only |

### Non-negotiable principles (inherited from the Methodology)

1. **One write surface.** The app never writes anywhere except the mapping tables and (Publisher only) `monthly_chargeback_published`. No app-side database of record — Databricks *is* the database.
2. **Validity versioning is enforced in the write path**, not trusted to users: moving a product to another desk closes the old row and inserts a new one; `desk` is never updated in place (Methodology §4.3, §10.5).
3. **Writes are audited** (`mapped_by`, `mapped_at` on `data_product_mapping` and the bridge/rule tables; `user_mapping` / `workspace_mapping` / `warehouse_product_mapping` rely on Delta history) and followed by the §7.4 integrity checks as a post-condition; violations roll the change back.
4. **Reports read the semantic views directly**; read performance comes from the in-process Next.js `"use cache"` layer (a Power-BI-style import model with an explicit "Refresh data" warm pass — see §12), not from materialized fact tables. Invoices read the **published snapshot**, never live views.
5. **UNALLOCATED is a feature, not a bug** — the UI must make unallocated cost loud and actionable (work queue), never hide it.

---

## 2. Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│  Browser (React)                                                       │
│    Next.js App Router pages (Server Components + Suspense) ·           │
│    server-rendered charts (SVG/divs) · progressive-enhancement forms   │
│    (useActionState) — no client data/query/chart libraries             │
└───────────────▲────────────────────────────────────────────────────────┘
                │ HTTPS (session cookie, Entra ID)
┌───────────────┴────────────────────────────────────────────────────────┐
│  Next.js server (Node runtime)                                         │
│    Route handlers /api/* + Server Actions                              │
│    ├─ auth: NextAuth (Entra ID) → role resolution (Viewer/Steward/     │
│    │        Publisher) via Entra group claims; dev bypass + mock mode  │
│    ├─ dal/: typed, parameterized SQL over Databricks SQL Warehouse     │
│    ├─ services/: write-path business rules (versioning, integrity)    │
│    └─ cache: "use cache" + cacheTag per DAL read (import model),       │
│       updateTag invalidation on writes, "Refresh data" warm pass       │
└───────────────▲────────────────────────────────────────────────────────┘
                │ Databricks SQL (@databricks/sql over a SQL Warehouse,
                │ service principal M2M OAuth or azure-cli user auth;
                │ human identity carried in audit columns)
┌───────────────┴────────────────────────────────────────────────────────┐
│  Databricks — main_dev.cost_reporting                                  │
│    READ : monthly_chargeback, cost_fact, attribution_coverage,         │
│           desk_monthly_invoice, tagging_scorecard, azure_usage_view,   │
│           azure_cost_fact, azure_monthly_chargeback,                   │
│           monthly_chargeback_published, health-check queries (§7)      │
│    WRITE: user_mapping, workspace_mapping, data_product_mapping,       │
│           job_product_mapping, tag_product_mapping,                    │
│           warehouse_product_mapping, runner_product_mapping,           │
│           endpoint_product_mapping, pipeline_product_mapping,          │
│           dbu_discount_plan, azure_{resource,rg,subscription}_product_ │
│           mapping, monthly_chargeback_published (Publisher)            │
└────────────────────────────────────────────────────────────────────────┘
```

Key decisions and why:

- **All SQL runs server-side.** The browser never sees a Databricks token or SQL text. Route handlers / server actions are the only door.
- **One service principal, app-enforced RBAC.** The app connects as a single service principal with `SELECT` on the schema and `MODIFY` on the mapping tables. Roles are enforced in the app layer from Entra ID group membership, and every write stamps the *human* user into `mapped_by`. (Alternative — on-behalf-of user tokens with Unity Catalog enforcing grants — is discussed in §5.3; it's stronger but significantly more work. Start with the SP model; UC grants remain the backstop for anyone bypassing the app.)
- **Reads and writes are asymmetric.** Reads are cache-friendly, aggregated, and served from the `"use cache"` import model (§12). Writes are rare, synchronous, validated, and expire exactly the cache tags they affect.

---

## 3. Technology Stack

As built (the original plan called for TanStack Query/Table, Recharts and react-hook-form; the app shipped server-first instead and needs none of them):

| Concern | Choice | Rationale |
|---|---|---|
| Framework | **Next.js 16 (App Router, TypeScript, Cache Components)** | Server Components keep SQL server-side by construction; Server Actions give a clean write path; `"use cache"` powers the read model; one deployable unit. NOTE: Next 16 APIs differ from stock Next 15 — see `chargeback-app/AGENTS.md` |
| Databricks connectivity | **`@databricks/sql`** (Databricks SQL Driver for Node.js) | Official driver; M2M OAuth or azure-cli auth, parameterized statements, cloud-fetch for large results |
| Auth | **NextAuth v5 (Auth.js) + Microsoft Entra ID provider** | Azure shop (Azure Databricks) → Entra ID SSO is the natural IdP; group claims drive roles. Dev bypass (`AUTH_DEV_BYPASS`) for local work |
| Server state / fetching | **RSC + Suspense** — no client fetching library | Pages fetch in Server Components; mutations re-render via cache-tag invalidation (read-your-writes) |
| Tables / grids | Server-paged custom components (`table-pagination.tsx`, `lib/paginate.ts`) | Pagination happens in SQL; no client grid library needed |
| Charts | Hand-rolled server-rendered SVG/divs (`components/charts.tsx`) | Bar/line/stacked needs covered without a client charting dependency; prints cleanly |
| Forms & validation | Progressive-enhancement server-action forms (`useActionState`) + **zod** server-side | The server parse is the single source of validation truth |
| Styling / components | **Tailwind CSS** (custom primitives, no shadcn/ui) | Fast, accessible admin-UI primitives |
| Runtime validation of query results | **zod** on DAL boundaries (`dal/parse.ts`) | Databricks returns loosely-typed rows; parse once at the edge of the DAL |
| Lint/format/test | ESLint (Prettier/Vitest/Playwright still backlog — §14) | — |

Node runtime only (no edge) for any route touching `@databricks/sql` — the driver needs Node APIs.

---

## 4. Deployment Options

### Option A — Databricks Apps (recommended if available on the workspace)

Databricks Apps can host a Node.js/Next.js app inside the workspace:

- **Pros:** identity story is solved (app runs with a managed service principal; user identity forwarded in `X-Forwarded-*` headers with on-behalf-of scopes available), networking stays inside the workspace, no separate infra, UC governance applies natively.
- **Cons:** resource limits (memory/CPU per app), cold starts, less control over build pipeline; Next.js must be run in standalone output mode (`output: 'standalone'`).
- Auth in this mode: skip NextAuth; read the forwarded user from `X-Forwarded-Preferred-Username` / access-token headers, resolve role from a small role table or Entra groups via Graph.

### Option B — Azure App Service / Container Apps (recommended for full control)

- Next.js standalone build in a container; Entra ID auth via NextAuth (or App Service Easy Auth in front).
- Databricks access via **service principal M2M OAuth** (client ID + secret in Azure Key Vault, surfaced as app settings).
- Private networking: VNet-integrate the app and use Private Link to the Databricks workspace if policy requires.

### Option C — Vercel

Fine for a prototype; for production an internal finance tool usually must stay inside the corporate network — check policy first. Long-running health-check queries can exceed serverless function limits (see §11 — run them async).

**Recommendation:** prototype on Option B (or local), decide A vs B based on whether Databricks Apps is enabled and whether its resource limits fit. The codebase below is identical except for the auth adapter.

---

## 5. Authentication & Authorization (RBAC)

### 5.1 Roles (Methodology §10.1)

| Role | Entra ID group (example) | Grants in the app |
|---|---|---|
| `viewer` | `grp-chargeback-viewers` | All read pages |
| `steward` | `grp-chargeback-stewards` | viewer + mapping CRUD + run health checks |
| `publisher` | `grp-chargeback-publishers` | steward + publication action |

Roles are **hierarchical** — model as `viewer < steward < publisher` and check `hasRole(session, 'steward')`.

### 5.2 Implementation

```ts
// src/lib/auth.ts
import NextAuth from "next-auth";
import Entra from "next-auth/providers/microsoft-entra-id";

const ROLE_BY_GROUP: Record<string, Role> = {
  [process.env.ENTRA_GROUP_VIEWER!]: "viewer",
  [process.env.ENTRA_GROUP_STEWARD!]: "steward",
  [process.env.ENTRA_GROUP_PUBLISHER!]: "publisher",
};

export const { handlers, auth } = NextAuth({
  providers: [
    Entra({
      clientId: process.env.ENTRA_CLIENT_ID!,
      clientSecret: process.env.ENTRA_CLIENT_SECRET!,
      issuer: `https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}/v2.0`,
    }),
  ],
  callbacks: {
    jwt({ token, profile }) {
      // 'groups' claim must be enabled on the app registration
      // (Token configuration -> add groups claim). If the user is in
      // too many groups the claim overflows -> fall back to Graph API.
      const groups: string[] = (profile as any)?.groups ?? token.groups ?? [];
      token.role = resolveRole(groups, ROLE_BY_GROUP); // highest wins
      token.groups = groups;
      return token;
    },
    session({ session, token }) {
      session.user.role = token.role as Role;
      return session;
    },
  },
});
```

Enforcement happens in **three layers** (defense in depth):

1. **Proxy** (`src/proxy.ts`, Next 16's middleware successor): optimistic session-cookie check — sessionless requests redirect to `/login`. Role/path blocking is deliberately NOT done here; it happens per page via `requirePageRole` (`lib/guards.ts`), which redirects below-role users.
2. **Server actions / route handlers**: every mutating entry point re-checks the role (`requireRole('steward')` / `atLeast`) — the proxy alone is not sufficient for actions.
3. **UI**: hide/disable controls the user can't use (courtesy, not security).

### 5.3 App identity vs user identity (decide early)

| Model | How | Trade-off |
|---|---|---|
| **Service principal (recommended start)** | App holds one SP with M2M OAuth; UC grants `SELECT` on schema + `MODIFY` on mapping tables to the SP only. Human identity recorded in `mapped_by`. | Simple, one warehouse session pool. App RBAC is the enforcement point; UC can't distinguish app users. |
| On-behalf-of (OBO) user | Exchange the user's Entra token for a Databricks token per request; UC enforces per-user grants. | UC-grade enforcement, per-user audit in Databricks logs. Costs: token exchange plumbing, no shared connection pool, users need direct UC grants (which also lets them bypass app validation with raw SQL — arguably worse for the versioning rules!). |

The write-path integrity rules (never update desk in place, post-condition checks) **only exist inside the app**, so funneling all writes through the app's SP is actually the safer design. Give humans `SELECT` on the schema for ad-hoc analysis, but `MODIFY` only to the app SP + a break-glass admin group.

---

## 6. Data Access Layer

One module owns every SQL statement. No SQL anywhere else in the codebase.

### 6.1 Connection management

The shape (see `chargeback-app/src/dal/client.ts` for the full as-built version):

```ts
// src/dal/client.ts (simplified — the real client adds an azure-cli auth
// branch, an idle session pool, a separate exec() for DML, and warmup())
let clientPromise: Promise<DBSQLClient> | null = null;

export function getClient(): Promise<DBSQLClient> {
  clientPromise ??= new DBSQLClient().connect({
    host: env.DATABRICKS_HOST,                   // adb-xxxx.azuredatabricks.net
    path: env.DATABRICKS_HTTP_PATH,              // /sql/1.0/warehouses/<id>
    authType: "databricks-oauth",                // or azure-cli for dev
    oauthClientId: env.DATABRICKS_CLIENT_ID,     // service principal
    oauthClientSecret: env.DATABRICKS_CLIENT_SECRET,
  });
  return clientPromise;
}

export async function query<T>(
  sql: string,
  namedParameters: Record<string, unknown> = {},
  schema?: z.ZodType<T>,
): Promise<T[]> { /* session from pool → executeStatement → zod-parse rows */ }
```

Rules:

- **Always parameterized** (`:name` named parameters) — never string-interpolate user input into SQL. The only interpolated value is the schema prefix, regex-validated at boot and applied through the `T()` helper.
- **Serverless SQL Warehouse, size 2X-Small–Small, auto-stop 10 min.** The app's queries are aggregates — tiny under the cached read model. The health checks (§11) are the only heavy ones.
- As built: an **idle session pool** amortizes session setup; `exec()` handles DML separately from `query()`; `warmup()` (plus `/api/warm` fired from `instrumentation.ts` at boot) pre-opens the connection and pre-fills the cache so first paint doesn't pay the warehouse cold start.
- The fully-qualified schema prefix comes from one env var (`DBX_SCHEMA`, exposed in code as `env.SCHEMA`) so dev/prod schemas can differ.
- When `DATABRICKS_HOST` is unset (or `DAL_MOCK=true`), every DAL module serves in-memory fixtures from `dal/mock.ts` instead — the whole app runs with zero external services.

### 6.2 Typed row schemas

Every query result is parsed with zod at the DAL boundary. Example:

```ts
// src/dal/types.ts (+ shared field parsers in src/dal/parse.ts)
export const MonthlyChargebackRow = z.object({
  billing_month: z.coerce.date(),
  data_domain: z.string(),
  data_product: z.string(),
  desk: z.string(),
  usage_category: z.string(),
  distinct_runners: z.coerce.number(),
  total_dbus: z.coerce.number(),
  total_cost: z.coerce.number(),
});
export type MonthlyChargebackRow = z.infer<typeof MonthlyChargebackRow>;
```

### 6.3 Repository modules

```
src/dal/
  client.ts                 // connection + session pool + query()/exec()/warmup()
  parse.ts / types.ts       // shared zod field parsers + row schemas
  reports.ts                // monthly_chargeback, cost_fact drill, coverage, invoice
  movement.ts               // §7.5 MoM movement + driver commentary
  analytics.ts / insights.ts// advanced analytics + auto-generated key findings
  ai.ts                     // AI categories, endpoint spend, endpoint movers
  azure.ts                  // Azure cost monitoring + rule CRUD + coverage
  desks.ts                  // desk self-service reads
  workQueue.ts              // §7.2/§7.3 queries + Azure/AI queues + janitors
  health.ts                 // §7.1 reconciliation (+ Azure recon) + §7.4 integrity
  mappings.ts               // ALL mapping/bridge/rule CRUD in one module
  discounts.ts              // dbu_discount_plan CRUD
  publish.ts                // monthly snapshot insert + published reads
  stamp.ts / warm.ts        // data-freshness stamp + boot warm pass
  mock.ts                   // in-memory fixture branch (DAL_MOCK)
```

---

## 7. Project Structure

```
src/
  proxy.ts                          // Next 16 request gate (session-cookie check)
  instrumentation.ts                // boot warm pass trigger
  app/
    login/page.tsx                  // sign-in (no route group)
    (app)/
      layout.tsx                    // shell: nav (role-filtered), month/mode from URL
      page.tsx                      // 10.2 Dashboard (landing)
      report/page.tsx               // monthly report pack (print-optimized)
      drill/page.tsx                // 10.3 Domain -> Product -> Desk -> Detail
      analytics/page.tsx            // advanced analytics + tagging scorecard
      ai/page.tsx                   // AI costs (model serving, batch, vector search)
      azure/page.tsx                // Azure cost monitoring
      desks/page.tsx + [desk]/      // desk self-service
      invoices/page.tsx + [desk]/   // published desk statements
      queue/page.tsx                // 10.4 Work queue (7 tabs: Databricks/Azure/AI)
      admin/
        page.tsx                    // reference-data index
        products/  jobs/  warehouses/  users/  workspaces/
        endpoints/  discounts/  azure/
      health/page.tsx               // 10.6 Health & reconciliation + publish button
      error.tsx
    api/
      auth/[...nextauth]/route.ts
      export/[report]/route.ts      // CSV exports
      export/xlsx/route.ts          // XLSX report workbook
      warm/route.ts                 // token-guarded boot warm pass
  actions/                          // server actions (all mutations)
    products.ts  mappings.ts (jobs/tags/warehouses/runners/endpoints/users/
    workspaces)  azure.ts  discounts.ts  insights.ts  publish.ts  refresh.ts
  dal/                              // see §6.3
  services/                         // write-path business rules (§8)
    productCatalogue.ts  entra.ts  errors.ts
    // (§7.4 post-condition checks live in dal/health.ts)
  lib/
    auth.ts  rbac.ts  guards.ts  cache-tags.ts  env.ts  csv.ts  paginate.ts
    identity.ts  kpi-help.ts  report-params.ts  tag-rules.ts  utils.ts  ...
  components/
    charts.tsx  ui.tsx  action-form.tsx  table-pagination.tsx
    month-picker, KPI tiles, tag chips, janitor card, refresh button, ...
```

Conventions:

- **Pages are React Server Components** that call the DAL directly, wrapped in `Suspense`; the only client components are forms (`useActionState`), the month picker, nav highlighting, and the print button.
- **All mutations are Server Actions** in `src/actions/*` — thin wrappers: `runAction(role, …)` → zod-parse `FormData` → call service/DAL → `updateTag` cache invalidation → structured `ActionResult`.
- A global **month/mode URL state** (`?month=2026-06&mode=published`, so views are linkable) plus a **live/published toggle** as specified in §10.2.

---

## 8. Reference Data Management (Write Path)

This is the heart of "manage reference data". Each table gets a dedicated admin screen; the hard logic lives in `services/`, not in components.

### 8.0 A prerequisite: extend audit columns

The Methodology defines `mapped_by`/`mapped_at` on the bridge/rule tables; the DAL also stamps them on `data_product_mapping`. As built, `user_mapping`, `workspace_mapping` and `warehouse_product_mapping` have **no** in-row audit columns — their writes rely on Delta table history. To add in-row audit there too (and to align `data_product_mapping`'s DDL in `setup.sql` with what the DAL writes), run:

```sql
ALTER TABLE main_dev.cost_reporting.user_mapping        ADD COLUMNS (mapped_by STRING, mapped_at TIMESTAMP);
ALTER TABLE main_dev.cost_reporting.workspace_mapping   ADD COLUMNS (mapped_by STRING, mapped_at TIMESTAMP);
ALTER TABLE main_dev.cost_reporting.data_product_mapping ADD COLUMNS (mapped_by STRING, mapped_at TIMESTAMP);
ALTER TABLE main_dev.cost_reporting.warehouse_product_mapping ADD COLUMNS (mapped_by STRING, mapped_at TIMESTAMP);
```

Delta table history (`DESCRIBE HISTORY`) remains the immutable audit trail; the columns give in-row convenience.

### 8.1 The Databricks transaction constraint — design around it

Databricks SQL has **single-statement atomicity only** — there is no `BEGIN/COMMIT` across statements. The "close old row + insert new row" move operation must therefore be **one atomic `MERGE`**, not two statements:

```sql
-- services/productCatalogue.ts :: moveProduct()
-- One atomic statement: closes the active row AND inserts the successor.
MERGE INTO main_dev.cost_reporting.data_product_mapping t
USING (
  SELECT :data_product AS data_product, 'close'  AS action UNION ALL
  SELECT :data_product,                  'insert'
) s
ON  t.data_product = s.data_product
AND s.action = 'close'
AND t.valid_to IS NULL
WHEN MATCHED THEN
  UPDATE SET valid_to = :cutover_date,
             mapped_by = :actor, mapped_at = current_timestamp()
WHEN NOT MATCHED AND s.action = 'insert' THEN
  INSERT (data_product, data_domain, desk, product_owner, cost_split_pct,
          valid_from, valid_to, mapped_by, mapped_at)
  VALUES (:data_product, :new_domain, :new_desk, :new_owner, 1.0,
          :cutover_date, NULL, :actor, current_timestamp());
```

(Note the exclusive-join semantics from Methodology §10.5: old row's `valid_to = cutover_date`, new row's `valid_from = cutover_date` — `cost_fact` joins `usage_date < valid_to`, so there is no gap and no overlap. As built, the MERGE in `dal/mappings.ts` generalizes this to **one row per desk**, supporting multi-desk `cost_split_pct` splits: it closes all active rows and inserts the full successor desk set in one atomic statement.)

For write paths that can't be a single MERGE, use **optimistic check → write → post-condition → compensate**:

1. Read current state; validate the intended change (zod + business rules).
2. Execute the write.
3. Run the relevant §7.4 integrity checks scoped to the touched key.
4. If a post-condition fails, **compensate** (e.g. `RESTORE TABLE ... VERSION AS OF` is too blunt — instead issue the inverse statement) and return a structured error.

Concurrent-steward races are possible but rare (small team); the scoped post-condition check turns a race into a visible, fixable error instead of silent corruption. If it ever matters, add a `_lock` row-versioning column and compare-and-swap on it.

### 8.2 Product Catalogue (`data_product_mapping`) — the flagship screen

**List view:** one row per product showing its *active* version (desk, domain, owner, valid_from), with an expandable history timeline of prior versions. Filter by domain/desk; badge products referenced by bridge tables.

**Operations (all Server Actions, all steward+):**

| Operation | Rules enforced in `services/productCatalogue.ts` |
|---|---|
| **Create product** | key format `^[a-z0-9]+([_-][a-z0-9]+)*$` (lowercase, hyphen/underscore, no spaces — §4.3); no active row with same key; desk & domain non-empty; `valid_from` defaults to first of next month (editable); post-check §7.4(a) |
| **Move product** (desk and/or domain change) | cutover date required (default: first of next month); atomic MERGE above; **UI copy explicitly says** "history before {cutover} keeps the old desk"; post-check §7.4(a) |
| **Edit version** (in-place, full field) | Corrects one validity window in place — domain, desk split, owner and the window's own dates — via one atomic MERGE keyed on (window, desk) that updates/inserts/deletes desk rows. For fixing mistakes, not recording a change over time (that is Move). Validates the split (sum 100%), date order, and per-desk overlap against other windows (§7.4(a)); post-check. Rewrites the window, so it restates not-yet-published usage inside it — the product key itself is never editable (a rename is retire + re-register). Available on the active version and every historical window |
| **Retire product** | set `valid_to`; the UI warns that later usage will fall to the work queue; **block** if bridge tables still reference the product; rows are closed, not removed |
| **Delete version** (guarded hard-delete) | Removes one validity window's rows outright (unlike Retire). **Blocked** when it would leave the product with no active window while bridge/rule mappings still reference it; deleting a historical window while an active one remains is allowed, with a UI restatement warning. Available on any window |

**Create/Move form UX detail that prevents most data quality issues:** the desk and domain fields are **comboboxes fed by existing distinct values** with explicit "create new domain…" affordance — free-text typos in `data_domain` silently split rollups.

### 8.3 Job bridge (`job_product_mapping`)

- Grid of current mappings (workspace, job id, job name via lookup, product, note, mapped_by/at), with cost-last-30d joined in from `cost_fact` so stewards see which mappings still matter.
- **Add** happens mostly from the Work Queue (§9) — inline "Map to product". Direct add on this screen validates: composite key `(workspace_id, job_id)` not already present (§7.4(c)); product exists in catalogue (§7.4(b)).
- **"Now tagged at source" janitor:** a query listing bridge rows whose job produced `TAG`-attributed rows in the last 30 days — candidates for deletion (Methodology Phase 4 quarterly pruning, made continuous):

```sql
SELECT jm.workspace_id, jm.job_id, jm.data_product, SUM(cf.cost) AS tagged_cost_30d
FROM main_dev.cost_reporting.job_product_mapping jm
JOIN main_dev.cost_reporting.cost_fact cf
  ON  cf.workspace_id = jm.workspace_id AND cf.job_id = jm.job_id
  AND cf.attribution_method = 'TAG'
  AND cf.usage_date >= current_date() - INTERVAL 30 DAYS
GROUP BY 1, 2, 3;
```

### 8.4 Warehouse mapping (`warehouse_product_mapping`)

- Toggle-centric UI: each warehouse row is either **Shared** (`is_shared = true`, product cleared) or **Dedicated** (`is_shared = false`, product required) — the form makes the invalid combinations of §7.4(d) unrepresentable.
- Upsert via single-statement `MERGE` keyed on `warehouse_id`.
- Show per-warehouse 30-day cost and idle share (`UNALLOCATED_IDLE` fraction from `query_view`) to inform the shared/dedicated decision.

### 8.5 `user_mapping` and `workspace_mapping`

Simple keyed CRUD (MERGE upserts), mostly fed from the work queue. One important validation on `user_mapping`: `user_id` must match the identity exactly as it appears in system tables — the add-user dialog therefore **pre-fills `user_id` from the work-queue row** (read-only) rather than letting stewards type it.

### 8.6 Shared mutation skeleton

```ts
// src/actions/products.ts (as built)
"use server";
export async function moveProductAction(_prev: ActionResult, formData: FormData) {
  return runAction("steward", async (actor) => {        // requireRole inside
    const cmd = MoveProductInput.parse(parseForm(formData)); // zod
    await productCatalogue.move(cmd, actor);            // MERGE + post-checks
    invalidateCatalogue();  // updateTag: catalogue, queue, reports-live, azure, health
  });
}
```

Every mutation follows this exact shape: **role → parse → service (write + post-condition) → `updateTag` cache invalidation** (read-your-writes; `revalidateTag` is not used).

---

## 9. Work Queue

The operational heart (Methodology §10.4) and the app's **single mapping hub across Databricks, Azure and AI**. One page, seven tabs in three groups, shared layout: a server-paged table sorted by unattributed cost descending, each row with an inline, pre-filled fix form; multi-select bulk actions on every tab. All Databricks queues share one 30-day runner scan.

| Group | Tab | Query | Inline action → mutation |
|---|---|---|---|
| Databricks | **Untagged jobs** | §7.2 first query, `usage_category <> 'SQL_WAREHOUSE'` | "Map to product" → insert `job_product_mapping` (+ banner: *durable fix is tagging the job*) |
| Databricks | **Unknown runners** | §7.2 second query | "Add user" → insert `user_mapping` (user_id pre-filled read-only); or "Map runner" → `runner_product_mapping` rule |
| Databricks | **Unknown workspaces** | §7.2 third query | "Add workspace" → insert `workspace_mapping` |
| Databricks | **Rogue tags** | §7.3 | "Map via tag rule" → `tag_product_mapping` rule (scope `databricks`); or "Register as product" → create in catalogue with `data_product` = tag value |
| Databricks | **Unassigned warehouses** | dedicated-warehouse candidates: warehouses with method `USER`/`NONE` and high idle share | "Assign warehouse" → MERGE `warehouse_product_mapping` |
| Azure | **Unmatched resources** | `azure_cost_fact` method `NONE`, 30 days | "Map to product" → `azure_resource_product_mapping` (single + bulk) |
| AI | **Unmapped endpoints** | AI slices with method `NONE` | "Map endpoint" → `endpoint_product_mapping` (rule 4b); "Map runner" where a run-as identity exists (rule 0) |

Product-quality touches that make this page actually drive cleanup:

- **KPI strip at the top:** unallocated $ last 30 days split per source (Databricks / Azure / AI), open-item counts per queue — the numbers stewards are trying to drive to zero. Dollars are counted once across queues.
- After a successful action, the cache tags expire and the row disappears on re-render (read-your-writes via `updateTag`).
- **Attribution note:** newly-added mappings affect *live* views immediately but change nothing about published months (§10.7.4) — the UI states this after each action so nobody expects an issued invoice to move.
- Each queue is exportable (CSV) for offline chasing (`queue-jobs` … `queue-azure`, `queue-endpoints`).

---

## 10. Reporting (Read Path)

### 10.1 Dashboard (landing, §10.2)

Layout (top to bottom):

1. **Controls:** month picker (default: last closed month) + Live/Published toggle. Published mode reads `monthly_chargeback_published WHERE snapshot_month = :month`; Live reads `monthly_chargeback`. A colored banner makes the mode unmistakable ("You are viewing LIVE, unpublished figures").
2. **KPI tiles:** total cost · MoM Δ (abs + %) (§7.5) · TAG coverage % (§6.3) · UNALLOCATED cost (click → work queue).
3. **Cost by domain** — horizontal bar, level-1 rollup; click a bar → drill page filtered to that domain.
4. **12-month trend** — stacked area by domain.
5. **Attribution coverage trend** — stacked 100% bar by `attribution_method` per month, the tagging-adoption KPI chart.
6. **Report footer with the known limitations** verbatim from Methodology §11 — the doc requires them in every report; render them once in a shared `<ReportFooter/>`.

All widgets read a single server-fetched payload (`getDashboard(month, mode)`) — one round trip, cached (§12).

### 10.2 Drill-down (§10.3)

URL-driven so every view is shareable: `/drill?month=2026-06&domain=risk&product=pricing-curves`.

- **Level 1 → 2:** products within the domain (query from §10.3 of the Methodology), table + treemap.
- **Level 2 → detail:** the `cost_fact` detail query (`usage_category, job_name, warehouse_id, runner_name, attribution_method, cost`), server-paged, LIMIT 200 per page as specced, virtualized table.
- **Desk lens (level 3):** `desk_monthly_invoice` for the selected desk.
- **Per-statement drill (backlog):** rows with a `statement_id` would get an expander fetching `statement_text` on demand from `system.query.history` — deliberately not in any view (§5.1). Not yet wired; the detail panel aggregates `cost_fact` only.
- Every detail row shows its `attribution_method` as a badge — all nine methods have a color (TAG green, JOB_MAPPING amber, TAG_RULE teal, WAREHOUSE_MAPPING sky, ENDPOINT_MAPPING fuchsia, PIPELINE_MAPPING blue, RUNNER_RULE purple, USER indigo, NONE red) — this is how stewards spot *why* a cost landed where it did — plus a serverless/classic compute chip.

### 10.3 Desk invoices

- `/invoices` — grid of desks × months from the **published snapshot only**, with `desk_month_total`.
- `/invoices/[desk]?month=` — printable statement: desk header, month, domain→product breakdown, total, the limitations footer, `published_at` timestamp. Add a print stylesheet + "Download PDF" (via headless print) and CSV export.
- If the selected month has no published snapshot, show "not yet published" and (for publishers) a link to the health page — never fall back silently to live data.

### 10.4 Exports

One route handler `GET /api/export/[report]?month=...` producing CSV for 16 reports — monthly chargeback, coverage, movement (+ products), scorecard, AI endpoints, Azure resources, desk invoice (viewer+); catalogue and the seven work queues (steward+). A separate `GET /api/export/xlsx` builds the six-sheet monthly report workbook via `exceljs`. Both use the same DAL functions; role-checked like the pages.

---

## 11. Health, Reconciliation & Publication

### 11.1 Health page (§10.6)

A checklist per month, each item green/red with the raw numbers on expand:

| Check | Source | Pass condition |
|---|---|---|
| Reconciliation (discount-aware billing truth) | §7.1 | `abs(fact_gap) < $1` and `abs(report_gap) < $1` (tolerance via `RECON_TOLERANCE_USD`) |
| Azure reconciliation (bill vs `azure_cost_fact` vs rollup) | §12.2 | informational — Azure is never published |
| Validity overlaps (per product AND desk) | §7.4(a) | 0 rows |
| Orphan bridge/rule products (job, tag, warehouse, runner, endpoint, pipeline) | §7.4(b) | 0 rows |
| Duplicate bridge keys (job, warehouse, endpoint, pipeline) | §7.4(c) | 0 rows |
| Conflicting rules (tag scope overlap, duplicate runners) | §7.4(c2) | 0 rows |
| Warehouse flag consistency | §7.4(d) | 0 rows |
| Desk split sums = 100% | §7.4(e) | 0 rows |
| Discount window overlaps / out-of-range rates | §7.4(f) | 0 rows |
| Coverage snapshot | §6.3 | informational (TAG% displayed, no gate) |

**The reconciliation query scans a year of `system.billing.usage` — it can run for minutes.** As built, the checks run synchronously but behind the `health` cache tag (`"use cache"` + `cacheLife("warehouse")`): "Re-run checks" just expires that tag, and the global "Refresh data" button deliberately does NOT touch it, so nothing blocks on the scan. A future iteration can move it fully async:

- "Run checks" starts the statements **asynchronously** (fire the queries, persist a run record with statement handles/status into a small app table `main_dev.cost_reporting.app_health_runs`), and the page polls a lightweight status endpoint.
- Optionally schedule the checks daily via a Databricks Workflow writing results into `app_health_runs`, so the page usually just *reads* the latest run and "Run now" is the exception. (Neither exists yet — see backlog.)

### 11.2 Publication (Publisher role)

The publish button for month *M* is **enabled only when** (a) all §7.4 checks pass, (b) `report_gap` for *M* is within tolerance, (c) *M* is closed (M < current month), and (d) *M* is not already in `monthly_chargeback_published`.

The action (single statement, atomic):

```sql
INSERT INTO main_dev.cost_reporting.monthly_chargeback_published
SELECT current_timestamp(), billing_month, *
FROM main_dev.cost_reporting.monthly_chargeback
WHERE billing_month = :month;
```

with a **typed confirmation dialog** ("type `2026-06` to publish") — publication is the one hard-to-reverse action in the system. Re-publication of an already-published month is refused by the app; a correction workflow (insert a superseding snapshot with a later `published_at`, invoices read the latest) can be added later if finance ever needs restatements — decide with them before building it.

After publish: expire the `reports-published` cache tag (`updateTag`) and show the diff vs live (should be zero at publish time). Before publish, the health page shows a **publication diff** — the candidate month's live desk totals side-by-side with the last published month — so the publisher signs off on numbers, not just green checks.

---

## 12. Performance & Caching Strategy

As built, the app uses a **Power-BI-style import model** instead of the originally planned materialized-table + TTL design:

1. **Every DAL read is `"use cache"` + `cacheTag(...)` with one shared `cacheLife("warehouse")` profile** (`next.config.ts`: stale 5 min, revalidate/expire 30 days). Data is effectively *imported* into the Next.js in-process cache and served from memory; the warehouse is only hit when a tag is expired.
2. **Explicit refresh, exact invalidation.** Mutations call `updateTag` on exactly the tags they affect (`reports-live`, `reports-published`, `azure`, `catalogue`, `mappings`, `queue`, `health`) — read-your-writes. A global **"Refresh data" button** expires every tag except `health` and immediately re-warms the common reads; the `health` tag is excluded so its year-long billing scan never blocks a routine refresh. A boot-time warm pass (`instrumentation.ts` → `/api/warm`) pre-fills the cache.
3. **Push aggregation into SQL, page in SQL.** No "fetch all rows, aggregate in JS". Detail drills use SQL pagination with stable ordering and capped page counts.

The `query_fact_tbl` / `usage_fact_tbl` materialization targets from Methodology §9 still exist and remain the right long-term answer for `system.query.history` retention (>90 days of per-query detail); the app does not read them yet.

**Deployment constraint (see `chargeback-app/AGENTS.md`):** the cache-coherence design assumes ONE long-lived Node process — `updateTag` is visible to everyone because everyone shares the process. Do not deploy serverless or multi-replica without switching to a shared cache handler.

Warehouse sizing note: with the import model, a 2X-Small serverless warehouse with 10-minute auto-stop serves a handful of concurrent finance users. The month-end health checks are the only reason to ever scale it up temporarily.

---

## 13. Validation, Error Handling & Auditing

- **zod schemas** per mutation (`MoveProductInput`, `MapJobInput`, …) parsed in the server action — the server parse is the only parse (forms are progressive-enhancement server-action forms, no client resolver).
- **Structured action results:** `{ ok: true } | { ok: false, code: 'OVERLAP' | 'ORPHAN_PRODUCT' | 'DUPLICATE_KEY' | 'BAD_KEY_FORMAT' | 'RECON_STALE' | ..., detail }` — the UI maps codes to human messages; never leak raw SQL errors to the browser (log them server-side with a correlation id shown in the toast).
- **Audit:** mutations on `data_product_mapping` and the bridge/rule tables stamp `mapped_by` (Entra UPN) + `mapped_at`; user/workspace/warehouse upserts have no in-row audit columns (§8.0) and rely on Delta `DESCRIBE HISTORY`, the tamper-proof backstop for everything.
- **Admin screens show audit info** inline (mapped_by/at columns) — provenance visible where the data is edited.

---

## 14. Testing Strategy

> **Status: aspirational.** None of this suite exists yet (no test runner, config, or test files in the repo); mock-mode end-to-end walks are the current verification method. The matrix below is the target.

| Layer | Approach |
|---|---|
| Business rules (`services/`) | **Vitest unit tests with a mocked DAL** — versioning rules, key-format validation, publish gating, role checks. This is where the value is; test exhaustively (overlap scenarios, cutover-date edge cases: same-day move, retro cutover, gap detection). |
| DAL SQL | **Integration tests against a dev schema** (`main_dev_test.cost_reporting`) seeded with fixture rows; run in CI on a nightly/manual trigger (needs warehouse). Verify the MERGE statements do what the unit tests assume — especially the atomic move. |
| Integrity checks | Seed deliberately-broken fixtures (overlapping validity, orphan bridge rows) and assert each §7.4 query catches them. |
| UI | Testing Library for forms/dialog flows; **Playwright E2E** for the three golden paths: (1) work-queue → map job → row disappears → mapping visible in admin; (2) product move with cutover → history timeline correct; (3) publisher flow: checks green → publish → invoice appears in published mode. Run against the dev schema. |
| RBAC | E2E with three test users (one per role) asserting page access and action availability. |

Plus one **non-app test that guards the whole system**: a scheduled CI job running the §7.1 reconciliation against dev after any change to view definitions.

---

## 15. Environment & Configuration

```bash
# .env.example
# --- Databricks
DATABRICKS_HOST=adb-1234567890123456.7.azuredatabricks.net
DATABRICKS_HTTP_PATH=/sql/1.0/warehouses/abcdef1234567890
DATABRICKS_CLIENT_ID=<service-principal-application-id>
DATABRICKS_CLIENT_SECRET=<sp-oauth-secret>            # Key Vault in prod
DBX_SCHEMA=main_dev.cost_reporting                    # dev/prod switch

# --- Auth (Entra ID)
ENTRA_TENANT_ID=...
ENTRA_CLIENT_ID=...
ENTRA_CLIENT_SECRET=...                               # Key Vault in prod
ENTRA_GROUP_VIEWER=<group-object-id>
ENTRA_GROUP_STEWARD=<group-object-id>
ENTRA_GROUP_PUBLISHER=<group-object-id>
AUTH_SECRET=...                                       # next-auth
AUTH_URL=https://chargeback.internal.example.com

# --- Databricks auth mode & dev conveniences
DATABRICKS_AUTH=service-principal      # or azure-cli: connect as your own user
                                       # (defaults to azure-cli when CLIENT_SECRET unset)
DAL_MOCK=false                         # true (or unset host) = in-memory fixtures
AUTH_DEV_BYPASS=false                  # true = skip SSO, act as a fixed dev user
AUTH_DEV_ROLE=publisher                # role of the dev-bypass user

# --- App behavior
RECON_TOLERANCE_USD=1
# (cache lifetimes live in next.config.ts cacheLife profiles, not env)
```

Validate at boot with a zod `env.ts` — fail fast on missing config. Secrets live in Azure Key Vault (Option B) or Databricks secrets (Option A); never in the repo.

Unity Catalog grants (run once per environment):

```sql
GRANT USE CATALOG ON CATALOG main_dev TO `sp-chargeback-app`;
GRANT USE SCHEMA, SELECT ON SCHEMA main_dev.cost_reporting TO `sp-chargeback-app`;
GRANT MODIFY ON TABLE main_dev.cost_reporting.user_mapping              TO `sp-chargeback-app`;
GRANT MODIFY ON TABLE main_dev.cost_reporting.workspace_mapping         TO `sp-chargeback-app`;
GRANT MODIFY ON TABLE main_dev.cost_reporting.data_product_mapping      TO `sp-chargeback-app`;
GRANT MODIFY ON TABLE main_dev.cost_reporting.job_product_mapping       TO `sp-chargeback-app`;
GRANT MODIFY ON TABLE main_dev.cost_reporting.tag_product_mapping       TO `sp-chargeback-app`;
GRANT MODIFY ON TABLE main_dev.cost_reporting.warehouse_product_mapping TO `sp-chargeback-app`;
GRANT MODIFY ON TABLE main_dev.cost_reporting.runner_product_mapping    TO `sp-chargeback-app`;
GRANT MODIFY ON TABLE main_dev.cost_reporting.endpoint_product_mapping  TO `sp-chargeback-app`;
GRANT MODIFY ON TABLE main_dev.cost_reporting.pipeline_product_mapping  TO `sp-chargeback-app`;
GRANT MODIFY ON TABLE main_dev.cost_reporting.dbu_discount_plan         TO `sp-chargeback-app`;
GRANT MODIFY ON TABLE main_dev.cost_reporting.azure_resource_product_mapping     TO `sp-chargeback-app`;
GRANT MODIFY ON TABLE main_dev.cost_reporting.azure_rg_product_mapping           TO `sp-chargeback-app`;
GRANT MODIFY ON TABLE main_dev.cost_reporting.azure_subscription_product_mapping TO `sp-chargeback-app`;
GRANT MODIFY ON TABLE main_dev.cost_reporting.monthly_chargeback_published TO `sp-chargeback-app`;
-- statement-text drill (backlog — grant when it ships):
GRANT SELECT ON TABLE system.query.history TO `sp-chargeback-app`;
```

---

## 16. Delivery Plan

> **Status: executed (historical).** The sprints below were delivered, with the §12/§14 deviations noted above (import-model caching instead of materialized-table reads; async health runner and the test suite still backlog). Later additions beyond this plan: report pack, analytics, desks, AI and Azure pages, endpoint/pipeline/runner/tag-scope rules, DBU discounts, XLSX export.

Aligned with the Methodology's rollout (§11) — the app lands in Phase 3, work-queue first, because the work queue is what drives everything else.

**Sprint 0 — Foundations (week 1)**
- Repo scaffold (Next.js, TS, Tailwind, shadcn, lint/CI), `env.ts`, DAL client + one end-to-end read (`monthly_chargeback` → table on a page).
- Entra auth + role resolution + middleware; three test users.
- Prerequisites confirmed: materialization job running (§9), audit columns added (§8.0), UC grants applied (§15).

**Sprint 1 — Work Queue + simple mappings (weeks 2–3)** ← first shippable value
- Work-queue page, all five tabs, with inline actions for users, workspaces, and job mappings.
- `user_mapping` / `workspace_mapping` / `job_product_mapping` admin grids.
- Mutation skeleton (role → zod → service → post-check → revalidate) hardened here; everything later reuses it.

**Sprint 2 — Product catalogue + warehouses (weeks 3–4)**
- Versioned catalogue CRUD with the atomic MERGE move, history timeline, retire flow.
- Warehouse shared/dedicated screen.
- Rogue-tag queue actions ("register product").

**Sprint 3 — Reporting (weeks 5–6)**
- Dashboard with KPI tiles, domain bars, trends, coverage chart, live/published toggle.
- Drill-down page + statement-text on-demand fetch; desk invoice pages; CSV exports.

**Sprint 4 — Health & publication (week 7)**
- Async health-check runner + `app_health_runs`, health page, gated publish action, published-invoice flow end-to-end.
- Playwright golden paths; load sanity check; runbook.

**Steady state**
- Monthly cycle happens *in the app*: checks → publish → invoices distributed → coverage reviewed.
- Backlog candidates (explicitly deferred, matching the Methodology): multi-desk splits UI (`data_product_split`, §4.6) — only if a real case forces it; budget alerts; Slack/Teams notification on publish; correction/restatement workflow (§11.2).

---

### Appendix A — Decision summary (defaults chosen; revisit if context differs)

| Decision | As built | Revisit when |
|---|---|---|
| Hosting | Azure App Service container (Option B) | Databricks Apps enabled and limits fit → Option A. Either way: ONE replica (see §12 cache constraint) |
| DB identity | Single service principal, app-level RBAC (azure-cli user auth for dev) | Compliance requires per-user UC audit → OBO (§5.3) |
| Reads | Live views + `"use cache"` import model with explicit refresh | `system.query.history` retention matters (>90d per-query drill) → wire up the §9 materialized tables |
| Writes | Server Actions, atomic MERGE, §7.4 post-conditions | Concurrent-steward conflicts observed → add CAS versioning |
| Charts | Server-rendered SVG/divs (no chart library) | Interactivity demands exceed hover/click-through → reconsider a client library |
| Exports | CSV (16 reports) + XLSX workbook via exceljs | — (shipped) |

*End of document.*
