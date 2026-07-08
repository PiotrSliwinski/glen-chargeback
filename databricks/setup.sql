-- =====================================================================
-- Databricks chargeback — full object setup
--
-- Recreates every object defined in databricks_chargeback_methodology.md,
-- in dependency order. Idempotent:
--   * tables    : CREATE TABLE IF NOT EXISTS (existing data untouched)
--   * views     : CREATE OR REPLACE VIEW     (logic refreshed in place)
--
-- Target schema: main_dev.cost_reporting. To deploy elsewhere, either
-- edit the names below or run via chargeback-app/scripts/setup-databricks.mjs,
-- which substitutes DBX_SCHEMA automatically.
--
-- Runnable as-is in the Databricks SQL editor (run all), or statement by
-- statement through the setup script.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS main_dev.cost_reporting;

-- =====================================================================
-- §4 Mapping tables — the write surface of the management interface
-- =====================================================================

-- §4.1 Runner identity -> display name + home desk
CREATE TABLE IF NOT EXISTS main_dev.cost_reporting.user_mapping (
  user_id     STRING NOT NULL,   -- email or service principal ID, exactly as in system tables
  user_name   STRING NOT NULL,   -- display name
  desk        STRING NOT NULL    -- runner's home desk (used for AD_HOC attribution)
)
COMMENT 'Runner identity -> display name + home desk. user_id must match executed_by (query.history) and identity_metadata.run_as (billing.usage) exactly, including service principal IDs.';

-- §4.2 Workspace ID -> friendly name
CREATE TABLE IF NOT EXISTS main_dev.cost_reporting.workspace_mapping (
  workspace_id     STRING NOT NULL,
  workspace_name   STRING NOT NULL
)
COMMENT 'Workspace ID -> friendly name. Workspaces missing here surface in reports as UNMAPPED: <id> - they are never dropped.';

-- §4.3 The hierarchy backbone: product -> domain + desk, validity-versioned
CREATE TABLE IF NOT EXISTS main_dev.cost_reporting.data_product_mapping (
  data_product      STRING NOT NULL,   -- canonical key, matches tag values
  data_domain       STRING NOT NULL,   -- level 1 rollup
  desk              STRING NOT NULL,   -- beneficiary (level 3); several rows per product = multi-desk split
  product_owner     STRING,            -- accountable person
  cost_split_pct    DOUBLE DEFAULT 1.0,-- this desk's share of the product's cost; shares per validity window must sum to 1.0
  valid_from        DATE   NOT NULL,
  valid_to          DATE               -- NULL = current; keeps history for restated months
)
COMMENT 'One row per data product PER DESK (per validity period). A product billed to one desk has a single row with cost_split_pct = 1.0; a product shared between desks has one row per desk whose cost_split_pct values sum to 1.0 within the same validity window. Domain and desk are ALWAYS derived from here, never from tags directly.'
TBLPROPERTIES ('delta.feature.allowColumnDefaults' = 'supported');

-- §4.4 Bridge for untagged jobs (waterfall rule 2)
CREATE TABLE IF NOT EXISTS main_dev.cost_reporting.job_product_mapping (
  workspace_id   STRING NOT NULL,
  job_id         STRING NOT NULL,     -- composite key with workspace_id (job_id NOT globally unique)
  data_product   STRING NOT NULL,
  note           STRING,              -- optional: why mapped manually
  mapped_by      STRING,              -- audit: who created the mapping
  mapped_at      TIMESTAMP            -- audit: when
)
COMMENT 'Manual bridge: (workspace, job) -> data product, for jobs not yet tagged at source. Rule 2 of the attribution waterfall. Target state is to empty this table by tagging jobs directly.';

-- §4.5 Tag rules (waterfall rule 3 — Databricks AND Azure)
CREATE TABLE IF NOT EXISTS main_dev.cost_reporting.tag_product_mapping (
  tag_key        STRING NOT NULL,     -- tag key, exactly as in the source (custom_tags / Azure resource tags)
  tag_value      STRING NOT NULL,     -- composite key with tag_key + scope
  data_product   STRING NOT NULL,
  note           STRING,              -- optional: why this rule exists
  mapped_by      STRING,              -- audit: who created the rule
  mapped_at      TIMESTAMP,           -- audit: when
  scope          STRING NOT NULL      -- 'databricks' | 'azure' | 'both': which tag namespace(s) the rule matches
)
COMMENT 'Unified tag rule: any tag key=value on a usage record -> data product. Rule 3 of BOTH attribution waterfalls - cost_fact matches rules with scope databricks/both against Databricks custom_tags, azure_cost_fact matches rules with scope azure/both against Azure resource tags. Catches workloads tagged with team/project/etc. tags but no data_product tag. scope both is for organisation-wide tags that mean the same thing in either namespace; keys like team that differ per namespace get one scoped rule each. If several rules match one record, the alphabetically first key=value wins (deterministic); the health page flags rules whose scopes overlap on the same key=value.';

-- §4.6 Dedicated warehouses (waterfall rule 4)
CREATE TABLE IF NOT EXISTS main_dev.cost_reporting.warehouse_product_mapping (
  warehouse_id   STRING NOT NULL,
  data_product   STRING,              -- NULL = shared warehouse, allocate per user
  is_shared      BOOLEAN
)
COMMENT 'is_shared = false + data_product assigns the ENTIRE warehouse (incl. idle hours) to that product - except spend an earlier waterfall rule claims first (a data_product tag / tag rule on the record, or, on serverless warehouses, interactive queries by mapped users, which bill the runner as AD_HOC). Shared warehouses: is_shared = true or no row at all. One row per warehouse_id - duplicates resolve deterministically (MIN) and are flagged on the health page.';

-- §4.7 Runner rules (waterfall rule 5)
CREATE TABLE IF NOT EXISTS main_dev.cost_reporting.runner_product_mapping (
  user_id        STRING NOT NULL,     -- email or service principal ID, exactly as in identity_metadata.run_as
  data_product   STRING NOT NULL,
  note           STRING,              -- optional: why this rule exists
  mapped_by      STRING,              -- audit: who created the rule
  mapped_at      TIMESTAMP            -- audit: when
)
COMMENT 'Runner rule: EVERYTHING this identity runs (jobs, DLT, serverless) -> data product. Rule 5 of the attribution waterfall. The explicit opt-in replacement for defaulting job cost to the runner: platform service principals whose output serves one product belong here. One row per user_id - duplicates are flagged on the health page.';

-- §4.8 Dedicated model-serving endpoints (waterfall rule 4b)
CREATE TABLE IF NOT EXISTS main_dev.cost_reporting.endpoint_product_mapping (
  workspace_id   STRING NOT NULL,
  endpoint_name  STRING NOT NULL,     -- composite key with workspace_id, exactly as in usage_metadata.endpoint_name
  data_product   STRING NOT NULL,
  note           STRING,              -- optional: why mapped manually
  mapped_by      STRING,              -- audit: who created the mapping
  mapped_at      TIMESTAMP            -- audit: when
)
COMMENT 'Dedicated AI/model-serving endpoint -> data product. Rule 4b of the attribution waterfall (the serving analogue of a dedicated warehouse). NOTE: AI serving is USER-FIRST (rule 0) - spend run by a mapped user bills that user''s desk; this bridge (like endpoint tags) catches the remainder: NULL or unmapped run_as, realtime and ai_query batch alike. endpoint_name must match usage_metadata.endpoint_name exactly; names are only unique per workspace. Prefer tagging the endpoint at source with data_product - this bridge is for endpoints not yet tagged.';

