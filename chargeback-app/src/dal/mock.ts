import type {
  AiEndpointUsageRow,
  AzureResourceAttributionRow,
  AzureResourceMappingRow,
  AzureRgRuleRow,
  AzureSubscriptionRuleRow,
  AzureTagRuleRow,
  CoverageRow,
  DataProductRow,
  DbuDiscountRow,
  DetailRow,
  EndpointMappingRow,
  JobAttributionRow,
  JobMappingRow,
  MonthlyChargebackRow,
  PipelineMappingRow,
  ReconRow,
  RunnerRuleRow,
  UnmappedRunnerRow,
  RogueTagRow,
  TagRuleRow,
  UnassignedWarehouseRow,
  UnknownRunnerRow,
  UnknownWorkspaceRow,
  UntaggedJobRow,
  UserMappingRow,
  WarehouseMappingRow,
  WorkspaceMappingRow,
} from "@/dal/types";

/**
 * In-memory fixture store used when DAL_MOCK is on (no Databricks configured).
 * Mutable so admin/work-queue actions behave realistically in a demo.
 * Kept on globalThis to survive dev-server HMR module reloads.
 */

export interface MockStore {
  months: string[]; // closed + current months present in "billing"
  /** per-month scale factor for the static base matrices (growth trend) */
  monthFactor: Record<string, number>;
  publishedMonths: string[];
  catalogue: DataProductRow[];
  users: UserMappingRow[];
  workspaces: WorkspaceMappingRow[];
  jobMappings: JobMappingRow[];
  tagRules: TagRuleRow[];
  runnerRules: RunnerRuleRow[];
  warehouseMappings: WarehouseMappingRow[];
  endpointMappings: EndpointMappingRow[];
  pipelineMappings: PipelineMappingRow[];
  // base (unscaled) values — DAL scales by monthFactor and resolves
  // workspace_name from the workspaces fixture at read time
  aiEndpointUsage: Omit<AiEndpointUsageRow, "workspace_name">[];
  dbuDiscounts: DbuDiscountRow[];
  monthly: MonthlyChargebackRow[];
  coverage: CoverageRow[];
  detail: Record<string, DetailRow[]>; // by data_product
  queueUntaggedJobs: UntaggedJobRow[];
  queueUnknownRunners: UnknownRunnerRow[];
  queueUnknownWorkspaces: UnknownWorkspaceRow[];
  queueRogueTags: RogueTagRow[];
  queueUnassignedWarehouses: UnassignedWarehouseRow[];
  unmappedRunners: UnmappedRunnerRow[];
  jobAttributions: JobAttributionRow[];
  azureResourceMappings: AzureResourceMappingRow[];
  azureTagRules: AzureTagRuleRow[];
  azureRgRules: AzureRgRuleRow[];
  azureSubscriptionRules: AzureSubscriptionRuleRow[];
  azureAttributions: AzureResourceAttributionRow[];
  recon: ReconRow[];
  azureRecon: ReconRow[];
}

