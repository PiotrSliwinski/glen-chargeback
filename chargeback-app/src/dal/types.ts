/**
 * Row shapes shared by the real (Databricks) and mock DAL paths.
 * Months are always 'YYYY-MM' strings; dates 'YYYY-MM-DD'; money in USD.
 */

export type ReportMode = "live" | "published";

export type AttributionMethod =
  | "TAG"
  | "JOB_MAPPING"
  | "WAREHOUSE_MAPPING"
  | "USER"
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
  job_name: string | null;
  warehouse_id: string | null;
  runner_name: string | null;
  attribution_method: AttributionMethod;
  cost: number;
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

// ---------- mapping tables ----------

export interface DataProductRow {
  data_product: string;
  data_domain: string;
  desk: string;
  product_owner: string | null;
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
  check: "overlap" | "orphan_product" | "duplicate_bridge_key" | "warehouse_flags";
  detail: string;
}

export interface HealthReport {
  recon: ReconRow[];
  violations: IntegrityViolation[];
  ranAt: string;
}