-- §4.8b Dedicated DLT pipelines (waterfall rule 4c)
CREATE TABLE IF NOT EXISTS main_dev.cost_reporting.pipeline_product_mapping (
  workspace_id   STRING NOT NULL,
  pipeline_id    STRING NOT NULL,     -- composite key with workspace_id, exactly as in usage_metadata.dlt_pipeline_id
  data_product   STRING NOT NULL,
  note           STRING,              -- optional: why mapped manually
  mapped_by      STRING,              -- audit: who created the mapping
  mapped_at      TIMESTAMP            -- audit: when
)
COMMENT 'Dedicated DLT pipeline -> data product. Rule 4c of the attribution waterfall (the pipeline analogue of a dedicated warehouse): ALL spend of the pipeline - compute and maintenance alike - bills to that product. pipeline_id must match usage_metadata.dlt_pipeline_id exactly; ids are scoped per workspace, hence the composite key. Prefer tagging the pipeline at source with data_product (rule 1) - this bridge is for pipelines not yet tagged.';

-- §4.9 DBU reservation-plan discounts (pricing reference data, not attribution)
CREATE TABLE IF NOT EXISTS main_dev.cost_reporting.dbu_discount_plan (
  valid_from     DATE   NOT NULL,   -- first day the plan covers (inclusive)
  valid_to       DATE   NOT NULL,   -- last day the plan covers (inclusive)
  discount_pct   DOUBLE NOT NULL,   -- share of list price waived: 0.27 = 27% off
  note           STRING,            -- optional: contract / PO reference
  mapped_by      STRING,            -- audit: who recorded the plan
  mapped_at      TIMESTAMP          -- audit: when
)
COMMENT 'Purchased DBU reservation plans: within [valid_from, valid_to] (both inclusive) Databricks DBU spend is billed at list price x (1 - discount_pct). Applied at pricing time in query_view and usage_view to usage_unit = DBU only - never to Azure cost - so cost_fact, monthly_chargeback and invoices all inherit the discounted rate. Windows must not overlap: the views resolve overlaps deterministically (deepest discount wins, cost never fans out) and the health page flags them.';

-- =====================================================================
-- §4A Azure attribution rules — the write surface of the Azure screen
--
-- Azure spend (main_dev.azure_cleaned.amortized_costs) is attributed to
-- the SAME product catalogue (§4.3) as Databricks spend — domain, desk
-- and multi-desk % splits are always derived from data_product_mapping.
-- Only the matching mechanisms differ: Azure has no jobs, warehouses or
-- runners, so the rules key on resource, tag, resource group and
-- subscription instead. Unmatched Azure cost stays UNALLOCATED in
-- azure_cost_fact and NEVER enters the Databricks chargeback report —
-- attribution is an explicit allowlist ("only certain Azure costs").
-- =====================================================================

-- §4A.1 Resource bridge (Azure waterfall rule 2)
CREATE TABLE IF NOT EXISTS main_dev.cost_reporting.azure_resource_product_mapping (
  resource_id    STRING NOT NULL,     -- full ARM resource ID, stored lowercase
  data_product   STRING NOT NULL,
  note           STRING,              -- optional: why mapped manually
  mapped_by      STRING,              -- audit: who created the mapping
  mapped_at      TIMESTAMP            -- audit: when
)
COMMENT 'Manual bridge: one Azure resource -> data product, for resources not yet tagged at source. Rule 2 of the Azure attribution waterfall. resource_id is the full ARM ID, lowercase. Target state is to empty this table by tagging resources directly.';

-- §4A.2 Azure tag rules (Azure waterfall rule 3)
-- Unified into tag_product_mapping (§4.5): rules with scope 'azure' or
-- 'both' drive rule 3 of the Azure waterfall. The former separate
-- azure_tag_product_mapping table is retired — see the migration note in §9.

-- §4A.3 Resource-group rules (Azure waterfall rule 4)
CREATE TABLE IF NOT EXISTS main_dev.cost_reporting.azure_rg_product_mapping (
  subscription_id  STRING NOT NULL,   -- RG names are only unique per subscription
  resource_group   STRING NOT NULL,   -- stored lowercase
  data_product     STRING NOT NULL,
  note             STRING,
  mapped_by        STRING,
  mapped_at        TIMESTAMP
)
COMMENT 'Resource-group rule: every resource in (subscription, resource group) -> data product. Rule 4 of the Azure waterfall — the analogue of a dedicated warehouse: the whole RG, present and future resources included, belongs to one product.';

-- §4A.4 Subscription rules (Azure waterfall rule 5)
CREATE TABLE IF NOT EXISTS main_dev.cost_reporting.azure_subscription_product_mapping (
  subscription_id  STRING NOT NULL,   -- stored lowercase
  data_product     STRING NOT NULL,
  note             STRING,
  mapped_by        STRING,
  mapped_at        TIMESTAMP
)
COMMENT 'Subscription rule: everything in a subscription -> data product. Rule 5 of the Azure waterfall, the coarsest opt-in — for subscriptions dedicated to a single product. One row per subscription_id.';

-- =====================================================================
-- §5 Core allocation views (layer 1)
-- =====================================================================

-- §5.1 query_view — per-query SQL warehouse allocation
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
--   * Price = effective_list.default preferred, falling back to default -
--     the SAME basis as usage_view, so warehouse and non-warehouse spend
--     are always priced alike. The price join is a LEFT JOIN, also like
--     usage_view: usage whose SKU has no matching USD price row keeps its
--     DBUs and surfaces with NULL cost (a reconciliation gap on the health
--     page) instead of silently disappearing.
--   * Cost = price less any DBU reservation-plan discount effective on
--     the usage date (dbu_discount_plan, §4.9); classic warehouses also
--     exclude the Azure VM/infra cost billed separately by Microsoft.
--   * Warehouse custom tags (sku_name, is_serverless, tag_data_product,
--     tags_json) are carried per warehouse-hour so warehouse spend can
--     attribute via TAG / TAG_RULE in cost_fact, exactly like all other
--     spend. A warehouse-hour whose billing rows carry different tag sets
--     or SKUs yields one row per set - each distributed independently
--     across the hour's queries, so totals still reconcile.
--   * Non-DBU usage that carries a warehouse_id is NOT lost: query_view
--     allocates only DBU-metered warehouse spend, everything else flows
--     through usage_view (its filter is the exact complement).

