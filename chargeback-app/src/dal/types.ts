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
  | "ENDPOINT_MAPPING" // rule 4b — dedicated AI/serving endpoint
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
  /** AI/serving endpoint (cost_fact.endpoint_name); null outside model serving / vector search */
  endpoint_name: string | null;
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

/**
 * Endpoint bridge (waterfall rule 4b): one AI/model-serving endpoint →
 * product — the serving analogue of a dedicated warehouse. endpoint_name
 * must match usage_metadata.endpoint_name exactly; names are only unique
 * per workspace, so the key is composite.
 */
export interface EndpointMappingRow {
  workspace_id: string;
  endpoint_name: string;
  data_product: string;
  note: string | null;
  mapped_by: string | null;
  mapped_at: string | null;
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
  /** null for subscription-scoped charges (marketplace, reservations, support) that have no RG */
  resource_group: string | null;
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

// ---------- Azure cost monitoring (/azure) ----------

/** One month of azure_monthly_chargeback at domain × product × desk × meter-category grain. */
export interface AzureMonthlyRow {
  data_domain: string;
  data_product: string;
  desk: string;
  /** Azure meter_category ('Virtual Machines', 'Storage', …); 'Other' when the export omits it */
  usage_category: string;
  distinct_resources: number;
  total_cost: number;
}

/**
 * The Azure lines of one desk's month — the informational companion to the
 * Databricks invoice. Always live: Azure never enters the published snapshot.
 */
export interface AzureInvoiceRow {
  data_domain: string;
  data_product: string;
  total_cost: number;
}

/** Azure cost per month × desk, trailing 12 months — the Azure trend feed. */
export interface AzureTrendPoint {
  billing_month: string;
  desk: string;
  total_cost: number;
}

/** One month's Azure cost per attribution method — the waterfall mix. */
export interface AzureMethodMixRow {
  attribution_method: AzureAttributionMethod;
  cost: number;
}

/** One month's Azure cost per resource — one row per (resource, method, product, desk), like coverage. */
export interface AzureMonthResourceRow {
  subscription_id: string;
  /** null for subscription-scoped charges (marketplace, reservations, support) that have no RG */
  resource_group: string | null;
  resource_id: string;
  /** last segment of the ARM ID — display name */
  resource_name: string | null;
  meter_category: string | null;
  attribution_method: AzureAttributionMethod;
  data_product: string;
  desk: string;
  cost: number;
}

// ---------- AI cost tracking ----------

/**
 * One month's AI spend per endpoint × offering type × runner × product ×
 * desk, from live cost_fact filtered to the AI usage categories.
 * endpoint_name is null for AI spend that carries no endpoint dimension
 * (e.g. vector search ingest, foundation-model training).
 */
export interface AiEndpointUsageRow {
  endpoint_name: string | null;
  /** product_features.model_serving.offering_type, e.g. BATCH_INFERENCE (ai_query batch); null when absent */
  serving_type: string | null;
  usage_category: string;
  workspace_id: string;
  /** friendly name from workspace_mapping; 'UNMAPPED: <id>' when the workspace has no row */
  workspace_name: string;
  /** identity_metadata.run_as — who the workload executed as (null on rows without an identity) */
  runner: string | null;
  /** display name from user_mapping; null = unmapped runner (show the raw runner id) */
  runner_name: string | null;
  data_product: string;
  desk: string;
  attribution_method: AttributionMethod;
  /** first/last usage_date with spend in the month — day precision, from cost_fact */
  first_seen: string;
  last_seen: string;
  dbus: number;
  cost: number;
}

/** Trailing-12-month AI cost per month × usage category — the AI trend feed. */
export interface AiTrendPoint {
  billing_month: string;
  usage_category: string;
  total_cost: number;
}

/** Endpoint whose trailing-30-day spend fell to UNALLOCATED — endpoint-bridge candidate. */
export interface UnmappedEndpointRow {
  workspace_id: string;
  endpoint_name: string;
  serving_type: string | null;
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
  /**
   * Azure counterpart of recon: azure_usage_view (= the raw Azure bill) vs
   * azure_cost_fact vs azure_monthly_chargeback. Informational — Azure is
   * never published, so gaps here do not block publication.
   */
  azureRecon: ReconRow[];
  violations: IntegrityViolation[];
  ranAt: string;
}
