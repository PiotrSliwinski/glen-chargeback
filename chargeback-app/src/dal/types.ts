/**
 * Row shapes shared by the real (Databricks) and mock DAL paths.
 * Months are always 'YYYY-MM' strings; dates 'YYYY-MM-DD'; money in USD.
 */

export type ReportMode = "live" | "published";

export type AttributionMethod =
  | "TAG"
  | "JOB_MAPPING"
  | "TAG_RULE"
  | "WAREHOUSE_MAPPING"
  | "RUNNER_RULE"
  | "USER" // ad-hoc spend only — job cost never defaults to the runner
  | "NONE";

/** Azure waterfall (azure_cost_fact) — same idea, Azure nouns. */
export type AzureAttributionMethod =
  | "TAG"
  | "RESOURCE_MAPPING"
  | "TAG_RULE"
  | "RESOURCE_GROUP"
  | "SUBSCRIPTION"
  | "NONE";

// ---------- reporting ----------

export interface MonthlyChargebackRow {
  billing_month: string;
  data_domain: string;
  data_product: string;
  desk: string;
  usage_category: string;
  distinct_runners: number;
  total_dbus: number;
  total_cost: number;
}

export interface CoverageRow {
  billing_month: string;
  attribution_method: AttributionMethod;
  cost: number;
  pct_of_month: number;
}

export interface DomainRollup {
  data_domain: string;
  total_cost: number;
  total_dbus: number;
}

export interface ProductRollup {
  data_product: string;
  desk: string;
  cost: number;
  dbus: number;
}

export interface DetailRow {
  usage_category: string;
  /** true = serverless compute, false = classic; null when the source can't tell (per-query warehouse rows) */
  is_serverless: boolean | null;
  job_name: string | null;
  warehouse_id: string | null;
  runner_name: string | null;
  attribution_method: AttributionMethod;
  dbus: number;
  cost: number;
}

/** Desk drill-down line: DetailRow plus the product the line was attributed to. */
export interface DeskDetailRow extends DetailRow {
  data_product: string;
}

export interface InvoiceRow {
  billing_month: string;
  desk: string;
  data_domain: string;
  data_product: string;
  total_dbus: number;
  total_cost: number;
  desk_month_total: number;
}

export interface DashboardData {
  month: string;
  mode: ReportMode;
  totalCost: number;
  prevMonthCost: number | null;
  tagCoveragePct: number;
  unallocatedCost: number;
  byDomain: DomainRollup[];
  /** cost per (month, domain) for the trailing 12 months — trend chart */
  trend: { billing_month: string; data_domain: string; total_cost: number }[];
  coverage: CoverageRow[];
}

// ---------- work queue ----------

export interface UntaggedJobRow {
  usage_category: string;
  workspace_id: string;
  work_item: string;
  job_id: string | null;
  runner: string | null;
  unallocated_cost_30d: number;
}

export interface UnknownRunnerRow {
  runner: string;
  cost_30d: number;
  rows_30d: number;
}

export interface UnknownWorkspaceRow {
  workspace_id: string;
  dbus_30d: number;
}

export interface RogueTagRow {
  raw_tag_data_product: string;
  cost_30d: number;
  rows_30d: number;
}

export interface UnassignedWarehouseRow {
  warehouse_id: string;
  workspace_id: string;
  cost_30d: number;
  idle_share: number;
}

/** Runner with spend in the trailing 30 days who is absent from user_mapping. */
export interface UnmappedRunnerRow {
  runner: string;
  cost_30d: number;
  /** slice of cost_30d on serverless compute — the part the USER rule can never catch while unmapped */
  serverless_cost_30d: number;
  dbus_30d: number;
  rows_30d: number;
  workspace_count: number;
  /** usage_category of the runner's single most expensive row */
  top_category: string;
  last_seen: string;
}

/** How one job's cost attributed over the trailing 30 days — one row per (job, method, product). */
export interface JobAttributionRow {
  workspace_id: string;
  job_id: string;
  job_name: string | null;
  attribution_method: AttributionMethod;
  data_product: string;
  desk: string;
  /** custom tags of the slice's most expensive row, key-sorted JSON object (null = untagged) */
  tags_json: string | null;
  dbus_30d: number;
  cost_30d: number;
}

// ---------- mapping tables ----------