CREATE OR REPLACE VIEW main_dev.cost_reporting.query_view
COMMENT 'Per-query DBU and cost allocation for SQL warehouses. Hourly warehouse DBUs (system.billing.usage, priced at the time-effective USD price - effective_list preferred, same basis as usage_view - less any reservation-plan discount from dbu_discount_plan) distributed across finished queries proportionally to task duration. Idle/unmatched hours appear as UNALLOCATED_IDLE so totals reconcile with billing; usage without a matching price row keeps its DBUs with NULL cost rather than being dropped. Carries sku_name, is_serverless and the warehouse custom tags (tag_data_product, key-sorted tags_json) so warehouse spend participates in the TAG / TAG_RULE waterfall rules in cost_fact. statement_text excluded for performance - join to system.query.history on statement_id.'
AS
WITH usage_data AS (
  -- Hourly DBU consumption and cost per warehouse,
  -- priced at the rate effective at the time of usage.
  -- Grouped by SKU + tag set too: a warehouse-hour with several tag sets
  -- or SKUs yields several rows, each fully distributed across the hour's
  -- queries below - the sum over rows still reconciles with billing.
  SELECT
    u.usage_date,
    DATE_TRUNC('hour', u.usage_start_time)      AS usage_hour,
    u.workspace_id,
    u.usage_metadata.warehouse_id               AS warehouse_id,
    u.sku_name,
    u.product_features.is_serverless            AS is_serverless,
    u.custom_tags.data_product                  AS tag_data_product,
    -- all custom tags, key-sorted so identical tag sets group together
    -- (same expression as usage_view.tags_json - tag rules match both)
    to_json(map_from_entries(array_sort(map_entries(u.custom_tags)))) AS tags_json,
    SUM(u.usage_quantity)                       AS total_dbu_per_hour,
    SUM(u.usage_quantity
        * COALESCE(p.pricing.effective_list.default,
                   p.pricing.default))          AS list_cost_per_hour
  FROM system.billing.usage u
  -- LEFT + effective_list-preferred, exactly like usage_view: unpriced SKUs
  -- keep their DBUs (cost NULL) and both views price on the same basis
  LEFT JOIN system.billing.list_prices p
    ON  u.sku_name = p.sku_name
    AND u.cloud = p.cloud
    AND p.currency_code = 'USD'                 -- adjust if billed in EUR etc.
    AND u.usage_start_time >= p.price_start_time
    AND (p.price_end_time IS NULL OR u.usage_start_time < p.price_end_time)
  WHERE u.usage_metadata.warehouse_id IS NOT NULL
    AND u.usage_unit = 'DBU'
    -- AND u.usage_date >= current_date() - INTERVAL 90 DAYS   -- optional: align with query.history retention
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
),

usage_data_discounted AS (
  -- DBU reservation-plan discount effective on the usage date (§4.9).
  -- Warehouse usage is always DBU-metered, so every row is eligible.
  -- Join + re-aggregate (MAX) instead of a plain join: overlapping discount
  -- windows can then never fan cost out - the deepest discount wins and the
  -- health page flags the overlap.
  SELECT
    ud.usage_date,
    ud.usage_hour,
    ud.workspace_id,
    ud.warehouse_id,
    ud.sku_name,
    ud.is_serverless,
    ud.tag_data_product,
    ud.tags_json,
    ud.total_dbu_per_hour,
    ud.list_cost_per_hour * (1 - COALESCE(MAX(d.discount_pct), 0)) AS cost_per_hour
  FROM usage_data ud
  LEFT JOIN main_dev.cost_reporting.dbu_discount_plan d
    ON  ud.usage_date >= d.valid_from
    AND ud.usage_date <= d.valid_to
  GROUP BY ud.usage_date, ud.usage_hour, ud.workspace_id, ud.warehouse_id,
           ud.sku_name, ud.is_serverless, ud.tag_data_product, ud.tags_json,
           ud.total_dbu_per_hour, ud.list_cost_per_hour
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
  u.sku_name,
  u.is_serverless,
  u.tag_data_product,
  u.tags_json,
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
FROM usage_data_discounted u
LEFT JOIN queries_with_weights q
  ON  q.query_hour   = u.usage_hour
  AND q.warehouse_id = u.warehouse_id
LEFT JOIN main_dev.cost_reporting.user_mapping um
  ON q.user_id = um.user_id;

-- §5.2 usage_view — everything except SQL warehouses
--
-- Methodology:
--   * One row per day / runner / workspace / job / SKU / tag combination,
--     taken from system.billing.usage.
--   * Attribution uses identity_metadata.run_as - the user or service
--     principal the workload executed as.
--   * Cost = usage_quantity x price effective AT THE TIME the usage
--     started (effective_list.default preferred, falls back to default),
--     less any DBU reservation-plan discount effective on the usage date
--     (dbu_discount_plan, §4.9) - DBU-metered rows only.
--   * Job names from usage_metadata.job_name, else latest name in
--     system.workflow.jobs (deduplicated per workspace + job).
--   * AI dimensions: endpoint_name (usage_metadata.endpoint_name, model
--     serving / vector search endpoints) and serving_type
--     (product_features.model_serving.offering_type, e.g. BATCH_INFERENCE
--     for ai_query batch jobs) - NULL for non-AI rows. NOTE: billing for
--     model serving lands with a 1-2h delay (no official SLA); the current
--     day's AI spend is always incomplete.
--   * tags_json carries ALL custom tags as a key-sorted JSON object -
--     the input for tag rules (waterfall rule 3) and the coverage UI.
--   * Compute detail dimensions from usage_metadata: cluster_id
--     (all-purpose/job compute), pipeline_id (DLT - also drives waterfall
--     rule 4c), app_name (Databricks Apps), warehouse_id (only on the
--     rare non-DBU warehouse-attached rows admitted by the scope filter).
--   * total_quantity is in usage_unit terms (DBU, GB, ...) - it is NOT
--     always DBUs; cost_fact derives its DBU-only measure from the unit.
--
-- Scope / reconciliation:
--   * DBU-metered SQL warehouse usage EXCLUDED (allocated per-query in
--     query_view); the filter is the exact complement of query_view's, so
--     together the two views cover EVERY system.billing.usage row exactly
--     once - including any non-DBU usage that carries a warehouse_id,
--     which would otherwise fall between the two views.
--   * Unmapped workspaces surface as 'UNMAPPED: <id>'; unmapped runners
--     keep their raw run_as identity.

CREATE OR REPLACE VIEW main_dev.cost_reporting.usage_view
COMMENT 'Daily chargeback of all spend not allocated per-query in query_view (jobs, DLT, serverless, model serving, etc.) from system.billing.usage, attributed via identity_metadata.run_as and priced at the time-effective USD price (effective_list preferred) less any reservation-plan discount from dbu_discount_plan (DBU-metered rows only). Scope is the exact complement of query_view (NOT warehouse+DBU), so the two views cover every billing row exactly once. total_quantity is in usage_unit terms (DBU, GB, ...). Exposes job_id, cluster_id, pipeline_id, app_name, endpoint_name + serving_type, tag_data_product and tags_json (all custom tags, key-sorted JSON) for the attribution waterfall in cost_fact.'
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
),

