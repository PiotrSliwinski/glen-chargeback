# Chargeback Management App — Next.js Implementation Guide

**Companion to:** [databricks_chargeback_methodology.md](databricks_chargeback_methodology.md) (referenced below as *Methodology*)
**Version:** 1.0 — July 2026
**Purpose:** end-to-end implementation guide for a React / Next.js web application that (a) manages the reference data of the chargeback model — the four mapping tables in `main_dev.cost_reporting` — and (b) serves the reporting layer (dashboard, drill-down, invoices, coverage, health checks, monthly publication) effectively.

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
| Work queue: untagged jobs, unknown runners/workspaces, rogue tags, unassigned warehouses | Methodology §7.2 / §7.3 queries | Steward+ |
| Reference-data CRUD: `data_product_mapping`, `job_product_mapping`, `warehouse_product_mapping`, `user_mapping`, `workspace_mapping` | mapping tables | Steward+ |
| Health checks (reconciliation + integrity) | Methodology §7.1 / §7.4 | Steward+ |
| Monthly publication snapshot | `monthly_chargeback_published` | Publisher only |

### Non-negotiable principles (inherited from the Methodology)

1. **One write surface.** The app never writes anywhere except the mapping tables and (Publisher only) `monthly_chargeback_published`. No app-side database of record — Databricks *is* the database.
2. **Validity versioning is enforced in the write path**, not trusted to users: moving a product to another desk closes the old row and inserts a new one; `desk` is never updated in place (Methodology §4.3, §10.5).
3. **Every write is audited** (`mapped_by`, `mapped_at`) and followed by the §7.4 integrity checks as a post-condition; violations roll the change back.
4. **Reports read from materialized tables** (`*_fact_tbl`, `monthly_chargeback`) wherever possible; live views only for ad-hoc truth. Invoices read the **published snapshot**, never live views.
5. **UNALLOCATED is a feature, not a bug** — the UI must make unallocated cost loud and actionable (work queue), never hide it.

---

## 2. Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│  Browser (React)                                                       │
│    Next.js App Router pages · TanStack Query · TanStack Table ·        │
│    Recharts · react-hook-form + zod                                    │
└───────────────▲────────────────────────────────────────────────────────┘
                │ HTTPS (session cookie, Entra ID)