/**
 * One catalogue row per product PER DESK per validity window. A product
 * billed to a single desk has one row with cost_split_pct = 1; a product
 * shared between desks has one row per desk, shares summing to 1.
 */
export interface DataProductRow {
  data_product: string;
  data_domain: string;
  desk: string;
  product_owner: string | null;
  /** this desk's share of the product's cost, 0–1 */
  cost_split_pct: number;
  valid_from: string;
  valid_to: string | null;
  mapped_by: string | null;
  mapped_at: string | null;
}

export interface JobMappingRow {
  workspace_id: string;
  job_id: string;
  data_product: string;
  note: string | null;
  mapped_by: string | null;
  mapped_at: string | null;
}

/** Tag rule (waterfall rule 3): any custom tag key=value → product. */
export interface TagRuleRow {
  tag_key: string;
  tag_value: string;
  data_product: string;
  note: string | null;
  mapped_by: string | null;
  mapped_at: string | null;
}

/** Runner rule (waterfall rule 5): everything this identity runs → product. */
export interface RunnerRuleRow {
  user_id: string;
  data_product: string;
  note: string | null;
  mapped_by: string | null;
  mapped_at: string | null;
}

export interface WarehouseMappingRow {
  warehouse_id: string;
  data_product: string | null;
  is_shared: boolean;
}

export interface UserMappingRow {
  user_id: string;
  user_name: string;
  desk: string;
}

export interface WorkspaceMappingRow {
  workspace_id: string;
  workspace_name: string;
}

/**
 * DBU reservation-plan window: within [valid_from, valid_to] (both inclusive)
 * Databricks DBU spend is billed at list price × (1 − discount_pct). Applied
 * at pricing time in query_view / usage_view, DBU-metered rows only — never
 * Azure cost. Windows must not overlap.
 */
export interface DbuDiscountRow {
  valid_from: string;
  valid_to: string;
  /** share of list price waived, 0–1 (0.27 = 27% off) */
  discount_pct: number;
  note: string | null;
  mapped_by: string | null;
  mapped_at: string | null;
}

// ---------- Azure attribution ----------

/** Resource bridge (Azure rule 2): one ARM resource → product. */
export interface AzureResourceMappingRow {
  resource_id: string;
  data_product: string;
  note: string | null;
  mapped_by: string | null;
  mapped_at: string | null;
}

/** Azure tag rule (Azure rule 3): any resource tag key=value → product. */
export interface AzureTagRuleRow {
  tag_key: string;
  tag_value: string;
  data_product: string;
  note: string | null;
  mapped_by: string | null;
  mapped_at: string | null;
}

/** Resource-group rule (Azure rule 4): whole RG → product. */
export interface AzureRgRuleRow {
  subscription_id: string;
  resource_group: string;
  data_product: string;
  note: string | null;
  mapped_by: string | null;
  mapped_at: string | null;
}

/** Subscription rule (Azure rule 5): whole subscription → product. */
export interface AzureSubscriptionRuleRow {
  subscription_id: string;
  data_product: string;
  note: string | null;
  mapped_by: string | null;
  mapped_at: string | null;
}

/** How one Azure resource's cost attributed over the trailing 30 days — one row per (resource, method, product). */
export interface AzureResourceAttributionRow {
  subscription_id: string;
  resource_group: string;
  resource_id: string;
  /** last segment of the ARM ID — display name */
  resource_name: string | null;
  meter_category: string | null;
  attribution_method: AzureAttributionMethod;
  data_product: string;
  desk: string;
  /** resource tags of the slice's most expensive row, key-sorted JSON object (null = untagged) */
  tags_json: string | null;
  cost_30d: number;
}

/** Trailing-30-day Azure cost per desk (UNALLOCATED = not yet claimed). */
export interface AzureDeskTotalRow {
  desk: string;
  cost_30d: number;
}

// ---------- health ----------

export interface ReconRow {
  billing_month: string;
  billing_cost: number;
  fact_cost: number;
  report_cost: number;
  fact_gap: number;
  report_gap: number;
}

export interface IntegrityViolation {
  check:
    | "overlap"
    | "split_sum"
    | "orphan_product"
    | "duplicate_bridge_key"
    | "duplicate_rule_key"
    | "warehouse_flags"
    | "discount_overlap"
    | "discount_range";
  detail: string;
}

export interface HealthReport {
  recon: ReconRow[];
  violations: IntegrityViolation[];
  ranAt: string;
}