base AS (
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
  -- compute detail dimensions (NULL where not applicable)
  u.usage_metadata.cluster_id                                 AS cluster_id,
  u.usage_metadata.dlt_pipeline_id                            AS pipeline_id,
  u.usage_metadata.app_name                                   AS app_name,
  -- only non-NULL on non-DBU warehouse-attached rows (see scope filter);
  -- lets cost_fact apply the dedicated-warehouse rule to them too
  u.usage_metadata.warehouse_id                               AS warehouse_id,
  -- AI/model-serving dimensions (NULL outside MODEL_SERVING / VECTOR_SEARCH)
  u.usage_metadata.endpoint_name                              AS endpoint_name,
  u.product_features.model_serving.offering_type              AS serving_type,
  u.custom_tags.data_product                                  AS tag_data_product,
  u.custom_tags.provider                                      AS provider,
  u.custom_tags.domain                                        AS domain,
  u.custom_tags.desk                                          AS tag_desk,
  u.custom_tags.Environment                                   AS environment,
  -- all custom tags, key-sorted so identical tag sets group together
  to_json(map_from_entries(array_sort(map_entries(u.custom_tags)))) AS tags_json,
  -- quantity in usage_unit terms (DBU, GB, ...) - NOT always DBUs
  SUM(u.usage_quantity)                                       AS total_quantity,
  SUM(u.usage_quantity
      * COALESCE(lp.pricing.effective_list.default,
                 lp.pricing.default))                         AS total_list_cost
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

-- DBU-metered SQL warehouse spend excluded: allocated per-query in
-- query_view. The predicate is the exact complement of query_view's
-- (warehouse_id IS NOT NULL AND usage_unit = 'DBU') so no billing row can
-- fall between the two views - non-DBU rows that carry a warehouse_id
-- (e.g. a future networking/storage SKU attached to a warehouse) land
-- here instead of vanishing. Loosening this further would double count.
WHERE NOT (u.usage_metadata.warehouse_id IS NOT NULL
           AND u.usage_unit = 'DBU')

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
  cluster_id,
  pipeline_id,
  app_name,
  u.usage_metadata.warehouse_id,
  endpoint_name,
  serving_type,
  u.custom_tags.data_product,
  u.custom_tags.provider,
  u.custom_tags.domain,
  u.custom_tags.desk,
  u.custom_tags.Environment,
  tags_json
)

-- DBU reservation-plan discount effective on the usage date (§4.9), applied
-- to DBU-metered rows only. Join + re-aggregate (MAX) instead of a plain
-- join: overlapping discount windows can then never fan cost out - the
-- deepest discount wins and the health page flags the overlap.
SELECT
  b.usage_date,
  b.user_name,
  b.desk,
  b.workspace_name,
  b.job_runner,
  b.job_id,
  b.job_name,
  b.workspace_id,
  b.sku_name,
  b.billing_origin_product,
  b.is_serverless,
  b.usage_unit,
  b.cluster_id,
  b.pipeline_id,
  b.app_name,
  b.warehouse_id,
  b.endpoint_name,
  b.serving_type,
  b.tag_data_product,
  b.provider,
  b.domain,
  b.tag_desk,
  b.environment,
  b.tags_json,
  b.total_quantity,
  b.total_list_cost
    * (1 - CASE WHEN b.usage_unit = 'DBU'
                THEN COALESCE(MAX(d.discount_pct), 0)
                ELSE 0 END)                                   AS total_cost
FROM base b
LEFT JOIN main_dev.cost_reporting.dbu_discount_plan d
  ON  b.usage_date >= d.valid_from
  AND b.usage_date <= d.valid_to
GROUP BY b.usage_date, b.user_name, b.desk, b.workspace_name, b.job_runner,
         b.job_id, b.job_name, b.workspace_id, b.sku_name,
         b.billing_origin_product, b.is_serverless, b.usage_unit,
         b.cluster_id, b.pipeline_id, b.app_name, b.warehouse_id,
         b.endpoint_name, b.serving_type,
         b.tag_data_product, b.provider, b.domain, b.tag_desk, b.environment,
         b.tags_json, b.total_quantity, b.total_list_cost;

-- §5.3 query_view_daily_summary — convenience rollup
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

-- =====================================================================
-- §6 Semantic layer views (layer 2 + 3)
-- =====================================================================

-- §6.1 cost_fact — unified fact with attribution waterfall
--
--   * UNION of query_view (SQL warehouse, per-query) and usage_view
--     (all other spend, per runner/job/day).
--   * Attribution waterfall:
--       0 USER-FIRST         interactive spend bills the person, not a tag:
--                            serverless SQL-warehouse queries and AI serving
--                            (MODEL_SERVING, VECTOR_SEARCH,
--                            FOUNDATION_MODEL_TRAINING, AGENT_EVALUATION —
--                            keep in sync with dal/ai AI_CATEGORIES) whose
--                            run_as is a mapped user go to that user's desk
--                            as AD_HOC BEFORE any tag. People consume
--                            interactive capacity; products consume
--                            automated capacity. Falls through to the tag
--                            chain when run_as is NULL, unmapped
--                            (system/batch emissions, idle hours) or the
--                            row carries a job_id — job-launched spend,
--                            ai_query batch included, is a job and follows
--                            the tag rules below.
--       1 TAG                custom_tags.data_product on the record
--       2 JOB_MAPPING        (workspace_id, job_id) in job_product_mapping
--       3 TAG_RULE           any custom tag matches a tag_product_mapping
--                            rule with scope databricks/both
--       4 WAREHOUSE_MAPPING  dedicated warehouse (is_shared = false)
--       4b ENDPOINT_MAPPING  dedicated AI/serving endpoint in
--                            endpoint_product_mapping (the serving analogue
--                            of a dedicated warehouse; mutually exclusive
--                            with rule 4 - a row has a warehouse OR an
--                            endpoint, never both)
--       4c PIPELINE_MAPPING  dedicated DLT pipeline in
--                            pipeline_product_mapping (the pipeline analogue
--                            of a dedicated warehouse)
--       5 RUNNER_RULE        runner in runner_product_mapping
--       6 USER               remaining ad-hoc spend (job_id IS NULL, e.g.
--                            classic-warehouse queries): known runner ->
--                            AD_HOC, desk = runner's desk. Job cost NEVER
--                            defaults to the runner - jobs are run by
--                            platform identities but consumed by desks, so
--                            unresolved job spend falls to NONE and
--                            surfaces in the work queue.
--       7 NONE               UNALLOCATED
--   * data_domain and desk derived from data_product_mapping with a
--     validity-period join on usage_date - historical months never
--     restate when a product moves desk.
--   * Multi-desk splits: a product with several mapping rows (one per
--     desk, cost_split_pct summing to 1.0) fans each usage row out into
--     one row per desk, with quantities/cost scaled by that desk's share.
--     Products without a mapping row (AD_HOC, UNALLOCATED) keep a
--     factor of 1.0.
--   * Measures: usage_quantity is in usage_unit terms (DBU, GB, ...);
--     dbus is the DBU-only measure (0 for non-DBU rows) so summing it
--     never mixes units. cost is always USD.
--
-- Invariant: SUM(cost) over cost_fact = SUM over billing (methodology §7.1)
-- - holds as long as each product's splits sum to 1.0, which the health
-- page checks (§7.4).

