# Azure Databricks Internal Chargeback — Methodology & Implementation Reference

**Schema:** `main_dev.cost_reporting`
**Version:** 1.0 — July 2026
**Purpose of this document:** single source of truth for the chargeback data model. It contains the full methodology, every table and view definition (runnable `CREATE` scripts), operational and validation queries, and the functional specification for a management interface built on top of these objects.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Methodology](#2-methodology)
3. [Source System Tables](#3-source-system-tables)
4. [Mapping Tables (DDL)](#4-mapping-tables)
5. [Core Allocation Views](#5-core-allocation-views)
6. [Semantic Layer Views](#6-semantic-layer-views)
7. [Operational & Validation Queries](#7-operational--validation-queries)
8. [Tagging Strategy per Workload Type](#8-tagging-strategy-per-workload-type)
9. [Refresh & Materialization](#9-refresh--materialization)
10. [Management Interface Specification](#10-management-interface-specification)
11. [Rollout Plan & Governance](#11-rollout-plan--governance)

---

## 1. Architecture Overview

Three layers, each with a distinct responsibility:

```
┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 3 — REPORTING                                                  │
│   monthly_chargeback         (month × domain × product × desk)       │
│   attribution_coverage       (tagging-quality KPI)                   │
├─────────────────────────────────────────────────────────────────────┤
│ LAYER 2 — SEMANTIC / ATTRIBUTION                                     │
│   cost_fact                  (unified fact + attribution waterfall)  │
│   uses: data_product_mapping, job_product_mapping,                   │
│         warehouse_product_mapping, user_mapping                      │
├─────────────────────────────────────────────────────────────────────┤
│ LAYER 1 — RAW ALLOCATION                                             │
│   query_view                 (SQL warehouse spend → per query)       │
│   usage_view                 (all other spend → per runner/job)      │
│   uses: system.billing.usage, system.billing.list_prices,            │
│         system.query.history, system.workflow.jobs,                  │
│         user_mapping, workspace_mapping                              │
└─────────────────────────────────────────────────────────────────────┘
```

**Reporting hierarchy (three levels):**

| Level | Dimension | Source | Meaning |
|---|---|---|---|
| 1 | `data_domain` | derived from `data_product_mapping` | Business/data domain grouping |
| 2 | `data_product` | tag or mapping (attribution waterfall) | The unit of attribution — the only key teams declare |
| 3 | `desk` | derived from `data_product_mapping` | Main data beneficiary — who pays |

**Core design principle — one attribution key.** Workloads declare only `data_product` (via tag or mapping). Domain and desk are *always* derived by joining `data_product_mapping`. Teams never tag domain or desk directly; this prevents the three dimensions from drifting apart.

---

## 2. Methodology

### 2.1 Cost calculation

Every cost figure in the system is computed the same way:

```
cost = usage_quantity × price effective at usage_start_time
```

- Prices come from `system.billing.list_prices`, joined **time-effectively**:
  `usage_start_time >= price_start_time AND (price_end_time IS NULL OR usage_start_time < price_end_time)`.
  Matching on the start time only guarantees every usage row matches exactly one price row, even when a usage slice spans a price change.
- The join always filters `currency_code = 'USD'`. `list_prices` holds one row per SKU **per currency**; omitting the filter fans out every usage row and multiplies both DBUs and cost. **If the account is billed in another currency, the literal must be changed in `query_view` and `usage_view` together.**
- `usage_view` prefers `pricing.effective_list.default` (reflects negotiated rates where populated) with fallback to `pricing.default`. `query_view` uses `pricing.default`; align the two if `effective_list` is populated for your account.
- List prices exclude discounts not reflected in `effective_list`. For classic (non-serverless) compute, the Azure VM / infrastructure cost billed directly by Microsoft is **out of scope** — this system charges back the Databricks (DBU) component only.

### 2.2 Two allocation models

**A. Shared SQL warehouses — proportional allocation (`query_view`).**
Billing records for a SQL warehouse carry no user identity: many users share one warehouse. Allocation:

1. Sum warehouse DBUs and cost per **warehouse-hour** from `system.billing.usage`.
2. Take all `FINISHED` statements that **started** in that warehouse-hour from `system.query.history`.
3. Distribute the hour's DBUs/cost across those statements proportionally to `total_task_duration_ms` (actual compute effort, not wall-clock).
4. Warehouse-hours with billing but no matching statements (startup, idle, auto-stop lag, history beyond the ~90-day `query.history` retention) surface as `user_id = 'UNALLOCATED_IDLE'` rows carrying the full hour's cost.

*Known accepted limitation:* a statement is attributed entirely to the hour in which it started; multi-hour statements are not split across hours.

**B. Everything else — direct attribution (`usage_view`).**
Jobs, DLT pipelines, serverless workloads and model serving carry `identity_metadata.run_as` (the executing user or service principal) directly on the billing record, so no proportional split is needed. One row per day × runner × workspace × job × SKU × tags.

**Non-overlap rule:** `usage_view` excludes all rows where `usage_metadata.warehouse_id IS NOT NULL`, because that spend is allocated per-query in `query_view`. Together the two views cover all DBU spend **exactly once**.

### 2.3 The attribution waterfall

`cost_fact` assigns each cost row a `data_product` by the first matching rule. The rule used is recorded in `attribution_method` so tagging coverage can be measured:

| Priority | Rule | `attribution_method` | Mechanism |
|---|---|---|---|
| 1 | `custom_tags.data_product` present on the billing record | `TAG` | Cluster tags / serverless budget policies — authoritative, self-maintaining |
| 2 | `(workspace_id, job_id)` found in `job_product_mapping` | `JOB_MAPPING` | Manual bridge for not-yet-tagged jobs |
| 3 | Dedicated warehouse in `warehouse_product_mapping` (`is_shared = false`) | `WAREHOUSE_MAPPING` | Whole warehouse belongs to one product (incl. its idle cost) |
| 4 | Runner found in `user_mapping` | `USER` | Ad-hoc work → product `AD_HOC`, desk = runner's desk |
| 5 | Nothing matched | `NONE` | Product/desk = `UNALLOCATED`; visible line item, pressure to fix |

The goal state is rule 1 dominating: mapping tables are a bridge, tags at source are the destination.

### 2.4 Reconciliation invariant

The system's correctness test, run after any change and before every monthly publication:

```
SUM(query_view.cost_allocated) + SUM(usage_view.total_cost)
  =  SUM over system.billing.usage of (usage_quantity × time-effective USD price)
```

This holds because: `query_view` LEFT-joins queries onto usage (idle hours preserved as `UNALLOCATED_IDLE`), `usage_view` LEFT-joins all mappings (unmapped workspaces surface as `UNMAPPED: <id>` instead of being dropped), and the warehouse filter partitions billing rows disjointly between the two views. See §7.1 for the exact query.

### 2.5 Time semantics

- Monthly chargeback is keyed on `usage_date` (billing record date), truncated to month.
- `data_product_mapping` is **validity-versioned** (`valid_from` / `valid_to`). When a product changes desk or domain, a new row is added and the old row is closed. Historical months therefore never restate — January's report is identical whether run in February or December.
- `system.query.history` retains ~90 days vs ~1 year for `system.billing.usage`: warehouse spend older than the query-history horizon degrades gracefully to `UNALLOCATED_IDLE`. Materialize `query_view` (see §9) to preserve per-query allocations beyond 90 days.

---

## 3. Source System Tables

| Table | Used for | Key columns used | Retention |
|---|---|---|---|
| `system.billing.usage` | All DBU consumption | `usage_date`, `usage_start_time`, `usage_end_time`, `usage_quantity`, `usage_unit`, `sku_name`, `cloud`, `workspace_id`, `billing_origin_product`, `usage_metadata.warehouse_id`, `usage_metadata.job_id`, `usage_metadata.job_name`, `identity_metadata.run_as`, `product_features.is_serverless`, `custom_tags.*` | ~1 year |
| `system.billing.list_prices` | Pricing | `sku_name`, `cloud`, `currency_code`, `price_start_time`, `price_end_time`, `pricing.default`, `pricing.effective_list.default` | full history |
| `system.query.history` | Per-statement warehouse allocation | `statement_id`, `start_time`, `end_time`, `compute.warehouse_id`, `executed_by`, `statement_type`, `execution_status`, `total_task_duration_ms`, `total_duration_ms`, `read_bytes`, `produced_rows`, `workspace_id` | ~90 days |
| `system.workflow.jobs` | Job names (SCD-style change log) | `workspace_id`, `job_id`, `name`, `change_time` | full history |
| `system.lakeflow.job_run_timeline` | (Optional) true job run durations | run start/end per job run | — |

Notes:
- `job_id` is unique **only within a workspace** — every join/dedup on jobs must include `workspace_id`.
- Billing rows are metering slices, not runs; never present slice durations as job runtime.

---

## 4. Mapping Tables

All mapping tables live in `main_dev.cost_reporting` and are the write surface of the management interface (§10). Everything else in the system is read-only derived logic.

### 4.1 `user_mapping` (pre-existing — expected schema)

Maps runner identities (user emails and service-principal application IDs, as they appear in `executed_by` / `identity_metadata.run_as`) to display names and desks.

```sql
CREATE TABLE IF NOT EXISTS main_dev.cost_reporting.user_mapping (
  user_id     STRING NOT NULL,   -- email or service principal ID, exactly as in system tables
  user_name   STRING NOT NULL,   -- display name
  desk        STRING NOT NULL    -- runner's home desk (used for AD_HOC attribution)
)
COMMENT 'Runner identity -> display name + home desk. user_id must match executed_by (query.history) and identity_metadata.run_as (billing.usage) exactly, including service principal IDs.';
```

### 4.2 `workspace_mapping` (pre-existing — expected schema)

```sql
CREATE TABLE IF NOT EXISTS main_dev.cost_reporting.workspace_mapping (
  workspace_id     STRING NOT NULL,
  workspace_name   STRING NOT NULL
)
COMMENT 'Workspace ID -> friendly name. Workspaces missing here surface in reports as UNMAPPED: <id> - they are never dropped.';
```

### 4.3 `data_product_mapping` — the hierarchy backbone

One row per data product per validity period. **Domain and desk are always derived from this table, never from tags.**

```sql
CREATE TABLE IF NOT EXISTS main_dev.cost_reporting.data_product_mapping (
  data_product      STRING NOT NULL,   -- canonical key, matches tag values
  data_domain       STRING NOT NULL,   -- level 1 rollup
  desk              STRING NOT NULL,   -- main beneficiary (level 3)
  product_owner     STRING,            -- accountable person
  cost_split_pct    DOUBLE DEFAULT 1.0,-- reserved for future multi-desk splits
  valid_from        DATE   NOT NULL,
  valid_to          DATE               -- NULL = current; keeps history for restated months
)
COMMENT 'One row per data product (per validity period). Domain and desk are ALWAYS derived from here, never from tags directly.'
TBLPROPERTIES ('delta.feature.allowColumnDefaults' = 'supported');
```

**Integrity rules (enforced by the management interface, validated by §7.4):**
1. At any given date, at most **one** active row per `data_product` (no overlapping validity windows).
2. Moving a product to another desk = `UPDATE` old row's `valid_to` to the cutover date **and** `INSERT` a new row with `valid_from` = cutover date. Never update `desk` in place — that restates history.
3. `data_product` values are the canonical vocabulary for tags: lowercase, hyphen/underscore separated, no spaces (e.g. `pricing-curves`, `trade_pnl`). Tags that don't match a row here fall to `UNALLOCATED` attribution at the domain/desk level (§6.1 keeps the raw tag visible).

### 4.4 `job_product_mapping` — bridge for untagged jobs

```sql
CREATE TABLE IF NOT EXISTS main_dev.cost_reporting.job_product_mapping (
  workspace_id   STRING NOT NULL,
  job_id         STRING NOT NULL,     -- composite key with workspace_id (job_id NOT globally unique)
  data_product   STRING NOT NULL,
  note           STRING,              -- optional: why mapped manually
  mapped_by      STRING,              -- audit: who created the mapping
  mapped_at      TIMESTAMP            -- audit: when
)
COMMENT 'Manual bridge: (workspace, job) -> data product, for jobs not yet tagged at source. Rule 2 of the attribution waterfall. Target state is to empty this table by tagging jobs directly.';
```

### 4.5 `warehouse_product_mapping` — dedicated warehouses

```sql
CREATE TABLE IF NOT EXISTS main_dev.cost_reporting.warehouse_product_mapping (
  warehouse_id   STRING NOT NULL,
  data_product   STRING,              -- NULL = shared warehouse, allocate per user
  is_shared      BOOLEAN
);
```

Semantics: a row with `is_shared = false` and a `data_product` assigns the **entire warehouse** — including its idle/unallocated hours — to that product (waterfall rule 3). Shared warehouses either have a row with `is_shared = true` or no row at all; their cost is attributed per-query through rules 1/4.

### 4.6 (Optional, deferred) `data_product_split`

Only create if a product genuinely must be split across desks. Start without it — splits invite negotiation overhead.

```sql
-- CREATE TABLE main_dev.cost_reporting.data_product_split (
--   data_product STRING NOT NULL,
--   desk         STRING NOT NULL,
--   split_pct    DOUBLE NOT NULL,   -- must sum to 1.0 per product (validate in interface)
--   valid_from   DATE   NOT NULL,
--   valid_to     DATE
-- );
```

---

## 5. Core Allocation Views

> **Change note vs v0.9:** both views now expose the columns the semantic layer needs — `usage_view` adds `job_id` and `tag_data_product` (from `custom_tags.data_product`); `query_view` adds `workspace_id`. Everything else is unchanged.

### 5.1 `query_view` — per-query SQL warehouse allocation

```sql
-- =====================================================================
-- View: main_dev.cost_reporting.query_view
-- Purpose: Per-query DBU and cost allocation for SQL warehouses.
--
-- Methodology:
--   * Warehouse DBU consumption is taken hourly from system.billing.usage
--     and priced with the list price effective AT THE TIME of usage
--     (time-effective join to system.billing.list_prices, USD).
--   * Each hour's DBUs/cost are distributed across the FINISHED queries
--     that started in that warehouse-hour, proportionally to their
--     total task duration.
--   * Warehouse-hours with billing usage but no matching queries
--     (startup, idle, auto-stop lag, or query history older than the
--     ~90-day system.query.history retention) appear as rows with
--     user_id = 'UNALLOCATED_IDLE', so SUM(cost_allocated) reconciles
--     exactly with system.billing.usage.
--
-- Notes:
--   * statement_text is intentionally NOT included (it dominated shuffle
--     cost in profiling). Join back to system.query.history on
--     statement_id when the text is needed.
--   * Currency is hardcoded to USD - change if billed in another currency
--     (must match the literal used in usage_view).
--   * List prices exclude negotiated discounts; classic warehouses also
--     exclude the Azure VM/infra cost billed separately by Microsoft.
-- =====================================================================

CREATE OR REPLACE VIEW main_dev.cost_reporting.query_view
COMMENT 'Per-query DBU and cost allocation for SQL warehouses. Hourly warehouse DBUs (system.billing.usage, priced at time-effective USD list price) distributed across finished queries proportionally to task duration. Idle/unmatched hours appear as UNALLOCATED_IDLE so totals reconcile with billing. statement_text excluded for performance - join to system.query.history on statement_id.'
AS
WITH usage_data AS (
  -- Hourly DBU consumption and cost per warehouse,
  -- priced at the rate effective at the time of usage
  SELECT
    u.usage_date,
    DATE_TRUNC('hour', u.usage_start_time)      AS usage_hour,
    u.workspace_id,
    u.usage_metadata.warehouse_id               AS warehouse_id,
    SUM(u.usage_quantity)                       AS total_dbu_per_hour,
    SUM(u.usage_quantity * p.pricing.default)   AS cost_per_hour
  FROM system.billing.usage u
  JOIN system.billing.list_prices p
    ON  u.sku_name = p.sku_name
    AND u.cloud = p.cloud
    AND p.currency_code = 'USD'                 -- adjust if billed in EUR etc.
    AND u.usage_start_time >= p.price_start_time
    AND (p.price_end_time IS NULL OR u.usage_start_time < p.price_end_time)
  WHERE u.usage_metadata.warehouse_id IS NOT NULL
    AND u.usage_unit = 'DBU'
    -- AND u.usage_date >= current_date() - INTERVAL 90 DAYS   -- optional: align with query.history retention
  GROUP BY 1, 2, 3, 4
),

query_data AS (
  -- One row per finished statement with the attributes needed for chargeback.
  -- statement_text deliberately excluded (see header).
  SELECT
    statement_id,
    DATE_TRUNC('hour', start_time)              AS query_hour,
    start_time,
    end_time,
    compute.warehouse_id                        AS warehouse_id,
    executed_by                                 AS user_id,
    statement_type,
    execution_status,
    total_task_duration_ms / 60000.0            AS duration_minutes,
    total_duration_ms / 60000.0                 AS wall_clock_minutes,
    read_bytes,
    produced_rows
  FROM system.query.history
  WHERE compute.warehouse_id IS NOT NULL
    AND execution_status = 'FINISHED'
    AND total_task_duration_ms > 0              -- exclude metadata-only statements
    -- AND start_time >= current_date() - INTERVAL 90 DAYS     -- optional: enables row-group pruning
    -- AND workspace_id IN (1234567890, 9876543210)            -- optional: partition pruning
),

hourly_totals AS (
  -- Small aggregate joined back to the detail, replacing the
  -- SUM() OVER (PARTITION BY ...) window which forced a full
  -- sort of all query rows
  SELECT
    query_hour,
    warehouse_id,
    SUM(duration_minutes)                       AS hour_total_duration
  FROM query_data
  GROUP BY 1, 2
),

queries_with_weights AS (
  SELECT
    q.*,
    t.hour_total_duration
  FROM query_data q
  JOIN hourly_totals t
    ON  t.query_hour   = q.query_hour
    AND t.warehouse_id = q.warehouse_id
)

SELECT
  u.usage_date                                  AS query_date,
  u.usage_hour,
  u.workspace_id,
  u.warehouse_id,
  q.statement_id,
  COALESCE(q.user_id, 'UNALLOCATED_IDLE')       AS user_id,
  COALESCE(um.user_name, q.user_id,
           'UNALLOCATED_IDLE')                  AS user_name,
  um.desk,
  q.statement_type,
  q.start_time,
  q.end_time,
  q.duration_minutes,
  q.wall_clock_minutes,
  q.read_bytes,
  q.produced_rows,
  u.total_dbu_per_hour                          AS warehouse_dbu_in_hour,
  u.cost_per_hour                               AS warehouse_cost_in_hour,
  CASE
    WHEN q.statement_id IS NULL THEN u.total_dbu_per_hour
    ELSE q.duration_minutes / NULLIF(q.hour_total_duration, 0)
         * u.total_dbu_per_hour
  END                                           AS dbu_allocated,
  CASE
    WHEN q.statement_id IS NULL THEN u.cost_per_hour
    ELSE q.duration_minutes / NULLIF(q.hour_total_duration, 0)
         * u.cost_per_hour
  END                                           AS cost_allocated
FROM usage_data u
LEFT JOIN queries_with_weights q
  ON  q.query_hour   = u.usage_hour
  AND q.warehouse_id = u.warehouse_id
LEFT JOIN main_dev.cost_reporting.user_mapping um
  ON q.user_id = um.user_id;
```

### 5.2 `usage_view` — everything except SQL warehouses

```sql
-- =====================================================================
-- View: main_dev.cost_reporting.usage_view
-- Purpose: Daily chargeback of all non-SQL-warehouse Databricks spend
--          (jobs, DLT pipelines, serverless, model serving, etc.),
--          attributed to the identity that ran the workload.
--
-- Methodology:
--   * One row per day / runner / workspace / job / SKU / tag combination,
--     taken from system.billing.usage.
--   * Attribution uses identity_metadata.run_as - the user or service
--     principal the workload executed as. Billing records for jobs,
--     pipelines and serverless carry this identity directly, so no
--     proportional allocation is needed (unlike shared SQL warehouses).
--   * Cost = usage_quantity x price effective AT THE TIME the usage
--     started (time-effective join to system.billing.list_prices, USD).
--     effective_list.default is preferred where populated, as it can
--     reflect negotiated rates; falls back to the standard list price.
--   * Job names come from usage_metadata.job_name when present,
--     otherwise from the latest known name in system.workflow.jobs
--     (deduplicated per workspace + job, since job_id is only unique
--     within a workspace).
--
-- Scope / reconciliation:
--   * SQL warehouse usage is EXCLUDED (usage_metadata.warehouse_id IS
--     NULL) because it is allocated per-query in query_view. Together
--     the two views cover all DBU spend exactly once.
--   * Workspaces missing from workspace_mapping appear as
--     'UNMAPPED: <workspace_id>' rather than being dropped.
--   * Runners missing from user_mapping keep their raw run_as identity.
--
-- Exposed for the semantic layer (cost_fact):
--   * job_id            - enables job_product_mapping (waterfall rule 2)
--   * tag_data_product  - custom_tags.data_product (waterfall rule 1)
-- =====================================================================

CREATE OR REPLACE VIEW main_dev.cost_reporting.usage_view
COMMENT 'Daily chargeback of all non-SQL-warehouse spend (jobs, DLT, serverless, etc.) from system.billing.usage, attributed via identity_metadata.run_as and priced at the time-effective USD price (effective_list preferred). SQL warehouse usage excluded - allocated per-query in query_view. Unmapped workspaces surface as UNMAPPED rows so totals reconcile with billing. Exposes job_id and tag_data_product for the attribution waterfall in cost_fact.'
AS
WITH latest_jobs AS (
  -- Latest known name per job. job_id is only unique within a
  -- workspace, so dedup and join must include workspace_id.
  SELECT
    workspace_id,
    job_id,
    name
  FROM (
    SELECT
      workspace_id,
      job_id,
      name,
      ROW_NUMBER() OVER (PARTITION BY workspace_id, job_id
                         ORDER BY change_time DESC) AS rn
    FROM system.workflow.jobs
  )
  WHERE rn = 1
)

SELECT
  u.usage_date,
  COALESCE(um.user_name, u.identity_metadata.run_as)          AS user_name,
  um.desk                                                     AS desk,
  COALESCE(wm.workspace_name,
           CONCAT('UNMAPPED: ', u.workspace_id))              AS workspace_name,
  u.identity_metadata.run_as                                  AS job_runner,
  u.usage_metadata.job_id                                     AS job_id,
  COALESCE(u.usage_metadata.job_name, lj.name)                AS job_name,
  u.workspace_id,
  u.sku_name,
  u.billing_origin_product,
  u.product_features.is_serverless                            AS is_serverless,
  u.usage_unit,
  u.custom_tags.data_product                                  AS tag_data_product,
  u.custom_tags.provider                                      AS provider,
  u.custom_tags.domain                                        AS domain,
  u.custom_tags.desk                                          AS tag_desk,
  u.custom_tags.Environment                                   AS environment,
  SUM(u.usage_quantity)                                       AS total_dbus,
  SUM(u.usage_quantity
      * COALESCE(lp.pricing.effective_list.default,
                 lp.pricing.default))                         AS total_cost
FROM system.billing.usage u

-- Time-effective price: match on the price row valid when usage STARTED.
-- currency_code filter prevents fan-out (one price row per currency).
LEFT JOIN system.billing.list_prices lp
  ON  u.sku_name = lp.sku_name
  AND u.cloud = lp.cloud
  AND lp.currency_code = 'USD'                 -- adjust if billed in EUR etc.
  AND u.usage_start_time >= lp.price_start_time
  AND (lp.price_end_time IS NULL
       OR u.usage_start_time < lp.price_end_time)

-- LEFT: unmapped runners keep raw run_as identity, desk stays NULL
LEFT JOIN main_dev.cost_reporting.user_mapping um
  ON u.identity_metadata.run_as = um.user_id

-- LEFT: unmapped workspaces surface as 'UNMAPPED: <id>' rather than
-- silently dropping their spend from the report
LEFT JOIN main_dev.cost_reporting.workspace_mapping wm
  ON u.workspace_id = wm.workspace_id

LEFT JOIN latest_jobs lj
  ON  u.workspace_id = lj.workspace_id
  AND u.usage_metadata.job_id = lj.job_id

-- SQL warehouse spend excluded: allocated per-query in query_view.
-- Removing this filter would double count warehouse DBUs.
WHERE u.usage_metadata.warehouse_id IS NULL

GROUP BY
  u.usage_date,
  user_name,
  desk,
  workspace_name,
  u.identity_metadata.run_as,
  u.usage_metadata.job_id,
  job_name,
  u.workspace_id,
  u.sku_name,
  u.billing_origin_product,
  u.product_features.is_serverless,
  u.usage_unit,
  u.custom_tags.data_product,
  u.custom_tags.provider,
  u.custom_tags.domain,
  u.custom_tags.desk,
  u.custom_tags.Environment;
```

### 5.3 `query_view_daily_summary` — convenience rollup

```sql
CREATE OR REPLACE VIEW main_dev.cost_reporting.query_view_daily_summary
COMMENT 'Daily DBU and cost per user and desk, aggregated from query_view. UNALLOCATED_IDLE rows represent warehouse usage with no attributable queries.'
AS
SELECT
  query_date,
  user_name,
  desk,
  COUNT(statement_id)                           AS query_count,
  SUM(duration_minutes)                         AS total_duration_minutes,
  SUM(wall_clock_minutes)                       AS total_wall_clock_minutes,
  SUM(dbu_allocated)                            AS total_dbu,
  SUM(cost_allocated)                           AS total_cost
FROM main_dev.cost_reporting.query_view
GROUP BY 1, 2, 3;
```

---

## 6. Semantic Layer Views

### 6.1 `cost_fact` — unified fact with attribution waterfall

The single source of truth for all reporting. Unions the two allocation views into a common shape, applies the waterfall (§2.3) once, and resolves the three-level hierarchy through the validity-versioned `data_product_mapping`.

```sql
-- =====================================================================
-- View: main_dev.cost_reporting.cost_fact
-- Purpose: Unified cost fact for chargeback reporting.
--
--   * UNION of query_view (SQL warehouse, per-query) and usage_view
--     (all other spend, per runner/job/day).
--   * Applies the attribution waterfall to assign data_product:
--       1 TAG                custom_tags.data_product on the record
--       2 JOB_MAPPING        (workspace_id, job_id) in job_product_mapping
--       3 WAREHOUSE_MAPPING  dedicated warehouse (is_shared = false)
--       4 USER               known runner -> AD_HOC, desk = runner's desk
--       5 NONE               UNALLOCATED
--   * data_domain and desk are derived from data_product_mapping with
--     validity-period join on usage_date, so historical months never
--     restate when a product moves desk.
--   * raw_tag_data_product is kept so tags that don't match any row in
--     data_product_mapping remain visible (they attribute as the tag
--     value at product level but UNALLOCATED at domain/desk level -
--     the coverage report in 6.3 surfaces them for cleanup).
--
-- Invariant: SUM(cost) over cost_fact = SUM over billing (see doc 7.1).
-- =====================================================================

CREATE OR REPLACE VIEW main_dev.cost_reporting.cost_fact
COMMENT 'Unified cost fact: per-query warehouse allocations + all other usage, with data_product attribution waterfall (TAG > JOB_MAPPING > WAREHOUSE_MAPPING > USER > NONE) and domain/desk derived from validity-versioned data_product_mapping. Source of truth for monthly chargeback.'
AS
WITH unified AS (

  -- ---- SQL warehouse spend, one row per allocated query (or idle hour)
  SELECT
    query_date                         AS usage_date,
    'SQL_WAREHOUSE'                    AS usage_category,
    CAST(workspace_id AS STRING)       AS workspace_id,
    warehouse_id                       AS compute_key,
    CAST(NULL AS STRING)               AS job_id,
    CAST(NULL AS STRING)               AS job_name,
    user_id                            AS runner,
    CAST(NULL AS BOOLEAN)              AS is_serverless,  -- not tracked per-query
    CAST(NULL AS STRING)               AS tag_data_product,
    statement_id,
    dbu_allocated                      AS dbus,
    cost_allocated                     AS cost
  FROM main_dev.cost_reporting.query_view

  UNION ALL

  -- ---- Everything else (jobs, DLT, serverless, model serving, ...)
  SELECT
    usage_date,
    billing_origin_product             AS usage_category,
    CAST(workspace_id AS STRING)       AS workspace_id,
    CAST(NULL AS STRING)               AS compute_key,
    CAST(job_id AS STRING)             AS job_id,
    job_name,
    job_runner                         AS runner,
    is_serverless,
    tag_data_product,
    CAST(NULL AS STRING)               AS statement_id,
    total_dbus                         AS dbus,
    total_cost                         AS cost
  FROM main_dev.cost_reporting.usage_view
),

attributed AS (
  SELECT
    u.*,
    COALESCE(
      u.tag_data_product,                                     -- rule 1: TAG
      jm.data_product,                                        -- rule 2: JOB_MAPPING
      whm.data_product,                                       -- rule 3: WAREHOUSE_MAPPING
      CASE WHEN um.user_id IS NOT NULL THEN 'AD_HOC' END,     -- rule 4: USER
      'UNALLOCATED'                                           -- rule 5: NONE
    )                                            AS data_product,
    CASE
      WHEN u.tag_data_product IS NOT NULL THEN 'TAG'
      WHEN jm.data_product    IS NOT NULL THEN 'JOB_MAPPING'
      WHEN whm.data_product   IS NOT NULL THEN 'WAREHOUSE_MAPPING'
      WHEN um.user_id         IS NOT NULL THEN 'USER'
      ELSE 'NONE'
    END                                          AS attribution_method,
    um.desk                                      AS runner_desk,
    um.user_name                                 AS runner_name
  FROM unified u
  LEFT JOIN main_dev.cost_reporting.job_product_mapping jm
    ON  u.workspace_id = jm.workspace_id
    AND u.job_id       = jm.job_id
  LEFT JOIN main_dev.cost_reporting.warehouse_product_mapping whm
    ON  u.compute_key = whm.warehouse_id
    AND whm.is_shared = false
    AND whm.data_product IS NOT NULL
  LEFT JOIN main_dev.cost_reporting.user_mapping um
    ON u.runner = um.user_id
)

SELECT
  a.usage_date,
  -- ---- three-level hierarchy
  COALESCE(dp.data_domain, 'UNALLOCATED')       AS data_domain,   -- level 1
  a.data_product,                                                 -- level 2
  COALESCE(dp.desk, a.runner_desk,
           'UNALLOCATED')                       AS desk,          -- level 3
  -- ---- attribution transparency
  a.attribution_method,
  a.tag_data_product                            AS raw_tag_data_product,
  -- ---- detail dimensions
  a.usage_category,
  a.is_serverless,                              -- serverless vs classic compute (NULL for per-query warehouse rows)
  a.workspace_id,
  a.compute_key                                 AS warehouse_id,
  a.job_id,
  a.job_name,
  a.runner,
  a.runner_name,
  a.statement_id,
  -- ---- measures
  a.dbus,
  a.cost
FROM attributed a
LEFT JOIN main_dev.cost_reporting.data_product_mapping dp
  ON  a.data_product = dp.data_product
  AND a.usage_date >= dp.valid_from
  AND a.usage_date <  COALESCE(dp.valid_to, DATE '9999-12-31');
```

Desk resolution logic, explicitly: the **product's desk wins** (`dp.desk`); if the product is `AD_HOC` or unknown to `data_product_mapping`, the **runner's desk** applies; if neither exists, `UNALLOCATED`.

### 6.2 `monthly_chargeback` — the report

```sql
CREATE OR REPLACE VIEW main_dev.cost_reporting.monthly_chargeback
COMMENT 'Monthly chargeback rollup: billing month x domain x product x desk x usage category. Direct source for the monthly report and desk invoices. UNALLOCATED rows are a real line item - they represent spend nobody has claimed yet.'
AS
SELECT
  DATE_TRUNC('month', usage_date)               AS billing_month,
  data_domain,                                  -- level 1
  data_product,                                 -- level 2
  desk,                                         -- level 3
  usage_category,                               -- SQL_WAREHOUSE / JOBS / DLT / ...
  COUNT(DISTINCT runner)                        AS distinct_runners,
  SUM(dbus)                                     AS total_dbus,
  SUM(cost)                                     AS total_cost
FROM main_dev.cost_reporting.cost_fact
GROUP BY 1, 2, 3, 4, 5;
```

### 6.3 `attribution_coverage` — tagging-quality KPI

```sql
CREATE OR REPLACE VIEW main_dev.cost_reporting.attribution_coverage
COMMENT 'Monthly share of cost by attribution method. Goal: TAG share rising, JOB_MAPPING and NONE shrinking. Publish alongside the chargeback report to drive tagging adoption.'
AS
WITH monthly AS (
  SELECT
    DATE_TRUNC('month', usage_date)               AS billing_month,
    attribution_method,
    SUM(cost)                                     AS cost
  FROM main_dev.cost_reporting.cost_fact
  GROUP BY 1, 2
)
SELECT
  billing_month,
  attribution_method,
  cost,
  cost / SUM(cost) OVER (PARTITION BY billing_month)
                                                AS pct_of_month
FROM monthly;
```

### 6.4 `desk_monthly_invoice` — per-desk statement

```sql
CREATE OR REPLACE VIEW main_dev.cost_reporting.desk_monthly_invoice
COMMENT 'One row per desk per month with cost broken down by domain and product - the shape desks receive as their internal invoice.'
AS
SELECT
  billing_month,
  desk,
  data_domain,
  data_product,
  SUM(total_dbus)                               AS total_dbus,
  SUM(total_cost)                               AS total_cost,
  SUM(SUM(total_cost)) OVER (PARTITION BY billing_month, desk)
                                                AS desk_month_total
FROM main_dev.cost_reporting.monthly_chargeback
GROUP BY 1, 2, 3, 4;
```

---

## 7. Operational & Validation Queries

Run §7.1–§7.4 before publishing each month. The management interface should expose them as one-click health checks (§10.6).

### 7.1 Reconciliation — the invariant

```sql
-- All three totals must match to the cent (per month).
WITH billing_truth AS (
  SELECT
    DATE_TRUNC('month', u.usage_date) AS billing_month,
    SUM(u.usage_quantity
        * COALESCE(lp.pricing.effective_list.default, lp.pricing.default)) AS billing_cost
  FROM system.billing.usage u
  LEFT JOIN system.billing.list_prices lp
    ON  u.sku_name = lp.sku_name
    AND u.cloud = lp.cloud
    AND lp.currency_code = 'USD'
    AND u.usage_start_time >= lp.price_start_time
    AND (lp.price_end_time IS NULL OR u.usage_start_time < lp.price_end_time)
  GROUP BY 1
),
fact_total AS (
  SELECT DATE_TRUNC('month', usage_date) AS billing_month,
         SUM(cost) AS fact_cost
  FROM main_dev.cost_reporting.cost_fact
  GROUP BY 1
),
report_total AS (
  SELECT billing_month, SUM(total_cost) AS report_cost
  FROM main_dev.cost_reporting.monthly_chargeback
  GROUP BY 1
)
SELECT
  b.billing_month,
  b.billing_cost,
  f.fact_cost,
  r.report_cost,
  b.billing_cost - f.fact_cost   AS fact_gap,     -- expect ~0
  b.billing_cost - r.report_cost AS report_gap    -- expect ~0
FROM billing_truth b
LEFT JOIN fact_total  f USING (billing_month)
LEFT JOIN report_total r USING (billing_month)
ORDER BY 1 DESC;
```

Note: `query_view` prices with `pricing.default` while `usage_view` and this check use `effective_list` fallback. If `effective_list` is populated for warehouse SKUs in your account, a small `fact_gap` on warehouse months signals the two should be aligned.

### 7.2 Unmapped work queue — feeds the interface's "fix it" screens

```sql
-- Top unattributed cost drivers, last 30 days: what to map or tag next.
SELECT
  usage_category,
  workspace_id,
  COALESCE(job_name, warehouse_id, runner, 'unknown') AS work_item,
  job_id,
  runner,
  SUM(cost)  AS unallocated_cost_30d
FROM main_dev.cost_reporting.cost_fact
WHERE usage_date >= current_date() - INTERVAL 30 DAYS
  AND attribution_method = 'NONE'
GROUP BY 1, 2, 3, 4, 5
ORDER BY unallocated_cost_30d DESC
LIMIT 50;
```

```sql
-- Runners spending money who are missing from user_mapping.
SELECT runner, SUM(cost) AS cost_30d, COUNT(*) AS rows_30d
FROM main_dev.cost_reporting.cost_fact
WHERE usage_date >= current_date() - INTERVAL 30 DAYS
  AND runner IS NOT NULL
  AND runner <> 'UNALLOCATED_IDLE'
  AND runner NOT IN (SELECT user_id FROM main_dev.cost_reporting.user_mapping)
GROUP BY 1 ORDER BY 2 DESC;
```

```sql
-- Workspaces billing money but missing from workspace_mapping.
SELECT DISTINCT u.workspace_id, SUM(u.usage_quantity) AS dbus_30d
FROM system.billing.usage u
WHERE u.usage_date >= current_date() - INTERVAL 30 DAYS
  AND u.workspace_id NOT IN
      (SELECT workspace_id FROM main_dev.cost_reporting.workspace_mapping)
GROUP BY 1 ORDER BY 2 DESC;
```

### 7.3 Rogue tags — tag values not in the product catalogue

```sql
-- Tags in use that don't match data_product_mapping: either typos to fix
-- at source, or products to register in the catalogue.
SELECT
  raw_tag_data_product,
  SUM(cost)  AS cost_30d,
  COUNT(*)   AS rows_30d
FROM main_dev.cost_reporting.cost_fact
WHERE usage_date >= current_date() - INTERVAL 30 DAYS
  AND raw_tag_data_product IS NOT NULL
  AND data_domain = 'UNALLOCATED'      -- tag present but not in catalogue
GROUP BY 1 ORDER BY 2 DESC;
```

### 7.4 Mapping-table integrity checks

```sql
-- (a) Overlapping validity periods per product - must return 0 rows.
SELECT a.data_product, a.valid_from, a.valid_to, b.valid_from AS conflicting_from
FROM main_dev.cost_reporting.data_product_mapping a
JOIN main_dev.cost_reporting.data_product_mapping b
  ON  a.data_product = b.data_product
  AND a.valid_from < b.valid_from
  AND COALESCE(a.valid_to, DATE '9999-12-31') > b.valid_from;
```

```sql
-- (b) Products referenced by job/warehouse mappings but absent from the
--     catalogue - must return 0 rows.
SELECT 'job_product_mapping' AS src, data_product FROM main_dev.cost_reporting.job_product_mapping
WHERE data_product NOT IN (SELECT data_product FROM main_dev.cost_reporting.data_product_mapping)
UNION ALL
SELECT 'warehouse_product_mapping', data_product FROM main_dev.cost_reporting.warehouse_product_mapping
WHERE data_product IS NOT NULL
  AND data_product NOT IN (SELECT data_product FROM main_dev.cost_reporting.data_product_mapping);
```

```sql
-- (c) Duplicate keys in bridge tables - must return 0 rows.
SELECT workspace_id, job_id, COUNT(*) c
FROM main_dev.cost_reporting.job_product_mapping
GROUP BY 1, 2 HAVING COUNT(*) > 1;
```

```sql
-- (d) Dedicated warehouses claiming a product must not be marked shared.
SELECT * FROM main_dev.cost_reporting.warehouse_product_mapping
WHERE (is_shared = false AND data_product IS NULL)
   OR (is_shared = true  AND data_product IS NOT NULL);
```

### 7.5 Month-over-month movement (report commentary)

```sql
WITH m AS (
  SELECT billing_month, desk, SUM(total_cost) AS cost
  FROM main_dev.cost_reporting.monthly_chargeback
  GROUP BY 1, 2
)
SELECT
  billing_month, desk, cost,
  cost - LAG(cost) OVER (PARTITION BY desk ORDER BY billing_month)      AS delta_abs,
  (cost / NULLIF(LAG(cost) OVER (PARTITION BY desk ORDER BY billing_month), 0)) - 1
                                                                        AS delta_pct
FROM m
ORDER BY billing_month DESC, cost DESC;
```

---

## 8. Tagging Strategy per Workload Type

The waterfall exists because each compute type has a different native tagging mechanism:

| Workload | Mechanism | How to enforce | Waterfall rule |
|---|---|---|---|
| Jobs (classic compute) | `data_product` custom tag on the job cluster — flows into `custom_tags` on billing rows automatically | **Cluster policies** making the tag mandatory: new jobs cannot launch untagged | 1 (TAG) |
| Serverless jobs / notebooks / DLT | **Serverless budget policies** — a policy carries tags stamped onto serverless billing records | One policy per data product (or per domain to start); grant teams permission only on their own policies | 1 (TAG) |
| DLT pipelines (classic) | Pipeline cluster custom tags | Cluster policy on pipeline clusters | 1 (TAG) |
| Model serving | Endpoint tags / budget policy (serverless) | Same as serverless | 1 (TAG) |
| Dedicated SQL warehouse | Row in `warehouse_product_mapping` (`is_shared = false`) — whole warehouse incl. idle cost goes to the product | Interface admin screen | 3 |
| Shared SQL warehouse | No product tag possible — per-query allocation, then runner's desk | — | 4 (USER → `AD_HOC`) |
| Untagged legacy jobs | Row in `job_product_mapping` as a **temporary bridge** | Work queue (§7.2) drives cleanup; target is emptying this table | 2 |
| Ad-hoc user queries / personal notebooks | None — attribution via `user_mapping` to the runner's desk, product = `AD_HOC` | Keep `user_mapping` complete (§7.2 second query) | 4 |

Tag vocabulary: tag **values must exactly match** `data_product_mapping.data_product` (case-sensitive). The rogue-tag report (§7.3) catches drift.

---

## 9. Refresh & Materialization

Views are logic; for daily use, materialize.

**Why:** profiling showed a bare `SELECT * FROM query_view LIMIT 100` scanning 23.9M query-history rows / 15 GB (~13 min task time), because a view cannot carry a rolling date predicate and `LIMIT` cannot push through the allocation join. Additionally, `system.query.history` retention (~90 days) is shorter than billing retention (~1 year): without materialization, per-query warehouse allocations older than ~90 days are unrecoverable.

**Pattern — daily incremental refresh into tables:**

```sql
-- One-time setup
CREATE TABLE IF NOT EXISTS main_dev.cost_reporting.query_fact_tbl
  CLUSTER BY (query_date, warehouse_id)
AS SELECT * FROM main_dev.cost_reporting.query_view WHERE 1 = 0;

CREATE TABLE IF NOT EXISTS main_dev.cost_reporting.usage_fact_tbl
  CLUSTER BY (usage_date, workspace_id)
AS SELECT * FROM main_dev.cost_reporting.usage_view WHERE 1 = 0;
```

```sql
-- Daily job (scheduled workflow, e.g. 06:00): reprocess a trailing
-- window to absorb late-arriving billing records.
DELETE FROM main_dev.cost_reporting.query_fact_tbl
WHERE query_date >= current_date() - INTERVAL 3 DAYS;

INSERT INTO main_dev.cost_reporting.query_fact_tbl
SELECT * FROM main_dev.cost_reporting.query_view
WHERE query_date >= current_date() - INTERVAL 3 DAYS;

DELETE FROM main_dev.cost_reporting.usage_fact_tbl
WHERE usage_date >= current_date() - INTERVAL 3 DAYS;

INSERT INTO main_dev.cost_reporting.usage_fact_tbl
SELECT * FROM main_dev.cost_reporting.usage_view
WHERE usage_date >= current_date() - INTERVAL 3 DAYS;
```

Then either point `cost_fact` at the `_tbl` versions, or (cleaner) keep `cost_fact` as-is for ad-hoc truth and create `cost_fact_tbl` the same way for dashboards. Uncomment the 90-day filters inside `query_view` once the fact table preserves history — they unlock row-group pruning on `system.query.history`.

**Monthly close:** after the reconciliation check (§7.1) passes for the closed month, snapshot it:

```sql
CREATE TABLE IF NOT EXISTS main_dev.cost_reporting.monthly_chargeback_published
  (published_at TIMESTAMP, snapshot_month DATE)
  -- plus all monthly_chargeback columns; simplest bootstrap:
AS SELECT current_timestamp() AS published_at,
          billing_month AS snapshot_month, *
   FROM main_dev.cost_reporting.monthly_chargeback WHERE 1 = 0;

-- Publication step (run once per closed month M):
INSERT INTO main_dev.cost_reporting.monthly_chargeback_published
SELECT current_timestamp(), billing_month, *
FROM main_dev.cost_reporting.monthly_chargeback
WHERE billing_month = DATE_TRUNC('month', add_months(current_date(), -1));
```

Desks are invoiced from the **published snapshot**, never from live views — mapping edits after publication cannot silently change an issued invoice.

---

## 10. Management Interface Specification

Functional spec for the app on top of this model (Databricks App, AI/BI dashboard + small write app, or internal web app via SQL endpoint). The interface **writes only to the four mapping tables**; every report is a read of the views above.

### 10.1 Roles

| Role | Can do |
|---|---|
| **Viewer** (desk heads, finance) | All dashboards, drill-downs, published invoices |
| **Steward** (data platform team) | Viewer + CRUD on all mapping tables + run health checks |
| **Publisher** (cost reporting owner) | Steward + monthly publication step (§9) |

Implement with Unity Catalog grants: `SELECT` on the schema for Viewer; `MODIFY` on the four mapping tables for Steward; `MODIFY` on `monthly_chargeback_published` for Publisher only.

### 10.2 Page: Chargeback Dashboard (landing)

- Month selector (default: last closed month), toggle live vs published.
- KPI tiles: total cost, MoM delta (§7.5), `TAG` coverage % (§6.3), `UNALLOCATED` cost.
- Level-1 view: cost by `data_domain` (bar), trend by month (line).
- Backing queries: `monthly_chargeback`, `attribution_coverage`.

### 10.3 Page: Drill-down (Domain → Product → Desk → Detail)

Three linked levels, all filtering `monthly_chargeback` / `cost_fact`:

```sql
-- Level 1 -> 2: products within a domain
SELECT data_product, desk, SUM(total_cost) cost, SUM(total_dbus) dbus
FROM main_dev.cost_reporting.monthly_chargeback
WHERE billing_month = :month AND data_domain = :domain
GROUP BY 1, 2 ORDER BY cost DESC;

-- Level 2 -> detail: what makes up a product's cost
SELECT usage_category, is_serverless, job_name, warehouse_id, runner_name,
       attribution_method, SUM(dbus) dbus, SUM(cost) cost
FROM main_dev.cost_reporting.cost_fact
WHERE usage_date >= :month AND usage_date < add_months(:month, 1)
  AND data_product = :product
GROUP BY 1, 2, 3, 4, 5, 6 ORDER BY cost DESC LIMIT 200;

-- Desk drill-down: how a desk's monthly number was constructed
-- (usage category x serverless/classic x job/warehouse x runner x method)
SELECT usage_category, is_serverless, data_product, job_name, warehouse_id,
       runner_name, attribution_method, SUM(dbus) dbus, SUM(cost) cost
FROM main_dev.cost_reporting.cost_fact
WHERE usage_date >= :month AND usage_date < add_months(:month, 1)
  AND desk = :desk
GROUP BY 1, 2, 3, 4, 5, 6, 7 ORDER BY cost DESC LIMIT 500;

-- Desk view (level 3): the invoice shape
SELECT * FROM main_dev.cost_reporting.desk_monthly_invoice
WHERE billing_month = :month AND desk = :desk;
```

Per-query drill for warehouse rows: join `cost_fact.statement_id` back to `system.query.history` to fetch `statement_text` on demand (kept out of the views deliberately — §5.1).

### 10.4 Page: Work Queue (unallocated & unmapped)

The operational heart — turns §7.2/§7.3 into actionable rows with inline actions:

| Queue | Source query | Inline action |
|---|---|---|
| Untagged jobs by cost | §7.2 first query, `usage_category <> 'SQL_WAREHOUSE'` | "Map to product" → INSERT into `job_product_mapping` (with `mapped_by`, `mapped_at`) — and a reminder that the durable fix is tagging the job |
| Unknown runners | §7.2 second query | "Add user" → INSERT into `user_mapping` |
| Unknown workspaces | §7.2 third query | "Add workspace" → INSERT into `workspace_mapping` |
| Rogue tags | §7.3 | "Register product" → INSERT into `data_product_mapping`, or flag for tag fix at source |
| Unassigned dedicated warehouses | warehouses in `cost_fact` with method `USER`/`NONE` and high idle share | "Assign warehouse" → UPSERT `warehouse_product_mapping` |

### 10.5 Page: Product Catalogue Admin

CRUD on `data_product_mapping` with the validity-versioning rules enforced in the write path:

- **Create product:** validate key format (lowercase, no spaces), uniqueness among active rows, desk non-empty. `valid_from` defaults to first of next month.
- **Move product to another desk/domain:** transactionally close the current row (`valid_to = cutover - 1 day` semantics; with the exclusive join in `cost_fact`, set `valid_to = cutover_date`) and insert the new row (`valid_from = cutover_date`). Never `UPDATE desk` in place.
- **Retire product:** set `valid_to`; subsequent usage falls to the waterfall's later rules and shows up in the work queue.
- Every write runs §7.4(a)+(b) as a post-condition; reject on violation.

### 10.6 Page: Health & Reconciliation

One-click execution of §7.1 and §7.4 with green/red status per month; publication button (Publisher role) enabled only when the closed month's `report_gap` is within tolerance (e.g. |gap| < $1) and all integrity checks pass.

### 10.7 Write-path rules (any implementation)

1. All writes audited: `mapped_by` / `mapped_at` columns (extend `user_mapping` / `workspace_mapping` similarly if desired) or Delta table history (`DESCRIBE HISTORY`) as the audit trail.
2. Referential validation before commit (§7.4(b)): a bridge row may only reference an existing catalogue product.
3. No deletes from `data_product_mapping` — close validity instead.
4. Edits never trigger recomputation of published months; they affect live views only.

---

## 11. Rollout Plan & Governance

**Phase 1 — Foundations (week 1–2)**
1. Create the four mapping tables (§4); confirm `user_mapping` / `workspace_mapping` completeness with §7.2.
2. Deploy `query_view`, `usage_view` (§5) and run §7.1 — the invariant must hold before anything is built on top. Verify billing currency against an actual invoice (USD literal in both views).
3. Populate `data_product_mapping`: agree the domain → product → desk catalogue with desk heads. *This is the political work; start it first.*

**Phase 2 — Attribution (week 2–4)**
4. Backfill `job_product_mapping` for the top ~50 jobs by 30-day cost (§7.2).
5. Classify warehouses in `warehouse_product_mapping` (dedicated vs shared).
6. Deploy `cost_fact`, `monthly_chargeback`, `attribution_coverage`, `desk_monthly_invoice` (§6).

**Phase 3 — Industrialize (month 2)**
7. Materialization job + monthly publication snapshot (§9).
8. Cluster policies (mandatory `data_product` tag) and serverless budget policies per product/domain (§8).
9. Management interface, work-queue first (§10.4) — it drives everything else.

**Phase 4 — Steady state**
- Monthly cycle: refresh → §7.1/§7.4 checks → publish snapshot → distribute desk invoices → review `attribution_coverage` (target: TAG% ↑, JOB_MAPPING and NONE ↓).
- Quarterly: prune `job_product_mapping` rows whose jobs are now tagged at source.

**Known limitations (state them in every report footer):**
- Databricks DBU cost only; Azure VM/network/storage for classic compute billed separately by Microsoft is out of scope.
- List-price basis (with `effective_list` where populated); invoice-level discounts not reflected.
- Warehouse queries attributed to their start hour; multi-hour statements not split.
- Per-query warehouse detail limited by ~90-day `system.query.history` retention until materialization has accumulated history.

---

*End of document.*