┌───────────────┴────────────────────────────────────────────────────────┐
│  Next.js server (Node runtime)                                         │
│    Route handlers /api/* + Server Actions                              │
│    ├─ auth: NextAuth (Entra ID) → role resolution (Viewer/Steward/     │
│    │        Publisher) via Entra group claims                          │
│    ├─ dal/: typed, parameterized SQL over Databricks SQL Warehouse     │
│    ├─ services/: write-path business rules (versioning, integrity)    │
│    └─ cache: per-query TTL cache (dashboard reads), tag-based          │
│       revalidation on writes                                           │
└───────────────▲────────────────────────────────────────────────────────┘
                │ Databricks SQL (@databricks/sql over a SQL Warehouse,
                │ service principal M2M OAuth; user identity carried in
                │ audit columns)
┌───────────────┴────────────────────────────────────────────────────────┐
│  Databricks — main_dev.cost_reporting                                  │
│    READ : monthly_chargeback, cost_fact(_tbl), attribution_coverage,   │
│           desk_monthly_invoice, monthly_chargeback_published,          │
│           health-check queries (§7)                                    │
│    WRITE: user_mapping, workspace_mapping, data_product_mapping,       │
│           job_product_mapping, warehouse_product_mapping,              │
│           monthly_chargeback_published (Publisher)                     │
└────────────────────────────────────────────────────────────────────────┘
```

Key decisions and why:

- **All SQL runs server-side.** The browser never sees a Databricks token or SQL text. Route handlers / server actions are the only door.
- **One service principal, app-enforced RBAC.** The app connects as a single service principal with `SELECT` on the schema and `MODIFY` on the mapping tables. Roles are enforced in the app layer from Entra ID group membership, and every write stamps the *human* user into `mapped_by`. (Alternative — on-behalf-of user tokens with Unity Catalog enforcing grants — is discussed in §5.3; it's stronger but significantly more work. Start with the SP model; UC grants remain the backstop for anyone bypassing the app.)
- **Reads and writes are asymmetric.** Reads are cache-friendly, aggregated, and hit materialized tables. Writes are rare, synchronous, validated, and bust the relevant caches.

---

## 3. Technology Stack

| Concern | Choice | Rationale |
|---|---|---|
| Framework | **Next.js 15+ (App Router, TypeScript)** | Server Components keep SQL server-side by construction; Server Actions give a clean write path; one deployable unit |
| Databricks connectivity | **`@databricks/sql`** (Databricks SQL Driver for Node.js) | Official driver; supports M2M OAuth, parameterized statements, cloud-fetch for large results. Fallback: SQL Statement Execution REST API (`/api/2.0/sql/statements`) — useful on edge runtimes, but the driver is simpler on Node |
| Auth | **NextAuth v5 (Auth.js) + Microsoft Entra ID provider** | Azure shop (Azure Databricks) → Entra ID SSO is the natural IdP; group claims drive roles |
| Server state / fetching | **TanStack Query v5** | Caching, background refetch, optimistic updates for mapping CRUD |
| Tables / grids | **TanStack Table v8** (+ virtualization for the detail drill) | Headless, sorting/filtering/pagination client-side over server-paged data |
| Charts | **Recharts** | Bar/line/stacked-area needs of §10.2–10.3 covered; SSR-friendly enough |
| Forms & validation | **react-hook-form + zod** | zod schemas shared between client forms and server actions — one source of validation truth |
| Styling / components | **Tailwind CSS + shadcn/ui** | Fast, accessible admin-UI primitives (Dialog, Combobox, DataTable, Toast) |
| Runtime validation of query results | **zod** on DAL boundaries | Databricks returns loosely-typed rows; parse once at the edge of the DAL |
| Lint/format/test | ESLint, Prettier, **Vitest** + Testing Library, **Playwright** for E2E | Standard |

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

1. **Middleware** (`middleware.ts`): redirect unauthenticated users; block `/admin/*` and `/queue/*` below `steward`.
2. **Server actions / route handlers**: every mutating entry point re-checks the role (`requireRole('steward')`) — middleware alone is not sufficient for actions.
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

```ts
// src/dal/client.ts
import { DBSQLClient } from "@databricks/sql";

let clientPromise: Promise<DBSQLClient> | null = null;

export function getClient(): Promise<DBSQLClient> {
  clientPromise ??= new DBSQLClient().connect({
    host: process.env.DATABRICKS_HOST!,          // adb-xxxx.azuredatabricks.net
    path: process.env.DATABRICKS_HTTP_PATH!,     // /sql/1.0/warehouses/<id>
    authType: "databricks-oauth",
    oauthClientId: process.env.DATABRICKS_CLIENT_ID!,      // service principal
    oauthClientSecret: process.env.DATABRICKS_CLIENT_SECRET!,
  });
  return clientPromise;
}

export async function query<T>(
  sql: string,
  namedParameters: Record<string, unknown> = {},
  schema?: z.ZodType<T>,
): Promise<T[]> {
  const client = await getClient();
  const session = await client.openSession();
  try {
    const op = await session.executeStatement(sql, { namedParameters });
    const rows = (await op.fetchAll()) as unknown[];
    await op.close();
    return schema ? rows.map((r) => schema.parse(r)) : (rows as T[]);
  } finally {
    await session.close();
  }
}
```

Rules:

- **Always parameterized** (`:name` named parameters) — never string-interpolate user input into SQL. Identifiers that must be dynamic (none should be) go through an allowlist.
- **Serverless SQL Warehouse, size 2X-Small–Small, auto-stop 10 min.** The app's queries are aggregates over materialized tables — tiny. The health checks (§11) are the only heavy ones.
- Wrap `query()` with a **timeout + retry-on-warehouse-starting** helper: the first query after auto-stop returns slowly while the warehouse spins up; surface a "warming up" state to the UI rather than an error.
- The fully-qualified schema prefix comes from one constant (`main_dev.cost_reporting` via `env.DBX_SCHEMA`) so dev/prod schemas can differ.

### 6.2 Typed row schemas

Every query result is parsed with zod at the DAL boundary. Example:

```ts
// src/dal/schemas.ts
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
  client.ts                 // connection + query()
  schemas.ts                // zod row schemas
  reports.ts                // monthly_chargeback, cost_fact drill, coverage, invoice
  workQueue.ts              // §7.2/§7.3 queries
  health.ts                 // §7.1 reconciliation + §7.4 integrity
  mappings/
    dataProduct.ts          // catalogue CRUD incl. versioning statements
    jobProduct.ts
    warehouseProduct.ts
    user.ts
    workspace.ts
  publish.ts                // monthly snapshot insert + published reads
```

---

## 7. Project Structure

```
src/
  app/
    (auth)/login/
    (app)/
      layout.tsx                    // shell: nav, month selector context, role gate
      page.tsx                      // 10.2 Dashboard (landing)
      drill/
        page.tsx                    // 10.3 Domain -> Product -> Desk -> Detail
      invoices/
        page.tsx                    // desk invoice list (published)
        [desk]/page.tsx             // single desk statement, print/export view
      queue/
        page.tsx                    // 10.4 Work queue (tabbed: 5 queues)
      admin/
        products/page.tsx           // 10.5 Product catalogue (versioned CRUD)
        jobs/page.tsx               // job_product_mapping
        warehouses/page.tsx         // warehouse_product_mapping
        users/page.tsx              // user_mapping
        workspaces/page.tsx         // workspace_mapping
      health/
        page.tsx                    // 10.6 Health & reconciliation + publish button
    api/
      auth/[...nextauth]/route.ts
      export/[report]/route.ts      // CSV/XLSX streaming exports
  actions/                          // server actions (all mutations)
    products.ts  jobs.ts  warehouses.ts  users.ts  workspaces.ts  publish.ts
  dal/                              // see §6.3
  services/                         // write-path business rules (§8)
    productCatalogue.ts
    integrity.ts                    // §7.4 checks as reusable post-conditions
  lib/
    auth.ts  rbac.ts  cache.ts  format.ts (money/DBU formatting)  env.ts
  components/
    charts/  tables/  forms/  kpi/  month-picker/
```

Conventions:

- **Pages are React Server Components** that call the DAL directly for initial data; interactive widgets are client components hydrated with the same data via TanStack Query (`initialData`).
- **All mutations are Server Actions** in `src/actions/*` — thin wrappers: `requireRole` → zod-parse input → call service → revalidate cache tags → return typed result.
- A global **month-selector context** (URL search param `?month=2026-06`, so views are linkable) plus a **live/published toggle** as specified in §10.2.

---

## 8. Reference Data Management (Write Path)

This is the heart of "manage reference data". Each table gets a dedicated admin screen; the hard logic lives in `services/`, not in components.

### 8.0 A prerequisite: extend audit columns

The Methodology defines `mapped_by`/`mapped_at` on `job_product_mapping` only and suggests extending others (§10.7.1). Do it before building the app:

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

(Note the exclusive-join semantics from Methodology §10.5: old row's `valid_to = cutover_date`, new row's `valid_from = cutover_date` — `cost_fact` joins `usage_date < valid_to`, so there is no gap and no overlap.)

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
| **Edit metadata** (`product_owner` only) | in-place UPDATE allowed — owner is not part of the reporting hierarchy |
| **Retire product** | set `valid_to`; warn with a preview of 30-day trailing cost that will fall to the work queue; **block** if bridge tables still reference the product (offer to show them) |
| ~~Delete~~ | not offered, ever (§10.7.3) |

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
// src/actions/products.ts
"use server";
export async function moveProduct(input: unknown) {
  const session = await requireRole("steward");
  const cmd = MoveProductInput.parse(input);            // zod
  await productCatalogue.move(cmd, session.user.email); // MERGE + post-checks
  revalidateTag("catalogue");
  revalidateTag("reports-live");                        // live views changed
  return { ok: true as const };
}
```

Every mutation follows this exact shape: **role → parse → service (write + post-condition) → cache invalidation**.

---

## 9. Work Queue

The operational heart (Methodology §10.4). One page, five tabs, shared layout: a server-paged table sorted by unattributed cost descending, each row with an inline action that opens a pre-filled dialog.

| Tab | Query | Inline action → mutation |
|---|---|---|
| **Untagged jobs** | §7.2 first query, `usage_category <> 'SQL_WAREHOUSE'` | "Map to product" → insert `job_product_mapping` (+ banner: *durable fix is tagging the job — see runbook link*) |
| **Unknown runners** | §7.2 second query | "Add user" → insert `user_mapping` (user_id pre-filled read-only) |
| **Unknown workspaces** | §7.2 third query | "Add workspace" → insert `workspace_mapping` |
| **Rogue tags** | §7.3 | Two actions: "Register product" → create in catalogue with `data_product` = tag value; or "Flag for tag fix" → copies a ready-made message for the owning team |
| **Unassigned warehouses** | dedicated-warehouse candidates: warehouses with method `USER`/`NONE` and high idle share | "Assign warehouse" → MERGE `warehouse_product_mapping` |

Product-quality touches that make this page actually drive cleanup:

- **KPI strip at the top:** total unallocated $ last 30 days, count per queue — the number stewards are trying to drive to zero.
- After a successful action, the row is **optimistically removed** and a toast offers undo (undo = inverse mutation, valid within the session only).
- **Attribution note:** newly-added mappings affect *live* views immediately but change nothing about published months (§10.7.4) — the UI states this after each action so nobody expects an issued invoice to move.
- Each queue is exportable (CSV) for offline chasing.

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
- **Per-statement drill:** rows with a `statement_id` get an expander that fetches `statement_text` on demand from `system.query.history` (`WHERE statement_id = :id`) — deliberately not in any view (§5.1); requires the app SP to have `SELECT` on `system.query.history`, and the text is fetched only on click.
- Every detail row shows its `attribution_method` as a badge (TAG green, JOB_MAPPING amber, USER blue, NONE red) — this is how stewards spot *why* a cost landed where it did.

### 10.3 Desk invoices

- `/invoices` — grid of desks × months from the **published snapshot only**, with `desk_month_total`.
- `/invoices/[desk]?month=` — printable statement: desk header, month, domain→product breakdown, total, the limitations footer, `published_at` timestamp. Add a print stylesheet + "Download PDF" (via headless print) and CSV export.
- If the selected month has no published snapshot, show "not yet published" and (for publishers) a link to the health page — never fall back silently to live data.

### 10.4 Exports

One streaming route handler `GET /api/export/:report?month=...` producing CSV (XLSX via `exceljs` if finance insists) for: monthly chargeback, desk invoice, coverage, each work queue. Uses the same DAL functions; role-checked like the pages.

---

## 11. Health, Reconciliation & Publication

### 11.1 Health page (§10.6)

A checklist per month, each item green/red with the raw numbers on expand:

| Check | Source | Pass condition |
|---|---|---|
| Reconciliation | §7.1 | `abs(fact_gap) < $1` and `abs(report_gap) < $1` (tolerance configurable via env) |
| Validity overlaps | §7.4(a) | 0 rows |
| Orphan bridge products | §7.4(b) | 0 rows |
| Duplicate bridge keys | §7.4(c) | 0 rows |
| Warehouse flag consistency | §7.4(d) | 0 rows |
| Coverage snapshot | §6.3 | informational (TAG% displayed, no gate) |

**The reconciliation query scans a year of `system.billing.usage` — it can run for minutes.** Do not run it in a request/response cycle:

- "Run checks" starts the statements **asynchronously** (fire the queries, persist a run record with statement handles/status into a small app table `main_dev.cost_reporting.app_health_runs`), and the page polls a lightweight status endpoint.
- Optionally schedule the checks daily via a Databricks Workflow writing results into `app_health_runs`, so the page usually just *reads* the latest run and "Run now" is the exception.

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

After publish: revalidate `reports-published` cache tags and show the diff vs live (should be zero at publish time).

---

## 12. Performance & Caching Strategy

The reporting workload is tiny *if* it reads materialized tables. Three rules:

1. **Point the app's `cost_fact` reads at the materialized layer.** Prerequisite from Methodology §9: the daily refresh job populating `query_fact_tbl` / `usage_fact_tbl` (and ideally `cost_fact_tbl`) must exist before the app ships. The app reads `cost_fact_tbl` / `monthly_chargeback`; the live views stay available behind an "ad-hoc truth" escape hatch on the health page only. Without this, the landing dashboard would trigger the 23.9M-row / 15 GB scan documented in §9.
2. **Server-side cache with tag invalidation.** Wrap DAL read functions in Next's `unstable_cache` (or a small LRU) keyed by (query, params):
   - `reports-published`: TTL 24 h (snapshots are immutable) — invalidated only by a publish.
   - `reports-live`, `catalogue`, `queue`: TTL 15 min — invalidated by any mapping mutation (`revalidateTag`).
   - Health-check results: no TTL cache; read from `app_health_runs`.
3. **Push aggregation into SQL, page in SQL.** No "fetch all rows, aggregate in JS". Detail drills use `LIMIT :pageSize OFFSET :offset` with a stable `ORDER BY cost DESC, job_id` and a capped page count; exports stream.

Warehouse sizing note: with caching + materialized tables, a 2X-Small serverless warehouse with 10-minute auto-stop will serve this app for a handful of concurrent finance users. The month-end health checks are the only reason to ever scale it up temporarily.

---

## 13. Validation, Error Handling & Auditing

- **Shared zod schemas** per mutation (`MoveProductInput`, `MapJobInput`, …) used by both the client form resolver and the server action — the server parse is authoritative.
- **Structured action results:** `{ ok: true } | { ok: false, code: 'OVERLAP' | 'ORPHAN_PRODUCT' | 'DUPLICATE_KEY' | 'BAD_KEY_FORMAT' | 'RECON_STALE' | ..., detail }` — the UI maps codes to human messages; never leak raw SQL errors to the browser (log them server-side with a correlation id shown in the toast).
- **Audit:** every mutation stamps `mapped_by` (Entra UPN) + `mapped_at`; additionally emit an app-level audit log line (JSON: actor, action, table, key, before/after) to stdout → the platform's log pipeline. Delta `DESCRIBE HISTORY` is the tamper-proof backstop.
- **Admin screens show audit info** inline (mapped_by/at columns) — provenance visible where the data is edited.

---

## 14. Testing Strategy

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

# --- App behavior
RECON_TOLERANCE_USD=1
LIVE_CACHE_TTL_SECONDS=900
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
GRANT MODIFY ON TABLE main_dev.cost_reporting.warehouse_product_mapping TO `sp-chargeback-app`;
GRANT MODIFY ON TABLE main_dev.cost_reporting.monthly_chargeback_published TO `sp-chargeback-app`;
-- statement-text drill:
GRANT SELECT ON TABLE system.query.history TO `sp-chargeback-app`;
```

---

## 16. Delivery Plan

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

| Decision | Default | Revisit when |
|---|---|---|
| Hosting | Azure App Service container (Option B) | Databricks Apps enabled and limits fit → Option A |
| DB identity | Single service principal, app-level RBAC | Compliance requires per-user UC audit → OBO (§5.3) |
| Reads | Materialized tables + 15-min tag cache | Data freshness complaints → shorten TTL, not bypass materialization |
| Writes | Server Actions, atomic MERGE, §7.4 post-conditions | Concurrent-steward conflicts observed → add CAS versioning |
| Charts | Recharts | Finance wants pixel-perfect exports → add server-rendered chart images |
| Exports | CSV streaming | Finance requires XLSX → exceljs on the same routes |

*End of document.*