CREATE OR REPLACE VIEW main_dev.cost_reporting.cost_fact
COMMENT 'Unified cost fact: per-query warehouse allocations + all other usage, with data_product attribution waterfall (USER-FIRST for interactive spend > TAG > JOB_MAPPING > TAG_RULE > WAREHOUSE_MAPPING > ENDPOINT_MAPPING > PIPELINE_MAPPING > RUNNER_RULE > USER > NONE). Interactive spend - serverless SQL-warehouse queries and AI serving (MODEL_SERVING/VECTOR_SEARCH/FOUNDATION_MODEL_TRAINING/AGENT_EVALUATION), never job-run - bills the mapped runner as AD_HOC BEFORE any tag; tags catch the remainder (NULL/unmapped run_as, job-launched ai_query). Jobs and all other automated spend stay tag-first, and job cost never defaults to the runner. domain/desk derive from validity-versioned data_product_mapping. Warehouse rows carry their custom tags, so TAG/TAG_RULE apply to warehouse spend too. Products split between desks (several mapping rows, cost_split_pct summing to 1.0) fan out into one row per desk with measures scaled by the share. Exposes sku_name, usage_unit + usage_quantity (dbus = DBU-metered quantity only, 0 otherwise), cluster_id, pipeline_id, app_name, endpoint_name + serving_type. Source of truth for monthly chargeback.'
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
    is_serverless,
    sku_name,
    'DBU'                              AS usage_unit,    -- query_view allocates DBU-metered spend only
    CAST(NULL AS STRING)               AS cluster_id,
    CAST(NULL AS STRING)               AS pipeline_id,
    CAST(NULL AS STRING)               AS app_name,
    CAST(NULL AS STRING)               AS endpoint_name,  -- warehouse rows have no endpoint
    CAST(NULL AS STRING)               AS serving_type,
    tag_data_product,                                     -- warehouse custom tags: rules 1 + 3 apply
    tags_json,
    statement_id,
    dbu_allocated                      AS quantity,
    cost_allocated                     AS cost
  FROM main_dev.cost_reporting.query_view

  UNION ALL

  -- ---- Everything else (jobs, DLT, serverless, model serving, ...)
  SELECT
    usage_date,
    billing_origin_product             AS usage_category,
    CAST(workspace_id AS STRING)       AS workspace_id,
    -- non-NULL only for non-DBU warehouse-attached rows: they too get the
    -- dedicated-warehouse rule (rule 4) via compute_key
    warehouse_id                       AS compute_key,
    CAST(job_id AS STRING)             AS job_id,
    job_name,
    job_runner                         AS runner,
    is_serverless,
    sku_name,
    usage_unit,
    CAST(cluster_id AS STRING)         AS cluster_id,
    CAST(pipeline_id AS STRING)        AS pipeline_id,
    app_name,
    endpoint_name,
    serving_type,
    tag_data_product,
    tags_json,
    CAST(NULL AS STRING)               AS statement_id,
    total_quantity                     AS quantity,
    total_cost                         AS cost
  FROM main_dev.cost_reporting.usage_view
),

-- Resolve tag rules once per DISTINCT tag set, never per usage row:
-- grouping guarantees at most one product per tag set (no cost fan-out),
-- MIN_BY makes conflicting rules resolve deterministically (alphabetically
-- first key=value wins; the health page flags such conflicts).
tag_rule_matches AS (
  SELECT
    t.tags_json,
    MIN_BY(r.data_product, CONCAT(r.tag_key, '=', r.tag_value)) AS data_product
  FROM (SELECT DISTINCT tags_json FROM unified WHERE tags_json IS NOT NULL) t
  JOIN main_dev.cost_reporting.tag_product_mapping r
    ON element_at(from_json(t.tags_json, 'map<string,string>'), r.tag_key)
       = r.tag_value
  WHERE r.scope IN ('databricks', 'both')   -- azure-only rules never match Databricks tags
  GROUP BY t.tags_json
),

-- One product per runner even if the table holds duplicate rows
-- (deterministic MIN; duplicates are flagged on the health page).
runner_rules AS (
  SELECT user_id, MIN(data_product) AS data_product
  FROM main_dev.cost_reporting.runner_product_mapping
  GROUP BY user_id
),

-- One product per (workspace, endpoint) even if the table holds duplicate
-- rows (deterministic MIN — duplicate keys can never fan out cost).
endpoint_rules AS (
  SELECT workspace_id, endpoint_name, MIN(data_product) AS data_product
  FROM main_dev.cost_reporting.endpoint_product_mapping
  GROUP BY workspace_id, endpoint_name
),

-- One product per (workspace, pipeline) even if the table holds duplicate
-- rows (deterministic MIN — duplicate keys can never fan out cost).
pipeline_rules AS (
  SELECT workspace_id, pipeline_id, MIN(data_product) AS data_product
  FROM main_dev.cost_reporting.pipeline_product_mapping
  GROUP BY workspace_id, pipeline_id
),

-- One product per dedicated warehouse even if the table holds duplicate
-- rows (deterministic MIN — duplicate keys can never fan out cost; the
-- health page flags them).
warehouse_rules AS (
  SELECT warehouse_id, MIN(data_product) AS data_product
  FROM main_dev.cost_reporting.warehouse_product_mapping
  WHERE is_shared = false AND data_product IS NOT NULL
  GROUP BY warehouse_id
),

-- Interactive-first rows (waterfall rule 0): serverless warehouse queries
-- and AI serving, never job-run. Computed once so the attribution COALESCE
-- and the method label can't drift apart.
classified AS (
  SELECT
    u.*,
    (u.job_id IS NULL
     AND ((u.usage_category = 'SQL_WAREHOUSE' AND u.is_serverless = true)
          OR u.usage_category IN ('MODEL_SERVING', 'VECTOR_SEARCH',
                                  'FOUNDATION_MODEL_TRAINING',
                                  'AGENT_EVALUATION')))       AS interactive_first
  FROM unified u
),