function createStore(): MockStore {
  const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];

  const catalogue: DataProductRow[] = [
    // pricing-curves moved desk fx -> rates on 2026-05-01: two validity rows
    { data_product: "pricing-curves", data_domain: "market-data", desk: "fx", product_owner: "anna.kowalska@example.com", cost_split_pct: 1, valid_from: "2025-10-01", valid_to: "2026-05-01", mapped_by: "steward@example.com", mapped_at: "2026-04-20T10:00:00Z" },
    { data_product: "pricing-curves", data_domain: "market-data", desk: "rates", product_owner: "anna.kowalska@example.com", cost_split_pct: 1, valid_from: "2026-05-01", valid_to: null, mapped_by: "steward@example.com", mapped_at: "2026-04-20T10:00:00Z" },
    { data_product: "ref-data-ingest", data_domain: "market-data", desk: "rates", product_owner: "jan.nowak@example.com", cost_split_pct: 1, valid_from: "2025-10-01", valid_to: null, mapped_by: null, mapped_at: null },
    { data_product: "var-engine", data_domain: "risk", desk: "risk", product_owner: "maria.wisniewska@example.com", cost_split_pct: 1, valid_from: "2025-10-01", valid_to: null, mapped_by: null, mapped_at: null },
    // stress-testing is shared: risk pays 70%, credit 30% — two concurrent rows, one per desk
    { data_product: "stress-testing", data_domain: "risk", desk: "risk", product_owner: "maria.wisniewska@example.com", cost_split_pct: 0.7, valid_from: "2026-01-01", valid_to: null, mapped_by: null, mapped_at: null },
    { data_product: "stress-testing", data_domain: "risk", desk: "credit", product_owner: "maria.wisniewska@example.com", cost_split_pct: 0.3, valid_from: "2026-01-01", valid_to: null, mapped_by: null, mapped_at: null },
    { data_product: "trade-pnl", data_domain: "pnl", desk: "credit", product_owner: "piotr.zielinski@example.com", cost_split_pct: 1, valid_from: "2025-10-01", valid_to: null, mapped_by: null, mapped_at: null },
    // AI product: ai_query batch extraction of structured data from outage alert texts
    { data_product: "outage-extraction", data_domain: "market-data", desk: "risk", product_owner: "sara.subramaniam@example.com", cost_split_pct: 1, valid_from: "2025-10-01", valid_to: null, mapped_by: "steward@example.com", mapped_at: "2025-12-02T09:00:00Z" },
  ];

  const users: UserMappingRow[] = [
    { user_id: "anna.kowalska@example.com", user_name: "Anna Kowalska", desk: "rates" },
    { user_id: "jan.nowak@example.com", user_name: "Jan Nowak", desk: "rates" },
    { user_id: "maria.wisniewska@example.com", user_name: "Maria Wiśniewska", desk: "risk" },
    { user_id: "piotr.zielinski@example.com", user_name: "Piotr Zieliński", desk: "credit" },
    { user_id: "sara.subramaniam@example.com", user_name: "Sara Subramaniam", desk: "risk" },
    { user_id: "9a1b2c3d-svc-etl", user_name: "SP: etl-runner", desk: "rates" },
  ];

  const workspaces: WorkspaceMappingRow[] = [
    { workspace_id: "1111111111111111", workspace_name: "prod-analytics" },
    { workspace_id: "2222222222222222", workspace_name: "prod-etl" },
    { workspace_id: "3333333333333333", workspace_name: "dev-sandbox" },
  ];

  const jobMappings: JobMappingRow[] = [
    { workspace_id: "2222222222222222", job_id: "845", data_product: "ref-data-ingest", note: "legacy loader, tagging planned Q3", mapped_by: "steward@example.com", mapped_at: "2026-03-11T09:30:00Z" },
    { workspace_id: "2222222222222222", job_id: "1022", data_product: "trade-pnl", note: null, mapped_by: "steward@example.com", mapped_at: "2026-04-02T14:12:00Z" },
    { workspace_id: "1111111111111111", job_id: "310", data_product: "var-engine", note: "nightly VaR batch", mapped_by: "steward@example.com", mapped_at: "2026-02-25T08:45:00Z" },
  ];

  // Tag rules (waterfall rule 3): platform-created jobs carry team/project
  // tags long before anyone adds a data_product tag — the rule routes them.
  const tagRules: TagRuleRow[] = [
    { tag_key: "team", tag_value: "market-data-eng", data_product: "ref-data-ingest", note: "platform ETL jobs tag team, not data_product", mapped_by: "steward@example.com", mapped_at: "2026-05-14T11:20:00Z" },
  ];

  // Runner rules (waterfall rule 5): the explicit opt-in replacement for
  // defaulting job cost to the runner's home desk.
  const runnerRules: RunnerRuleRow[] = [
    { user_id: "9a1b2c3d-svc-etl", data_product: "pricing-curves", note: "SP exists only to run curve pipelines", mapped_by: "steward@example.com", mapped_at: "2026-06-03T09:05:00Z" },
  ];

  const warehouseMappings: WarehouseMappingRow[] = [
    { warehouse_id: "wh-risk-dedicated", data_product: "var-engine", is_shared: false },
    { warehouse_id: "wh-shared-main", data_product: null, is_shared: true },
    { warehouse_id: "wh-shared-adhoc", data_product: null, is_shared: true },
  ];

  // Endpoint bridge (waterfall rule 4b): dedicated AI/serving endpoint → product.
  const endpointMappings: EndpointMappingRow[] = [
    { workspace_id: "1111111111111111", endpoint_name: "curves-embedding-api", data_product: "pricing-curves", note: "embedding endpoint feeding curve search, tagging ticket DATA-3110", mapped_by: "steward@example.com", mapped_at: "2026-06-15T10:00:00Z" },
  ];

  // Pipeline bridge (waterfall rule 4c): dedicated DLT pipeline → product.
  const pipelineMappings: PipelineMappingRow[] = [
    { workspace_id: "2222222222222222", pipeline_id: "b7c1d2e3-ref-data-dlt", data_product: "ref-data-ingest", note: "reference-data DLT pipeline, tagging ticket DATA-3244", mapped_by: "steward@example.com", mapped_at: "2026-06-28T09:00:00Z" },
  ];

  // AI/model-serving cost per endpoint × offering type × runner (cost_fact
  // filtered to the AI usage categories). Base values — the DAL scales by
  // monthFactor so the endpoint table stays consistent with the monthly
  // matrix above; first/last_seen carry base-month dates whose month part
  // the DAL rewrites to the requested month.
  // endpoint_name null = AI spend with no endpoint dimension (vector search).
  const aiEndpointUsage: Omit<AiEndpointUsageRow, "workspace_name">[] = [
    { endpoint_name: "outage-alerts-extract-sonnet4", serving_type: "BATCH_INFERENCE", usage_category: "MODEL_SERVING", workspace_id: "1111111111111111", runner: "sara.subramaniam@example.com", runner_name: "Sara Subramaniam", data_product: "outage-extraction", desk: "risk", attribution_method: "TAG", first_seen: "2026-05-02", last_seen: "2026-05-28", dbus: 4400, cost: 4100 },
    { endpoint_name: "outage-alerts-extract-sonnet4", serving_type: "REALTIME_INFERENCE", usage_category: "MODEL_SERVING", workspace_id: "1111111111111111", runner: "sara.subramaniam@example.com", runner_name: "Sara Subramaniam", data_product: "outage-extraction", desk: "risk", attribution_method: "TAG", first_seen: "2026-05-01", last_seen: "2026-05-27", dbus: 800, cost: 800 },
    { endpoint_name: "pnl-anomaly-endpoint", serving_type: "REALTIME_INFERENCE", usage_category: "MODEL_SERVING", workspace_id: "1111111111111111", runner: "piotr.zielinski@example.com", runner_name: "Piotr Zieliński", data_product: "trade-pnl", desk: "credit", attribution_method: "TAG", first_seen: "2026-05-03", last_seen: "2026-05-26", dbus: 4100, cost: 2300 },
    { endpoint_name: "curves-embedding-api", serving_type: "REALTIME_INFERENCE", usage_category: "MODEL_SERVING", workspace_id: "1111111111111111", runner: "9a1b2c3d-svc-etl", runner_name: "SP: etl-runner", data_product: "pricing-curves", desk: "rates", attribution_method: "ENDPOINT_MAPPING", first_seen: "2026-05-01", last_seen: "2026-05-28", dbus: 850, cost: 800 },
    { endpoint_name: null, serving_type: null, usage_category: "VECTOR_SEARCH", workspace_id: "1111111111111111", runner: "maria.wisniewska@example.com", runner_name: "Maria Wiśniewska", data_product: "var-engine", desk: "risk", attribution_method: "TAG", first_seen: "2026-05-05", last_seen: "2026-05-24", dbus: 900, cost: 610 },
    // experimental endpoint nobody claimed, run by an unmapped user — the
    // run-as column shows the raw identity; mapping karol would route this
    // spend to his desk as AD_HOC via the USER rule (serving rows carry no
    // job_id, so rule 6 applies exactly as it does for serverless ad-hoc)
    { endpoint_name: "ml-experiments-llm", serving_type: "REALTIME_INFERENCE", usage_category: "MODEL_SERVING", workspace_id: "3333333333333333", runner: "karol.adamski@example.com", runner_name: null, data_product: "UNALLOCATED", desk: "UNALLOCATED", attribution_method: "NONE", first_seen: "2026-05-09", last_seen: "2026-05-22", dbus: 700, cost: 520 },
  ];

  // DBU reservation plans: date windows discounting the DBU list price.
  // The mock's monthly figures are static and do NOT re-price when these
  // change — the fixtures only exercise the admin CRUD screens.
  const dbuDiscounts: DbuDiscountRow[] = [
    { valid_from: "2025-12-08", valid_to: "2026-06-12", discount_pct: 0.27, note: "FY26 DBU reservation, PO-88231", mapped_by: "steward@example.com", mapped_at: "2025-12-01T09:00:00Z" },
  ];

  // ---- monthly chargeback: base matrix scaled per month ----
  // [domain, product, desk, category, runners, dbus, cost]
  const base: [string, string, string, string, number, number, number][] = [
    ["market-data", "pricing-curves", "rates", "JOBS", 3, 41000, 18200],
    ["market-data", "pricing-curves", "rates", "SQL_WAREHOUSE", 7, 12400, 5300],
    ["market-data", "ref-data-ingest", "rates", "JOBS", 2, 28800, 12700],
    ["market-data", "ref-data-ingest", "rates", "DLT", 1, 9800, 4600],
    ["risk", "var-engine", "risk", "JOBS", 2, 52300, 24100],
    ["risk", "var-engine", "risk", "SQL_WAREHOUSE", 4, 15600, 7100],
    // stress-testing fans out 70/30 across risk and credit (cost_split_pct)
    ["risk", "stress-testing", "risk", "JOBS", 1, 8330, 3780],
    ["risk", "stress-testing", "credit", "JOBS", 1, 3570, 1620],
    ["pnl", "trade-pnl", "credit", "JOBS", 3, 33400, 15200],
    ["pnl", "trade-pnl", "credit", "MODEL_SERVING", 1, 4100, 2300],
    // AI spend: ai_query batch extraction endpoint + realtime slice (outage-extraction),
    // an embedding endpoint routed by the endpoint bridge (pricing-curves),
    // vector search on var-engine, and one unmapped experimental endpoint
    ["market-data", "outage-extraction", "risk", "MODEL_SERVING", 2, 5200, 4900],
    ["market-data", "pricing-curves", "rates", "MODEL_SERVING", 1, 850, 800],
    ["risk", "var-engine", "risk", "VECTOR_SEARCH", 1, 900, 610],
    ["UNALLOCATED", "UNALLOCATED", "UNALLOCATED", "MODEL_SERVING", 1, 700, 520],
    ["UNALLOCATED", "AD_HOC", "rates", "SQL_WAREHOUSE", 9, 8900, 3900],
    ["UNALLOCATED", "AD_HOC", "risk", "SQL_WAREHOUSE", 5, 5200, 2400],
    ["UNALLOCATED", "AD_HOC", "credit", "SQL_WAREHOUSE", 4, 3800, 1700],
    ["UNALLOCATED", "UNALLOCATED", "UNALLOCATED", "JOBS", 2, 7400, 3300],
    ["UNALLOCATED", "UNALLOCATED", "UNALLOCATED", "SQL_WAREHOUSE", 0, 4900, 2200],
  ];
  // exported as monthFactor: the AI DAL scales endpoint fixtures by it too
  const factor: Record<string, number> = {
    "2026-01": 0.78, "2026-02": 0.84, "2026-03": 0.9,
    "2026-04": 0.92, "2026-05": 1.0, "2026-06": 1.08, "2026-07": 0.07,
  };
  const monthly: MonthlyChargebackRow[] = months.flatMap((m) =>
    base.map(([domain, product, desk, cat, runners, dbus, cost]) => ({
      billing_month: m,
      data_domain: domain,
      data_product: product,
      desk,
      usage_category: cat,
      distinct_runners: runners,
      total_dbus: Math.round(dbus * factor[m]),
      total_cost: Math.round(cost * factor[m] * 100) / 100,
    })),
  );

  // How every Azure resource with 30d cost attributed — one row per
  // (resource, method, product). adf-pnl-prod shows two rows on purpose:
  // bridge-mapped early in the window, tagged at source since (janitor).
  const azureAttributions: AzureResourceAttributionRow[] = [
    { subscription_id: "1f2e3d4c-aaaa-4bbb-8ccc-111122223333", resource_group: "rg-mktdata-prod", resource_id: "/subscriptions/1f2e3d4c-aaaa-4bbb-8ccc-111122223333/resourcegroups/rg-mktdata-prod/providers/microsoft.databricks/workspaces/dbw-mktdata-prod", resource_name: "dbw-mktdata-prod", meter_category: "Azure Databricks", attribution_method: "TAG", data_product: "pricing-curves", desk: "rates", tags_json: "{\"Environment\":\"prod\",\"application\":\"curves\",\"data_product\":\"pricing-curves\"}", cost_30d: 6400 },
    { subscription_id: "1f2e3d4c-aaaa-4bbb-8ccc-111122223333", resource_group: "rg-mktdata-prod", resource_id: "/subscriptions/1f2e3d4c-aaaa-4bbb-8ccc-111122223333/resourcegroups/rg-mktdata-prod/providers/microsoft.storage/storageaccounts/stmktdatarefprod", resource_name: "stmktdatarefprod", meter_category: "Storage", attribution_method: "RESOURCE_MAPPING", data_product: "ref-data-ingest", desk: "rates", tags_json: "{\"Environment\":\"prod\"}", cost_30d: 2350 },
    { subscription_id: "1f2e3d4c-aaaa-4bbb-8ccc-111122223333", resource_group: "rg-mktdata-prod", resource_id: "/subscriptions/1f2e3d4c-aaaa-4bbb-8ccc-111122223333/resourcegroups/rg-mktdata-prod/providers/microsoft.compute/virtualmachines/vm-curves-calc-01", resource_name: "vm-curves-calc-01", meter_category: "Virtual Machines", attribution_method: "TAG_RULE", data_product: "pricing-curves", desk: "rates", tags_json: "{\"Environment\":\"prod\",\"application\":\"curves\"}", cost_30d: 3120 },
    { subscription_id: "1f2e3d4c-aaaa-4bbb-8ccc-111122223333", resource_group: "rg-risk-var", resource_id: "/subscriptions/1f2e3d4c-aaaa-4bbb-8ccc-111122223333/resourcegroups/rg-risk-var/providers/microsoft.compute/virtualmachinescalesets/vmss-var-grid", resource_name: "vmss-var-grid", meter_category: "Virtual Machines", attribution_method: "RESOURCE_GROUP", data_product: "var-engine", desk: "risk", tags_json: "{\"Environment\":\"prod\",\"team\":\"risk-eng\"}", cost_30d: 9800 },
    { subscription_id: "1f2e3d4c-aaaa-4bbb-8ccc-111122223333", resource_group: "rg-risk-var", resource_id: "/subscriptions/1f2e3d4c-aaaa-4bbb-8ccc-111122223333/resourcegroups/rg-risk-var/providers/microsoft.storage/storageaccounts/stvarresults", resource_name: "stvarresults", meter_category: "Storage", attribution_method: "RESOURCE_GROUP", data_product: "var-engine", desk: "risk", tags_json: null, cost_30d: 740 },
    // stress-lab subscription rule fans 70/30 across risk and credit in the
    // real view; the mock keeps the primary desk (largest share), like jobs
    { subscription_id: "9e8d7c6b-bbbb-4ccc-8ddd-444455556666", resource_group: "rg-stress-lab", resource_id: "/subscriptions/9e8d7c6b-bbbb-4ccc-8ddd-444455556666/resourcegroups/rg-stress-lab/providers/microsoft.compute/virtualmachinescalesets/vmss-stress-workers", resource_name: "vmss-stress-workers", meter_category: "Virtual Machines", attribution_method: "SUBSCRIPTION", data_product: "stress-testing", desk: "risk", tags_json: "{\"Environment\":\"prod\"}", cost_30d: 4200 },
    // tagged at source AND still bridge-attributed within the window
    { subscription_id: "1f2e3d4c-aaaa-4bbb-8ccc-111122223333", resource_group: "rg-pnl-prod", resource_id: "/subscriptions/1f2e3d4c-aaaa-4bbb-8ccc-111122223333/resourcegroups/rg-pnl-prod/providers/microsoft.datafactory/factories/adf-pnl-prod", resource_name: "adf-pnl-prod", meter_category: "Data Factory", attribution_method: "TAG", data_product: "trade-pnl", desk: "credit", tags_json: "{\"Environment\":\"prod\",\"data_product\":\"trade-pnl\"}", cost_30d: 1650 },
    { subscription_id: "1f2e3d4c-aaaa-4bbb-8ccc-111122223333", resource_group: "rg-pnl-prod", resource_id: "/subscriptions/1f2e3d4c-aaaa-4bbb-8ccc-111122223333/resourcegroups/rg-pnl-prod/providers/microsoft.datafactory/factories/adf-pnl-prod", resource_name: "adf-pnl-prod", meter_category: "Data Factory", attribution_method: "RESOURCE_MAPPING", data_product: "trade-pnl", desk: "credit", tags_json: null, cost_30d: 980 },
    // unmatched remainder — visible in coverage, never billed to a desk
    { subscription_id: "1f2e3d4c-aaaa-4bbb-8ccc-111122223333", resource_group: "rg-shared-platform", resource_id: "/subscriptions/1f2e3d4c-aaaa-4bbb-8ccc-111122223333/resourcegroups/rg-shared-platform/providers/microsoft.containerservice/managedclusters/aks-shared-01", resource_name: "aks-shared-01", meter_category: "Azure Kubernetes Service", attribution_method: "NONE", data_product: "UNALLOCATED", desk: "UNALLOCATED", tags_json: "{\"Environment\":\"prod\",\"team\":\"platform\"}", cost_30d: 5600 },
    { subscription_id: "1f2e3d4c-aaaa-4bbb-8ccc-111122223333", resource_group: "rg-shared-platform", resource_id: "/subscriptions/1f2e3d4c-aaaa-4bbb-8ccc-111122223333/resourcegroups/rg-shared-platform/providers/microsoft.operationalinsights/workspaces/log-shared-prod", resource_name: "log-shared-prod", meter_category: "Log Analytics", attribution_method: "NONE", data_product: "UNALLOCATED", desk: "UNALLOCATED", tags_json: null, cost_30d: 1900 },
    { subscription_id: "1f2e3d4c-aaaa-4bbb-8ccc-111122223333", resource_group: "rg-mktdata-dev", resource_id: "/subscriptions/1f2e3d4c-aaaa-4bbb-8ccc-111122223333/resourcegroups/rg-mktdata-dev/providers/microsoft.databricks/workspaces/dbw-mktdata-dev", resource_name: "dbw-mktdata-dev", meter_category: "Azure Databricks", attribution_method: "NONE", data_product: "UNALLOCATED", desk: "UNALLOCATED", tags_json: "{\"Environment\":\"dev\"}", cost_30d: 830 },
  ];

  // Azure bill = fact = report per month (attribution is lossless: splits sum
  // to 1 and UNALLOCATED stays in the fact) — derived from the fixtures above
  // so it always matches what the /azure screen shows for the same month.
  const azureBase = azureAttributions.reduce((s, a) => s + a.cost_30d, 0);
  const azureRecon: ReconRow[] = months.map((m) => {
    const total = Math.round(azureBase * factor[m] * 100) / 100;
    return {
      billing_month: m,
      billing_cost: total,
      fact_cost: total,
      report_cost: total,
      fact_gap: 0,
      report_gap: 0,
    };
  });

  // ---- attribution coverage: shares improving slightly over time ----
  const coverage: CoverageRow[] = months.flatMap((m, i) => {
    const monthTotal = monthly
      .filter((r) => r.billing_month === m)
      .reduce((s, r) => s + r.total_cost, 0);
    // TAG grows ~1.5pp/month at NONE+JOB_MAPPING's expense
    const drift = i * 0.015;
    const adj: Record<string, number> = {
      TAG: 0.6 + drift,
      JOB_MAPPING: 0.12 - drift / 2,
      TAG_RULE: 0.04,
      WAREHOUSE_MAPPING: 0.06,
      ENDPOINT_MAPPING: 0.02, // dedicated AI/serving endpoints (rule 4b)
      RUNNER_RULE: 0.03,
      USER: 0.06, // ad-hoc only — job spend never lands here
      NONE: 0.07 - drift / 2,
    };
    return (Object.keys(adj) as (keyof typeof adj)[]).map((method) => ({
      billing_month: m,
      attribution_method: method as CoverageRow["attribution_method"],
      cost: Math.round(monthTotal * adj[method] * 100) / 100,
      pct_of_month: adj[method],
    }));
  });

  const detail: Record<string, DetailRow[]> = {
    "pricing-curves": [
      { usage_category: "JOBS", is_serverless: false, job_name: "curves-build-eod", warehouse_id: null, endpoint_name: null, runner_name: "SP: etl-runner", attribution_method: "TAG", dbus: 22100, cost: 9800 },
      { usage_category: "JOBS", is_serverless: true, job_name: "curves-intraday-refresh", warehouse_id: null, endpoint_name: null, runner_name: "SP: etl-runner", attribution_method: "TAG", dbus: 12800, cost: 6100 },
      { usage_category: "SQL_WAREHOUSE", is_serverless: null, job_name: null, warehouse_id: "wh-shared-main", endpoint_name: null, runner_name: "Anna Kowalska", attribution_method: "TAG", dbus: 7500, cost: 3200 },
      { usage_category: "JOBS", is_serverless: false, job_name: "curves-backfill", warehouse_id: null, endpoint_name: null, runner_name: "Jan Nowak", attribution_method: "TAG", dbus: 5200, cost: 2300 },
      { usage_category: "JOBS", is_serverless: true, job_name: "curves-cache-warm", warehouse_id: null, endpoint_name: null, runner_name: "SP: etl-runner", attribution_method: "RUNNER_RULE", dbus: 3400, cost: 1500 },
      { usage_category: "SQL_WAREHOUSE", is_serverless: null, job_name: null, warehouse_id: "wh-shared-main", endpoint_name: null, runner_name: "Jan Nowak", attribution_method: "TAG", dbus: 4900, cost: 2100 },
      { usage_category: "MODEL_SERVING", is_serverless: true, job_name: null, warehouse_id: null, endpoint_name: "curves-embedding-api", runner_name: "SP: etl-runner", attribution_method: "ENDPOINT_MAPPING", dbus: 850, cost: 800 },
    ],
    "ref-data-ingest": [
      { usage_category: "JOBS", is_serverless: false, job_name: "refdata-loader (job 845)", warehouse_id: null, endpoint_name: null, runner_name: "SP: etl-runner", attribution_method: "JOB_MAPPING", dbus: 20200, cost: 8900 },
      { usage_category: "DLT", is_serverless: true, job_name: "refdata-dlt-pipeline", warehouse_id: null, endpoint_name: null, runner_name: "SP: etl-runner", attribution_method: "TAG", dbus: 9800, cost: 4600 },
      { usage_category: "JOBS", is_serverless: true, job_name: "refdata-validation", warehouse_id: null, endpoint_name: null, runner_name: "Jan Nowak", attribution_method: "TAG", dbus: 8600, cost: 3800 },
      { usage_category: "JOBS", is_serverless: true, job_name: "refdata-quality-scan", warehouse_id: null, endpoint_name: null, runner_name: "SP: etl-runner", attribution_method: "TAG_RULE", dbus: 4300, cost: 1900 },
    ],
    "var-engine": [
      { usage_category: "JOBS", is_serverless: false, job_name: "nightly-var (job 310)", warehouse_id: null, endpoint_name: null, runner_name: "Maria Wiśniewska", attribution_method: "JOB_MAPPING", dbus: 33900, cost: 15600 },
      { usage_category: "SQL_WAREHOUSE", is_serverless: null, job_name: null, warehouse_id: "wh-risk-dedicated", endpoint_name: null, runner_name: "Maria Wiśniewska", attribution_method: "WAREHOUSE_MAPPING", dbus: 11900, cost: 5400 },
      { usage_category: "SQL_WAREHOUSE", is_serverless: null, job_name: null, warehouse_id: "wh-risk-dedicated", endpoint_name: null, runner_name: "UNALLOCATED_IDLE", attribution_method: "WAREHOUSE_MAPPING", dbus: 3700, cost: 1700 },
      { usage_category: "JOBS", is_serverless: true, job_name: "var-scenario-expansion", warehouse_id: null, endpoint_name: null, runner_name: "Maria Wiśniewska", attribution_method: "TAG", dbus: 18400, cost: 8500 },
      { usage_category: "VECTOR_SEARCH", is_serverless: true, job_name: null, warehouse_id: null, endpoint_name: null, runner_name: "Maria Wiśniewska", attribution_method: "TAG", dbus: 900, cost: 610 },
    ],
    "stress-testing": [
      { usage_category: "JOBS", is_serverless: false, job_name: "stress-quarterly", warehouse_id: null, endpoint_name: null, runner_name: "Maria Wiśniewska", attribution_method: "TAG", dbus: 11900, cost: 5400 },
    ],
    "outage-extraction": [
      { usage_category: "MODEL_SERVING", is_serverless: true, job_name: null, warehouse_id: null, endpoint_name: "outage-alerts-extract-sonnet4", runner_name: "Sara Subramaniam", attribution_method: "TAG", dbus: 4400, cost: 4100 },
      { usage_category: "MODEL_SERVING", is_serverless: true, job_name: null, warehouse_id: null, endpoint_name: "outage-alerts-extract-sonnet4", runner_name: "Sara Subramaniam", attribution_method: "TAG", dbus: 800, cost: 800 },
    ],
    "trade-pnl": [
      { usage_category: "JOBS", is_serverless: false, job_name: "pnl-explain (job 1022)", warehouse_id: null, endpoint_name: null, runner_name: "Piotr Zieliński", attribution_method: "JOB_MAPPING", dbus: 20300, cost: 9200 },
      { usage_category: "JOBS", is_serverless: true, job_name: "pnl-eod-close", warehouse_id: null, endpoint_name: null, runner_name: "SP: etl-runner", attribution_method: "TAG", dbus: 13100, cost: 6000 },
      { usage_category: "MODEL_SERVING", is_serverless: true, job_name: null, warehouse_id: null, endpoint_name: "pnl-anomaly-endpoint", runner_name: "Piotr Zieliński", attribution_method: "TAG", dbus: 4100, cost: 2300 },
    ],
    AD_HOC: [
      { usage_category: "SQL_WAREHOUSE", is_serverless: null, job_name: null, warehouse_id: "wh-shared-adhoc", endpoint_name: null, runner_name: "Anna Kowalska", attribution_method: "USER", dbus: 5900, cost: 2600 },
      { usage_category: "SQL_WAREHOUSE", is_serverless: null, job_name: null, warehouse_id: "wh-shared-main", endpoint_name: null, runner_name: "Maria Wiśniewska", attribution_method: "USER", dbus: 5200, cost: 2400 },
      { usage_category: "SQL_WAREHOUSE", is_serverless: null, job_name: null, warehouse_id: "wh-shared-adhoc", endpoint_name: null, runner_name: "Piotr Zieliński", attribution_method: "USER", dbus: 3800, cost: 1700 },
    ],
    UNALLOCATED: [
      { usage_category: "JOBS", is_serverless: false, job_name: "unknown-batch-77", warehouse_id: null, endpoint_name: null, runner_name: null, attribution_method: "NONE", dbus: 7400, cost: 3300 },
      { usage_category: "SQL_WAREHOUSE", is_serverless: null, job_name: null, warehouse_id: "wh-shared-main", endpoint_name: null, runner_name: "UNALLOCATED_IDLE", attribution_method: "NONE", dbus: 4900, cost: 2200 },
      { usage_category: "MODEL_SERVING", is_serverless: true, job_name: null, warehouse_id: null, endpoint_name: "ml-experiments-llm", runner_name: null, attribution_method: "NONE", dbus: 700, cost: 520 },
    ],
  };

  return {
    months,
    monthFactor: factor,
    publishedMonths: ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"],
    catalogue,
    users,
    workspaces,
    jobMappings,
    tagRules,
    runnerRules,
    warehouseMappings,
    endpointMappings,
    pipelineMappings,
    aiEndpointUsage,
    dbuDiscounts,
    monthly,
    coverage,
    detail,
    queueUntaggedJobs: [
      { usage_category: "JOBS", workspace_id: "2222222222222222", work_item: "unknown-batch-77", job_id: "77", runner: "9a1b2c3d-svc-legacy", unallocated_cost_30d: 3300 },
      { usage_category: "JOBS", workspace_id: "1111111111111111", work_item: "ml-feature-refresh", job_id: "1544", runner: "tomasz.lis@example.com", unallocated_cost_30d: 2100 },
      { usage_category: "DLT", workspace_id: "3333333333333333", work_item: "sandbox-cdc-pipeline", job_id: "88", runner: "ewa.mazur@example.com", unallocated_cost_30d: 940 },
      { usage_category: "JOBS", workspace_id: "1111111111111111", work_item: "adhoc-export-2199", job_id: "2199", runner: "tomasz.lis@example.com", unallocated_cost_30d: 410 },
    ],
    queueUnknownRunners: [
      { runner: "tomasz.lis@example.com", cost_30d: 2510, rows_30d: 64 },
      { runner: "ewa.mazur@example.com", cost_30d: 940, rows_30d: 18 },
      { runner: "9a1b2c3d-svc-legacy", cost_30d: 3300, rows_30d: 31 },
      // GUID-only service principal on classic job compute — no display name, no serverless spend
      { runner: "f3b825e2-6a10-4c4d-9d3f-8a51e2c4a0b7", cost_30d: 4150, rows_30d: 58 },
    ],
    queueUnknownWorkspaces: [
      { workspace_id: "4444444444444444", dbus_30d: 5120 },
    ],
    queueRogueTags: [
      { raw_tag_data_product: "pricing_curves", cost_30d: 1830, rows_30d: 22 }, // typo: underscore
      { raw_tag_data_product: "fx-analytics", cost_30d: 4200, rows_30d: 57 },   // unregistered product
    ],
    queueUnassignedWarehouses: [
      { warehouse_id: "wh-quant-research", workspace_id: "1111111111111111", cost_30d: 6800, idle_share: 0.41 },
      { warehouse_id: "wh-reporting-bi", workspace_id: "1111111111111111", cost_30d: 3900, idle_share: 0.22 },
    ],
    // ALL runners with 30d spend absent from user_mapping, serverless slice
    // broken out. The f3b825e2… GUID service principal runs classic job
    // compute only (serverless_cost_30d: 0) — the row the old serverless-only
    // scan used to hide. karol has serverless-only spend below the
    // unknown-runners queue radar.
    unmappedRunners: [
      { runner: "f3b825e2-6a10-4c4d-9d3f-8a51e2c4a0b7", cost_30d: 4150, serverless_cost_30d: 0, dbus_30d: 9200, rows_30d: 58, workspace_count: 1, top_category: "JOBS", last_seen: "2026-07-02" },
      { runner: "9a1b2c3d-svc-legacy", cost_30d: 3300, serverless_cost_30d: 610, dbus_30d: 7300, rows_30d: 31, workspace_count: 1, top_category: "JOBS", last_seen: "2026-06-27" },
      { runner: "tomasz.lis@example.com", cost_30d: 2510, serverless_cost_30d: 1890, dbus_30d: 5480, rows_30d: 64, workspace_count: 2, top_category: "JOBS", last_seen: "2026-07-02" },
      { runner: "ewa.mazur@example.com", cost_30d: 940, serverless_cost_30d: 940, dbus_30d: 2050, rows_30d: 18, workspace_count: 1, top_category: "DLT", last_seen: "2026-07-01" },
      { runner: "karol.adamski@example.com", cost_30d: 240, serverless_cost_30d: 240, dbus_30d: 460, rows_30d: 6, workspace_count: 1, top_category: "MODEL_SERVING", last_seen: "2026-06-30" },
    ],
    // How every job with 30d cost attributed. pnl-explain (1022) shows two
    // rows on purpose: bridge-mapped early in the window, tagged at source
    // since — the same story the janitor panel tells. tags_json mirrors what
    // cost_fact exposes: the job's actual custom tags (null = untagged).
    jobAttributions: [
      { workspace_id: "1111111111111111", job_id: "310", job_name: "nightly-var", attribution_method: "JOB_MAPPING", data_product: "var-engine", desk: "risk", tags_json: null, dbus_30d: 33900, cost_30d: 15600 },
      // carries the full boilerplate platform tag set real jobs inherit from
      // Azure policy — exercises the collapsed "+N more" tag display
      { workspace_id: "1111111111111111", job_id: "501", job_name: "curves-build-eod", attribution_method: "TAG", data_product: "pricing-curves", desk: "rates", tags_json: "{\"AdminSiteCode\":\"GBLDN\",\"AdminSiteName\":\"London\",\"BusinessFunction\":\"IT\",\"BusinessUnit\":\"OilMarketing\",\"BusinessUnitBudgetOwner\":\"warren.blount@example.com\",\"Company\":\"ExampleUK\",\"Environment\":\"prod\",\"ITPortfolio\":\"FOIT\",\"ManagedBy\":\"ARM\",\"RepositoryName\":\"example-azureplatform-foit-config\",\"data_product\":\"pricing-curves\",\"team\":\"market-data-eng\"}", dbus_30d: 22100, cost_30d: 9800 },
      { workspace_id: "2222222222222222", job_id: "845", job_name: "refdata-loader", attribution_method: "JOB_MAPPING", data_product: "ref-data-ingest", desk: "rates", tags_json: "{\"Environment\":\"prod\"}", dbus_30d: 20200, cost_30d: 8900 },
      { workspace_id: "1111111111111111", job_id: "918", job_name: "var-scenario-expansion", attribution_method: "TAG", data_product: "var-engine", desk: "risk", tags_json: "{\"data_product\":\"var-engine\",\"team\":\"risk-eng\"}", dbus_30d: 18400, cost_30d: 8500 },
      { workspace_id: "1111111111111111", job_id: "502", job_name: "curves-intraday-refresh", attribution_method: "TAG", data_product: "pricing-curves", desk: "rates", tags_json: "{\"data_product\":\"pricing-curves\"}", dbus_30d: 12800, cost_30d: 6100 },
      { workspace_id: "2222222222222222", job_id: "640", job_name: "pnl-eod-close", attribution_method: "TAG", data_product: "trade-pnl", desk: "credit", tags_json: "{\"Environment\":\"prod\",\"data_product\":\"trade-pnl\"}", dbus_30d: 13100, cost_30d: 6000 },
      { workspace_id: "1111111111111111", job_id: "733", job_name: "stress-quarterly", attribution_method: "TAG", data_product: "stress-testing", desk: "risk", tags_json: "{\"data_product\":\"stress-testing\"}", dbus_30d: 11900, cost_30d: 5400 },
      { workspace_id: "2222222222222222", job_id: "1022", job_name: "pnl-explain", attribution_method: "TAG", data_product: "trade-pnl", desk: "credit", tags_json: "{\"data_product\":\"trade-pnl\"}", dbus_30d: 10700, cost_30d: 4870 },
      { workspace_id: "2222222222222222", job_id: "1022", job_name: "pnl-explain", attribution_method: "JOB_MAPPING", data_product: "trade-pnl", desk: "credit", tags_json: null, dbus_30d: 9600, cost_30d: 4330 },
      // attributed by the team=market-data-eng tag rule — tagged, just not with data_product
      { workspace_id: "2222222222222222", job_id: "930", job_name: "refdata-quality-scan", attribution_method: "TAG_RULE", data_product: "ref-data-ingest", desk: "rates", tags_json: "{\"Environment\":\"prod\",\"team\":\"market-data-eng\"}", dbus_30d: 4300, cost_30d: 1900 },
      // attributed by the runner rule on the etl-runner service principal
      { workspace_id: "1111111111111111", job_id: "512", job_name: "curves-cache-warm", attribution_method: "RUNNER_RULE", data_product: "pricing-curves", desk: "rates", tags_json: null, dbus_30d: 3400, cost_30d: 1500 },
      { workspace_id: "2222222222222222", job_id: "77", job_name: "unknown-batch-77", attribution_method: "NONE", data_product: "UNALLOCATED", desk: "UNALLOCATED", tags_json: null, dbus_30d: 7400, cost_30d: 3300 },
      { workspace_id: "1111111111111111", job_id: "1544", job_name: "ml-feature-refresh", attribution_method: "NONE", data_product: "UNALLOCATED", desk: "UNALLOCATED", tags_json: "{\"Environment\":\"dev\",\"team\":\"ml-platform\"}", dbus_30d: 4700, cost_30d: 2100 },
      { workspace_id: "3333333333333333", job_id: "88", job_name: "sandbox-cdc-pipeline", attribution_method: "NONE", data_product: "UNALLOCATED", desk: "UNALLOCATED", tags_json: null, dbus_30d: 2100, cost_30d: 940 },
      { workspace_id: "1111111111111111", job_id: "2199", job_name: "adhoc-export-2199", attribution_method: "NONE", data_product: "UNALLOCATED", desk: "UNALLOCATED", tags_json: "{\"Environment\":\"dev\"}", dbus_30d: 920, cost_30d: 410 },
    ],
    // ---- Azure attribution (azure_cost_fact fixtures) ----
    // Two subscriptions; ARM ids lowercase exactly as azure_usage_view emits.
    azureResourceMappings: [
      // bridge still doing work: unt-tagged ADLS account feeding ref-data
      { resource_id: "/subscriptions/1f2e3d4c-aaaa-4bbb-8ccc-111122223333/resourcegroups/rg-mktdata-prod/providers/microsoft.storage/storageaccounts/stmktdatarefprod", data_product: "ref-data-ingest", note: "legacy ADLS account, tagging ticket INFRA-2214", mapped_by: "steward@example.com", mapped_at: "2026-05-08T09:30:00Z" },
      // janitor demo: the ADF below is now tagged at source — bridge redundant
      { resource_id: "/subscriptions/1f2e3d4c-aaaa-4bbb-8ccc-111122223333/resourcegroups/rg-pnl-prod/providers/microsoft.datafactory/factories/adf-pnl-prod", data_product: "trade-pnl", note: "mapped before tags landed", mapped_by: "steward@example.com", mapped_at: "2026-04-15T14:12:00Z" },
    ],
    azureTagRules: [
      { tag_key: "application", tag_value: "curves", data_product: "pricing-curves", note: "platform tags application, not data_product", mapped_by: "steward@example.com", mapped_at: "2026-05-20T11:20:00Z" },
    ],
    azureRgRules: [
      { subscription_id: "1f2e3d4c-aaaa-4bbb-8ccc-111122223333", resource_group: "rg-risk-var", data_product: "var-engine", note: "whole RG is the VaR grid", mapped_by: "steward@example.com", mapped_at: "2026-06-02T10:05:00Z" },
    ],
    azureSubscriptionRules: [
      { subscription_id: "9e8d7c6b-bbbb-4ccc-8ddd-444455556666", data_product: "stress-testing", note: "dedicated stress-lab subscription", mapped_by: "steward@example.com", mapped_at: "2026-06-10T15:40:00Z" },
    ],
    azureAttributions,
    azureRecon,
    // billing/fact/report totals mirror the monthly matrix above (sum of base
    // × monthFactor) with deliberate sub-dollar gaps — recompute when base changes
    recon: [
      { billing_month: "2026-01", billing_cost: 89879.4, fact_cost: 89879.4, report_cost: 89879.4, fact_gap: 0, report_gap: 0 },
      { billing_month: "2026-02", billing_cost: 96793.2, fact_cost: 96793.2, report_cost: 96793.2, fact_gap: 0, report_gap: 0 },
      { billing_month: "2026-03", billing_cost: 103707.12, fact_cost: 103707, report_cost: 103707, fact_gap: 0.12, report_gap: 0.12 },
      { billing_month: "2026-04", billing_cost: 106011.6, fact_cost: 106011.6, report_cost: 106011.6, fact_gap: 0, report_gap: 0 },
      { billing_month: "2026-05", billing_cost: 115229.66, fact_cost: 115230, report_cost: 115230, fact_gap: -0.34, report_gap: -0.34 },
      { billing_month: "2026-06", billing_cost: 124448.91, fact_cost: 124448.4, report_cost: 124448.4, fact_gap: 0.51, report_gap: 0.51 },
    ],
  };
}

const g = globalThis as unknown as { __chargebackMockStore?: MockStore };
export const mockStore: MockStore = (g.__chargebackMockStore ??= createStore());
