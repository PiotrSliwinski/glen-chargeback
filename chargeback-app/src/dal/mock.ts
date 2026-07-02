import type {
  CoverageRow,
  DataProductRow,
  DetailRow,
  JobMappingRow,
  MonthlyChargebackRow,
  ReconRow,
  RogueTagRow,
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
  publishedMonths: string[];
  catalogue: DataProductRow[];
  users: UserMappingRow[];
  workspaces: WorkspaceMappingRow[];
  jobMappings: JobMappingRow[];
  warehouseMappings: WarehouseMappingRow[];
  monthly: MonthlyChargebackRow[];
  coverage: CoverageRow[];
  detail: Record<string, DetailRow[]>; // by data_product
  queueUntaggedJobs: UntaggedJobRow[];
  queueUnknownRunners: UnknownRunnerRow[];
  queueUnknownWorkspaces: UnknownWorkspaceRow[];
  queueRogueTags: RogueTagRow[];
  queueUnassignedWarehouses: UnassignedWarehouseRow[];
  recon: ReconRow[];
}

function createStore(): MockStore {
  const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];

  const catalogue: DataProductRow[] = [
    // pricing-curves moved desk fx -> rates on 2026-05-01: two validity rows
    { data_product: "pricing-curves", data_domain: "market-data", desk: "fx", product_owner: "anna.kowalska@example.com", valid_from: "2025-10-01", valid_to: "2026-05-01", mapped_by: "steward@example.com", mapped_at: "2026-04-20T10:00:00Z" },
    { data_product: "pricing-curves", data_domain: "market-data", desk: "rates", product_owner: "anna.kowalska@example.com", valid_from: "2026-05-01", valid_to: null, mapped_by: "steward@example.com", mapped_at: "2026-04-20T10:00:00Z" },
    { data_product: "ref-data-ingest", data_domain: "market-data", desk: "rates", product_owner: "jan.nowak@example.com", valid_from: "2025-10-01", valid_to: null, mapped_by: null, mapped_at: null },
    { data_product: "var-engine", data_domain: "risk", desk: "risk", product_owner: "maria.wisniewska@example.com", valid_from: "2025-10-01", valid_to: null, mapped_by: null, mapped_at: null },
    { data_product: "stress-testing", data_domain: "risk", desk: "risk", product_owner: "maria.wisniewska@example.com", valid_from: "2026-01-01", valid_to: null, mapped_by: null, mapped_at: null },
    { data_product: "trade-pnl", data_domain: "pnl", desk: "credit", product_owner: "piotr.zielinski@example.com", valid_from: "2025-10-01", valid_to: null, mapped_by: null, mapped_at: null },
  ];

  const users: UserMappingRow[] = [
    { user_id: "anna.kowalska@example.com", user_name: "Anna Kowalska", desk: "rates" },
    { user_id: "jan.nowak@example.com", user_name: "Jan Nowak", desk: "rates" },
    { user_id: "maria.wisniewska@example.com", user_name: "Maria Wiśniewska", desk: "risk" },
    { user_id: "piotr.zielinski@example.com", user_name: "Piotr Zieliński", desk: "credit" },
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

  const warehouseMappings: WarehouseMappingRow[] = [
    { warehouse_id: "wh-risk-dedicated", data_product: "var-engine", is_shared: false },
    { warehouse_id: "wh-shared-main", data_product: null, is_shared: true },
    { warehouse_id: "wh-shared-adhoc", data_product: null, is_shared: true },
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
    ["risk", "stress-testing", "risk", "JOBS", 1, 11900, 5400],
    ["pnl", "trade-pnl", "credit", "JOBS", 3, 33400, 15200],
    ["pnl", "trade-pnl", "credit", "MODEL_SERVING", 1, 4100, 2300],
    ["UNALLOCATED", "AD_HOC", "rates", "SQL_WAREHOUSE", 9, 8900, 3900],
    ["UNALLOCATED", "AD_HOC", "risk", "SQL_WAREHOUSE", 5, 5200, 2400],
    ["UNALLOCATED", "AD_HOC", "credit", "SQL_WAREHOUSE", 4, 3800, 1700],
    ["UNALLOCATED", "UNALLOCATED", "UNALLOCATED", "JOBS", 2, 7400, 3300],
    ["UNALLOCATED", "UNALLOCATED", "UNALLOCATED", "SQL_WAREHOUSE", 0, 4900, 2200],
  ];
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

  // ---- attribution coverage: shares improving slightly over time ----
  const shares: [string, number][] = [
    ["TAG", 0.62], ["JOB_MAPPING", 0.14], ["WAREHOUSE_MAPPING", 0.08],
    ["USER", 0.09], ["NONE", 0.07],
  ];
  const coverage: CoverageRow[] = months.flatMap((m, i) => {
    const monthTotal = monthly
      .filter((r) => r.billing_month === m)
      .reduce((s, r) => s + r.total_cost, 0);
    // TAG grows ~1.5pp/month at NONE+JOB_MAPPING's expense
    const drift = i * 0.015;
    const adj: Record<string, number> = {
      TAG: shares[0][1] + drift,
      JOB_MAPPING: shares[1][1] - drift / 2,
      WAREHOUSE_MAPPING: shares[2][1],
      USER: shares[3][1],
      NONE: shares[4][1] - drift / 2,
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
      { usage_category: "JOBS", job_name: "curves-build-eod", warehouse_id: null, runner_name: "SP: etl-runner", attribution_method: "TAG", cost: 9800 },
      { usage_category: "JOBS", job_name: "curves-intraday-refresh", warehouse_id: null, runner_name: "SP: etl-runner", attribution_method: "TAG", cost: 6100 },
      { usage_category: "SQL_WAREHOUSE", job_name: null, warehouse_id: "wh-shared-main", runner_name: "Anna Kowalska", attribution_method: "TAG", cost: 3200 },
      { usage_category: "JOBS", job_name: "curves-backfill", warehouse_id: null, runner_name: "Jan Nowak", attribution_method: "TAG", cost: 2300 },
      { usage_category: "SQL_WAREHOUSE", job_name: null, warehouse_id: "wh-shared-main", runner_name: "Jan Nowak", attribution_method: "TAG", cost: 2100 },
    ],
    "ref-data-ingest": [
      { usage_category: "JOBS", job_name: "refdata-loader (job 845)", warehouse_id: null, runner_name: "SP: etl-runner", attribution_method: "JOB_MAPPING", cost: 8900 },
      { usage_category: "DLT", job_name: "refdata-dlt-pipeline", warehouse_id: null, runner_name: "SP: etl-runner", attribution_method: "TAG", cost: 4600 },
      { usage_category: "JOBS", job_name: "refdata-validation", warehouse_id: null, runner_name: "Jan Nowak", attribution_method: "TAG", cost: 3800 },
    ],
    "var-engine": [
      { usage_category: "JOBS", job_name: "nightly-var (job 310)", warehouse_id: null, runner_name: "Maria Wiśniewska", attribution_method: "JOB_MAPPING", cost: 15600 },
      { usage_category: "SQL_WAREHOUSE", job_name: null, warehouse_id: "wh-risk-dedicated", runner_name: "Maria Wiśniewska", attribution_method: "WAREHOUSE_MAPPING", cost: 5400 },
      { usage_category: "SQL_WAREHOUSE", job_name: null, warehouse_id: "wh-risk-dedicated", runner_name: "UNALLOCATED_IDLE", attribution_method: "WAREHOUSE_MAPPING", cost: 1700 },
      { usage_category: "JOBS", job_name: "var-scenario-expansion", warehouse_id: null, runner_name: "Maria Wiśniewska", attribution_method: "TAG", cost: 8500 },
    ],
    "stress-testing": [
      { usage_category: "JOBS", job_name: "stress-quarterly", warehouse_id: null, runner_name: "Maria Wiśniewska", attribution_method: "TAG", cost: 5400 },
    ],
    "trade-pnl": [
      { usage_category: "JOBS", job_name: "pnl-explain (job 1022)", warehouse_id: null, runner_name: "Piotr Zieliński", attribution_method: "JOB_MAPPING", cost: 9200 },
      { usage_category: "JOBS", job_name: "pnl-eod-close", warehouse_id: null, runner_name: "SP: etl-runner", attribution_method: "TAG", cost: 6000 },
      { usage_category: "MODEL_SERVING", job_name: "pnl-anomaly-endpoint", warehouse_id: null, runner_name: "Piotr Zieliński", attribution_method: "TAG", cost: 2300 },
    ],
    AD_HOC: [
      { usage_category: "SQL_WAREHOUSE", job_name: null, warehouse_id: "wh-shared-adhoc", runner_name: "Anna Kowalska", attribution_method: "USER", cost: 2600 },
      { usage_category: "SQL_WAREHOUSE", job_name: null, warehouse_id: "wh-shared-main", runner_name: "Maria Wiśniewska", attribution_method: "USER", cost: 2400 },
      { usage_category: "SQL_WAREHOUSE", job_name: null, warehouse_id: "wh-shared-adhoc", runner_name: "Piotr Zieliński", attribution_method: "USER", cost: 1700 },
    ],
    UNALLOCATED: [
      { usage_category: "JOBS", job_name: "unknown-batch-77", warehouse_id: null, runner_name: null, attribution_method: "NONE", cost: 3300 },
      { usage_category: "SQL_WAREHOUSE", job_name: null, warehouse_id: "wh-shared-main", runner_name: "UNALLOCATED_IDLE", attribution_method: "NONE", cost: 2200 },
    ],
  };

  return {
    months,
    publishedMonths: ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"],
    catalogue,
    users,
    workspaces,
    jobMappings,
    warehouseMappings,
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
    recon: [
      { billing_month: "2026-01", billing_cost: 79512.4, fact_cost: 79512.4, report_cost: 79512.4, fact_gap: 0, report_gap: 0 },
      { billing_month: "2026-02", billing_cost: 85628.61, fact_cost: 85628.61, report_cost: 85628.61, fact_gap: 0, report_gap: 0 },
      { billing_month: "2026-03", billing_cost: 91744.55, fact_cost: 91744.43, report_cost: 91744.43, fact_gap: 0.12, report_gap: 0.12 },
      { billing_month: "2026-04", billing_cost: 93783.29, fact_cost: 93783.29, report_cost: 93783.29, fact_gap: 0, report_gap: 0 },
      { billing_month: "2026-05", billing_cost: 101938.9, fact_cost: 101939.24, report_cost: 101939.24, fact_gap: -0.34, report_gap: -0.34 },
      { billing_month: "2026-06", billing_cost: 110094.5, fact_cost: 110093.99, report_cost: 110093.99, fact_gap: 0.51, report_gap: 0.51 },
    ],
  };
}

const g = globalThis as unknown as { __chargebackMockStore?: MockStore };
export const mockStore: MockStore = (g.__chargebackMockStore ??= createStore());