attributed AS (
  SELECT
    u.*,
    COALESCE(
      CASE WHEN u.interactive_first                           -- rule 0: USER-FIRST (interactive
            AND um.user_id IS NOT NULL THEN 'AD_HOC' END,     --   spend bills the mapped runner)
      u.tag_data_product,                                     -- rule 1: TAG
      jm.data_product,                                        -- rule 2: JOB_MAPPING
      tr.data_product,                                        -- rule 3: TAG_RULE
      whm.data_product,                                       -- rule 4: WAREHOUSE_MAPPING
      em.data_product,                                        -- rule 4b: ENDPOINT_MAPPING
      pm.data_product,                                        -- rule 4c: PIPELINE_MAPPING
      rr.data_product,                                        -- rule 5: RUNNER_RULE
      CASE WHEN u.job_id IS NULL                              -- rule 6: USER (remaining ad-hoc,
            AND um.user_id IS NOT NULL THEN 'AD_HOC' END,     --   never job spend)
      'UNALLOCATED'                                           -- rule 7: NONE
    )                                            AS data_product,
    CASE
      WHEN u.interactive_first
       AND um.user_id         IS NOT NULL THEN 'USER'
      WHEN u.tag_data_product IS NOT NULL THEN 'TAG'
      WHEN jm.data_product    IS NOT NULL THEN 'JOB_MAPPING'
      WHEN tr.data_product    IS NOT NULL THEN 'TAG_RULE'
      WHEN whm.data_product   IS NOT NULL THEN 'WAREHOUSE_MAPPING'
      WHEN em.data_product    IS NOT NULL THEN 'ENDPOINT_MAPPING'
      WHEN pm.data_product    IS NOT NULL THEN 'PIPELINE_MAPPING'
      WHEN rr.data_product    IS NOT NULL THEN 'RUNNER_RULE'
      WHEN u.job_id IS NULL
       AND um.user_id         IS NOT NULL THEN 'USER'
      ELSE 'NONE'
    END                                          AS attribution_method,
    um.desk                                      AS runner_desk,
    um.user_name                                 AS runner_name
  FROM classified u
  LEFT JOIN main_dev.cost_reporting.job_product_mapping jm
    ON  u.workspace_id = jm.workspace_id
    AND u.job_id       = jm.job_id
  LEFT JOIN tag_rule_matches tr
    ON u.tags_json = tr.tags_json
  LEFT JOIN warehouse_rules whm
    ON u.compute_key = whm.warehouse_id
  LEFT JOIN endpoint_rules em
    ON  u.workspace_id  = em.workspace_id
    AND u.endpoint_name = em.endpoint_name
  LEFT JOIN pipeline_rules pm
    ON  u.workspace_id = pm.workspace_id
    AND u.pipeline_id  = pm.pipeline_id
  LEFT JOIN runner_rules rr
    ON u.runner = rr.user_id
  LEFT JOIN main_dev.cost_reporting.user_mapping um
    ON u.runner = um.user_id
)

SELECT
  a.usage_date,
  -- ---- three-level hierarchy
  COALESCE(dp.data_domain, 'UNALLOCATED')       AS data_domain,   -- level 1
  a.data_product,                                                 -- level 2
  -- runner_desk only when the USER rule fired - a NONE job row run by a
  -- known runner must NOT leak onto the runner's home desk
  COALESCE(dp.desk,
           CASE WHEN a.attribution_method = 'USER'
                THEN a.runner_desk END,
           'UNALLOCATED')                       AS desk,          -- level 3
  -- ---- attribution transparency
  a.attribution_method,
  COALESCE(dp.cost_split_pct, 1.0)              AS cost_split_pct,  -- this desk's share of the row's product
  a.tag_data_product                            AS raw_tag_data_product,
  a.tags_json,
  -- ---- detail dimensions
  a.usage_category,
  a.is_serverless,                              -- serverless vs classic compute
  a.workspace_id,
  a.compute_key                                 AS warehouse_id,
  a.cluster_id,                                 -- all-purpose/job compute cluster (NULL elsewhere)
  a.pipeline_id,                                -- DLT pipeline (NULL outside DLT)
  a.app_name,                                   -- Databricks App (NULL outside APPS)
  a.endpoint_name,                              -- AI/serving endpoint (NULL outside model serving / vector search)
  a.serving_type,                               -- e.g. BATCH_INFERENCE for ai_query batch jobs
  a.sku_name,
  a.usage_unit,                                 -- unit of usage_quantity: DBU, GB, ...
  a.job_id,
  a.job_name,
  a.runner,
  a.runner_name,
  a.statement_id,
  -- ---- measures, scaled by the desk's split share (1.0 = no split).
  -- The dp join deliberately fans out for split products: one mapping
  -- row per desk means one cost_fact row per desk.
  a.quantity * COALESCE(dp.cost_split_pct, 1.0) AS usage_quantity,
  -- DBU-only measure: 0 for non-DBU rows (GB, ...) so SUM(dbus) never
  -- mixes units. The full quantity is always in usage_quantity.
  CASE WHEN a.usage_unit = 'DBU'
       THEN a.quantity * COALESCE(dp.cost_split_pct, 1.0)
       ELSE 0 END                               AS dbus,
  a.cost * COALESCE(dp.cost_split_pct, 1.0)     AS cost
FROM attributed a
LEFT JOIN main_dev.cost_reporting.data_product_mapping dp
  ON  a.data_product = dp.data_product
  AND a.usage_date >= dp.valid_from
  AND a.usage_date <  COALESCE(dp.valid_to, DATE '9999-12-31');

-- §6.2 monthly_chargeback — the report
CREATE OR REPLACE VIEW main_dev.cost_reporting.monthly_chargeback
COMMENT 'Monthly chargeback rollup: billing month x domain x product x desk x usage category. Direct source for the monthly report and desk invoices. UNALLOCATED rows are a real line item - they represent spend nobody has claimed yet. total_dbus sums the DBU-only measure (non-DBU usage contributes 0, its cost is still fully included).'
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

-- §6.3 attribution_coverage — tagging-quality KPI
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

-- §6.4 desk_monthly_invoice — per-desk statement
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

-- =====================================================================
-- §6A Azure semantic layer
--
-- Parallel to §5/§6, over main_dev.azure_cleaned.amortized_costs (edit
-- the source table here if it moves — the setup script only rewrites the
-- main_dev.cost_reporting schema, source tables are left as written).
-- Deliberately NOT unioned into cost_fact / monthly_chargeback: the §7.1
-- reconciliation invariant (billing = cost_fact = report) is a Databricks
-- statement, and Azure attribution is an allowlist — the unmatched
-- remainder of the Azure bill must not flood the Databricks UNALLOCATED
-- line. Desk-facing rollups read azure_monthly_chargeback instead.
-- =====================================================================

-- §6A.1 azure_usage_view — daily Azure cost per resource + parsed tags
--
--   * One row per day / subscription / resource group / resource /
--     meter category / tag set, cost in USD (cost_in_usd).
--   * ARM identifiers are lowercased — Azure treats them case-
--     insensitively but exports mix cases, which would split group keys
--     and break rule joins.
--   * tags arrives as a JSON-ish string; Azure cost exports often ship
--     the pairs WITHOUT the outer braces, so they are re-added before
--     from_json. tags_json is re-serialized key-sorted, exactly like
--     usage_view.tags_json, so identical tag sets group together and
--     tag rules resolve once per DISTINCT set.
--   * The CANONICAL TAG SET (the cross-source tagging contract) is
--     extracted exactly like usage_view extracts it from custom_tags:
--     data_product (attribution, rule 1), provider, domain, desk and
--     Environment (informational — domain/desk on reports always derive
--     from data_product_mapping, never from tags). tag_environment is
--     the Environment TAG; the export's own environment column keeps its
--     name.

CREATE OR REPLACE VIEW main_dev.cost_reporting.azure_usage_view
COMMENT 'Daily Azure amortized cost per resource from azure_cleaned.amortized_costs, in USD. ARM ids lowercased; resource tags parsed (outer braces restored when the export omits them) and exposed as tag_data_product, the canonical tag set shared with usage_view (provider, domain, tag_desk, tag_environment) and key-sorted tags_json — the inputs of the Azure attribution waterfall in azure_cost_fact.'
AS
WITH src AS (
  SELECT
    `date`                                        AS usage_date,
    lower(subscription_id)                        AS subscription_id,
    lower(resource_group)                         AS resource_group,
    lower(resource_id)                            AS resource_id,
    meter_category,
    consumed_service,
    application_name,
    environment,
    cost_in_usd,
    -- Azure exports often ship 'k': 'v' pairs without the outer braces
    CASE
      WHEN tags IS NULL OR trim(tags) = ''  THEN NULL
      WHEN startswith(trim(tags), '{')      THEN trim(tags)
      ELSE concat('{', trim(tags), '}')
    END                                           AS tags_raw
  FROM main_dev.azure_cleaned.amortized_costs
),
parsed AS (
  SELECT *, from_json(tags_raw, 'map<string,string>') AS tag_map FROM src
)
SELECT
  usage_date,
  subscription_id,
  resource_group,
  resource_id,
  element_at(split(resource_id, '/'), -1)         AS resource_name,
  meter_category,
  consumed_service,
  application_name,
  environment,
  element_at(tag_map, 'data_product')             AS tag_data_product,
  -- canonical tag set, same keys usage_view extracts from custom_tags
  element_at(tag_map, 'provider')                 AS provider,
  element_at(tag_map, 'domain')                   AS domain,
  element_at(tag_map, 'desk')                     AS tag_desk,
  element_at(tag_map, 'Environment')              AS tag_environment,
  -- all resource tags, key-sorted so identical tag sets group together
  to_json(map_from_entries(array_sort(map_entries(tag_map)))) AS tags_json,
  SUM(cost_in_usd)                                AS total_cost
FROM parsed
GROUP BY
  usage_date, subscription_id, resource_group, resource_id, resource_name,
  meter_category, consumed_service, application_name, environment,
  tag_data_product, provider, domain, tag_desk, tag_environment, tags_json;

-- §6A.2 azure_cost_fact — Azure attribution waterfall
--
--   * Waterfall (mirrors cost_fact, Azure nouns):
--       1 TAG               data_product tag on the resource itself
--       2 RESOURCE_MAPPING  resource_id in azure_resource_product_mapping
--       3 TAG_RULE          any resource tag matches a tag_product_mapping
--                           rule with scope azure/both (unified table, §4.5)
--       4 RESOURCE_GROUP    (subscription, resource group) rule
--       5 SUBSCRIPTION      subscription rule
--       6 NONE              UNALLOCATED — visible in coverage, never billed
--   * domain/desk/splits derived from data_product_mapping with the same
--     validity-period join as cost_fact; multi-desk products fan out one
--     row per desk with cost scaled by cost_split_pct.
--   * Rule tables are deduplicated per key (MIN) so duplicate rows can
--     never fan out cost; the alphabetically-first tag rule wins ties.

CREATE OR REPLACE VIEW main_dev.cost_reporting.azure_cost_fact
COMMENT 'Azure cost with data_product attribution waterfall (TAG > RESOURCE_MAPPING > TAG_RULE > RESOURCE_GROUP > SUBSCRIPTION > NONE) and domain/desk derived from validity-versioned data_product_mapping — the same catalogue, splits included, as Databricks cost_fact. Unmatched cost stays UNALLOCATED here and never enters the Databricks chargeback report.'
AS
WITH tag_rule_matches AS (
  -- resolve tag rules once per DISTINCT tag set; MIN_BY = deterministic winner
  SELECT
    t.tags_json,
    MIN_BY(r.data_product, CONCAT(r.tag_key, '=', r.tag_value)) AS data_product
  FROM (SELECT DISTINCT tags_json FROM main_dev.cost_reporting.azure_usage_view
        WHERE tags_json IS NOT NULL) t
  JOIN main_dev.cost_reporting.tag_product_mapping r
    ON element_at(from_json(t.tags_json, 'map<string,string>'), r.tag_key)
       = r.tag_value
  WHERE r.scope IN ('azure', 'both')   -- databricks-only rules never match resource tags
  GROUP BY t.tags_json
),
resource_rules AS (
  SELECT lower(resource_id) AS resource_id, MIN(data_product) AS data_product
  FROM main_dev.cost_reporting.azure_resource_product_mapping
  GROUP BY 1
),
rg_rules AS (
  SELECT lower(subscription_id) AS subscription_id,
         lower(resource_group)  AS resource_group,
         MIN(data_product)      AS data_product
  FROM main_dev.cost_reporting.azure_rg_product_mapping
  GROUP BY 1, 2
),
subscription_rules AS (
  SELECT lower(subscription_id) AS subscription_id, MIN(data_product) AS data_product
  FROM main_dev.cost_reporting.azure_subscription_product_mapping
  GROUP BY 1
),
attributed AS (
  SELECT
    u.*,
    COALESCE(
      u.tag_data_product,                        -- rule 1: TAG
      rm.data_product,                           -- rule 2: RESOURCE_MAPPING
      tr.data_product,                           -- rule 3: TAG_RULE
      rg.data_product,                           -- rule 4: RESOURCE_GROUP
      sm.data_product,                           -- rule 5: SUBSCRIPTION
      'UNALLOCATED'                              -- rule 6: NONE
    )                                            AS data_product,
    CASE
      WHEN u.tag_data_product IS NOT NULL THEN 'TAG'
      WHEN rm.data_product    IS NOT NULL THEN 'RESOURCE_MAPPING'
      WHEN tr.data_product    IS NOT NULL THEN 'TAG_RULE'
      WHEN rg.data_product    IS NOT NULL THEN 'RESOURCE_GROUP'
      WHEN sm.data_product    IS NOT NULL THEN 'SUBSCRIPTION'
      ELSE 'NONE'
    END                                          AS attribution_method
  FROM main_dev.cost_reporting.azure_usage_view u
  LEFT JOIN resource_rules rm
    ON u.resource_id = rm.resource_id
  LEFT JOIN tag_rule_matches tr
    ON u.tags_json = tr.tags_json
  LEFT JOIN rg_rules rg
    ON  u.subscription_id = rg.subscription_id
    AND u.resource_group  = rg.resource_group
  LEFT JOIN subscription_rules sm
    ON u.subscription_id = sm.subscription_id
)
SELECT
  a.usage_date,
  COALESCE(dp.data_domain, 'UNALLOCATED')        AS data_domain,
  a.data_product,
  COALESCE(dp.desk, 'UNALLOCATED')               AS desk,
  a.attribution_method,
  COALESCE(dp.cost_split_pct, 1.0)               AS cost_split_pct,
  a.tag_data_product                             AS raw_tag_data_product,
  a.tags_json,
  a.subscription_id,
  a.resource_group,
  a.resource_id,
  a.resource_name,
  a.meter_category,
  a.consumed_service,
  a.application_name,
  a.environment,
  -- fan-out for split products is deliberate: one row per paying desk
  a.total_cost * COALESCE(dp.cost_split_pct, 1.0) AS cost
FROM attributed a
LEFT JOIN main_dev.cost_reporting.data_product_mapping dp
  ON  a.data_product = dp.data_product
  AND a.usage_date >= dp.valid_from
  AND a.usage_date <  COALESCE(dp.valid_to, DATE '9999-12-31');

-- §6A.3 azure_monthly_chargeback — desk-facing Azure rollup
CREATE OR REPLACE VIEW main_dev.cost_reporting.azure_monthly_chargeback
COMMENT 'Monthly Azure rollup: billing month x domain x product x desk x meter category. UNALLOCATED rows are the not-yet-claimed remainder of the Azure bill — visible here and on the Azure coverage screen, never billed to a desk.'
AS
SELECT
  DATE_TRUNC('month', usage_date)                AS billing_month,
  data_domain,
  data_product,
  desk,
  meter_category                                 AS usage_category,
  COUNT(DISTINCT resource_id)                    AS distinct_resources,
  SUM(cost)                                      AS total_cost
FROM main_dev.cost_reporting.azure_cost_fact
GROUP BY 1, 2, 3, 4, 5;

-- =====================================================================
-- §6B tagging_scorecard — the cross-source tagging KPI
--
-- One tagging standard, measured identically everywhere: monthly cost per
-- attribution method for each spend source. DATABRICKS covers all of
-- cost_fact; AI is the model-serving/vector-search/foundation-model slice
-- of the SAME fact (a subset of DATABRICKS, broken out because AI spend
-- has its own tagging owners); AZURE covers azure_cost_fact. TAG share
-- rising and NONE shrinking on every source is the goal — the same
-- data_product tag drives rule 1 of both waterfalls.
-- =====================================================================

CREATE OR REPLACE VIEW main_dev.cost_reporting.tagging_scorecard
COMMENT 'Monthly cost per attribution method per spend source (DATABRICKS, AI, AZURE) — the cross-source tagging scorecard. AI is the AI-category slice of cost_fact and therefore a subset of DATABRICKS, never added to it. Publish alongside the chargeback report to drive data_product tagging adoption on every source with one standard.'
AS
WITH per_source AS (
  SELECT 'DATABRICKS' AS source,
         DATE_TRUNC('month', usage_date) AS billing_month,
         attribution_method, SUM(cost) AS cost
  FROM main_dev.cost_reporting.cost_fact
  GROUP BY 2, 3
  UNION ALL
  SELECT 'AI',
         DATE_TRUNC('month', usage_date),
         attribution_method, SUM(cost)
  FROM main_dev.cost_reporting.cost_fact
  WHERE usage_category IN ('MODEL_SERVING', 'VECTOR_SEARCH',
                           'FOUNDATION_MODEL_TRAINING', 'AGENT_EVALUATION')
  GROUP BY 2, 3
  UNION ALL
  SELECT 'AZURE',
         DATE_TRUNC('month', usage_date),
         attribution_method, SUM(cost)
  FROM main_dev.cost_reporting.azure_cost_fact
  GROUP BY 2, 3
)
SELECT
  source,
  billing_month,
  attribution_method,
  cost,
  cost / SUM(cost) OVER (PARTITION BY source, billing_month) AS pct_of_month
FROM per_source;

-- =====================================================================
-- §9 Materialization targets (empty on creation; filled by the daily
--    refresh job and the monthly publication step — see methodology §9)
--
-- MIGRATION NOTE (AI cost tracking): usage_view gained endpoint_name and
-- serving_type columns. usage_fact_tbl created before that change has the
-- old shape and any INSERT … SELECT refresh will fail until it is aligned.
-- The fact tables are rebuildable caches — on existing deployments simply
--   DROP TABLE main_dev.cost_reporting.usage_fact_tbl;
-- and rerun this script; the next refresh run refills it.
--
-- MIGRATION NOTE (unified dimensions): query_view gained sku_name,
-- is_serverless, tag_data_product and tags_json; usage_view gained
-- cluster_id, pipeline_id, app_name and warehouse_id, renamed total_dbus
-- to total_quantity, and its scope filter is now the exact complement of
-- query_view's (non-DBU warehouse-attached rows are no longer dropped).
-- BOTH fact-table caches predating this change have the old shape:
--   DROP TABLE main_dev.cost_reporting.query_fact_tbl;
--   DROP TABLE main_dev.cost_reporting.usage_fact_tbl;
-- then rerun this script; the next refresh run refills them.
--
-- MIGRATION NOTE (unified tag rules): tag_product_mapping gained a scope
-- column ('databricks' | 'azure' | 'both') and absorbed the former
-- azure_tag_product_mapping — both waterfalls now read ONE rule table,
-- filtered by scope. CREATE TABLE IF NOT EXISTS does not alter existing
-- tables, so on deployments created before this change run once:
--   ALTER TABLE main_dev.cost_reporting.tag_product_mapping
--     ADD COLUMN scope STRING;
--   UPDATE main_dev.cost_reporting.tag_product_mapping
--     SET scope = 'databricks' WHERE scope IS NULL;
--   ALTER TABLE main_dev.cost_reporting.tag_product_mapping
--     ALTER COLUMN scope SET NOT NULL;
--   INSERT INTO main_dev.cost_reporting.tag_product_mapping
--     (tag_key, tag_value, data_product, note, mapped_by, mapped_at, scope)
--   SELECT tag_key, tag_value, data_product, note, mapped_by, mapped_at,
--          'azure'
--   FROM main_dev.cost_reporting.azure_tag_product_mapping;
--   DROP TABLE main_dev.cost_reporting.azure_tag_product_mapping;
-- then rerun this script (the views must be recreated AFTER the ALTER —
-- until then cost_fact fails on the missing scope column). Attribution is
-- unchanged by the migration: every rule keeps matching exactly the
-- namespace it matched before.
-- =====================================================================

CREATE TABLE IF NOT EXISTS main_dev.cost_reporting.query_fact_tbl
  CLUSTER BY (query_date, warehouse_id)
AS SELECT * FROM main_dev.cost_reporting.query_view WHERE 1 = 0;

CREATE TABLE IF NOT EXISTS main_dev.cost_reporting.usage_fact_tbl
  CLUSTER BY (usage_date, workspace_id)
AS SELECT * FROM main_dev.cost_reporting.usage_view WHERE 1 = 0;

-- Published monthly snapshots — desks are invoiced from here, never from
-- live views, so mapping edits cannot silently change an issued invoice.
CREATE TABLE IF NOT EXISTS main_dev.cost_reporting.monthly_chargeback_published
AS SELECT current_timestamp() AS published_at,
          billing_month AS snapshot_month, *
   FROM main_dev.cost_reporting.monthly_chargeback WHERE 1 = 0;
 
