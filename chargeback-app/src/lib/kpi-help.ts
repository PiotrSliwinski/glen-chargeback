/**
 * Centralised tooltip copy rendered by <InfoTip>: what each page does and how
 * each KPI is calculated. Kept in one module so the same figure is explained
 * identically everywhere it appears (dashboard, report pack, desk pages).
 * Sources referenced below are the derived views described in the Methodology
 * (§6 attribution waterfall, §7 checks, §9 publication).
 */

export const PAGE_HELP = {
  dashboard:
    "Landing view of the chargeback system: one month of Databricks spend — live from monthly_chargeback, or the frozen snapshot in Published mode — rolled up by data domain, with a 12-month trend and a breakdown of how cost was attributed. All figures are USD derived from Databricks system billing tables at list price, less any DBU reservation-plan discount configured under Reference data → DBU discounts.",
  report:
    "The distribution-ready monthly pack: executive summary, month-over-month movement by desk with auto-generated commentary, domain → product → desk breakdown, attribution coverage, and the per-desk tagging scorecard. Same figures as the dashboard for the selected month and mode. Print it, or download the XLSX workbook / CSVs at the bottom.",
  analytics:
    "Decision-support layer over the same monthly_chargeback figures, centred on who drives the bill: per-product and per-desk cost-driver tables (share, movement, $/DBU, concentration, 12-month sparklines), spend trajectory and run rate, unit economics ($/DBU) by usage category, month-over-month movers and the 12-month attribution-mix trend — with auto-generated plain-language findings. Trends always read live history; the selected month follows the Live/Published toggle.",
  drill:
    "Transparency drill-down: domain → products in that domain → the actual cost lines behind one product (top 200 slices of live cost_fact). Every line shows the attribution method that routed it here and whether it ran on serverless or classic compute — the answer to “why did this cost land where it did?”.",
  desks:
    "Self-service entry point for desk heads: every desk with cost in the selected month, live figures. Your own desk is highlighted and sorted first (matched via user_mapping on your sign-in email). Click a desk for its full breakdown and invoice history.",
  deskDetail:
    "Everything about one desk's month, on live data: KPI strip, 12-month trend, published invoice history, products billed to the desk, and the line-item construction of the total straight from cost_fact — every slice with the attribution rule that routed it here.",
  invoices:
    "Official monthly statements per desk, read exclusively from the monthly_chargeback_published snapshot. Mapping fixes made after publication never change these figures, and an unpublished month shows a notice instead of silently falling back to live data.",
  invoiceDetail:
    "Printable statement for one desk, read from the immutable published snapshot — the number finance bills against. Mapping edits after publication never change it; corrections land in the next month.",
  queue:
    "The operational to-do list: cost drivers from the trailing 30 days that the attribution waterfall could not (fully) place, split into five queues. Every row carries a pre-filled inline fix that writes to the mapping tables. Fixes change live views immediately and never touch published months.",
  health:
    "Pre-publication control room. Reconciliation proves billing truth = cost_fact = report for every month within the configured tolerance; integrity checks catch catalogue overlaps, desk splits that don't sum to 100%, orphan bridge rows, duplicate keys and inconsistent warehouse flags; the diff shows exactly what the snapshot will freeze. Publication unlocks only when everything is green — and the gate re-checks server-side at submit.",
  admin:
    "The write surface of the chargeback system: the mapping tables that steer the Databricks attribution waterfall, the four Azure rule tables, and the DBU reservation-discount windows that set the effective DBU price. Everything else in the app is derived, read-only reporting. Edits here change live views immediately and never restate published months.",
  products:
    "The hierarchy backbone: data_product_mapping, one row per product per desk per validity window. A product can be split across several desks by % share (shares must sum to 100%) — cost_fact then bills each desk its share of every cost line. Domain and desk always derive from here — never from tags. Desk/domain/split moves atomically close the old window and insert successor rows, so published history never restates; products are retired, never deleted.",
  jobs:
    "The three explicit mechanisms that route job spend to a product: the per-job bridge (rule 2), tag rules matching any custom tag key=value (rule 3), and runner rules assigning everything an identity runs (rule 5). Jobs are created by the data platform but consumed by desks, so job spend NEVER defaults to the runner's home desk — what none of these mechanisms (or a tag at source) catches goes to the work queue. Target state: bridge empty, rules few and deliberate.",
  jobCoverage:
    "Audit of every job that emitted cost in the trailing 30 days: the custom tags it actually carries and the attribution method(s) that carried that cost — tag at source, bridge row, tag rule, runner rule, or nothing. Use it to see which mappings are still doing work, which jobs to chase for tagging, and which tags could power a tag rule.",
  azure:
    "The four explicit mechanisms that route Azure spend (azure_cleaned.amortized_costs) to a data product: the per-resource bridge (rule 2), Azure tag rules matching any resource tag key=value (rule 3), resource-group rules (rule 4) and subscription rules (rule 5). A data_product tag on the resource itself (rule 1) always wins. Rules point at the SAME product catalogue as Databricks spend, so domain, desk and multi-desk % splits apply identically. Attribution is an allowlist — only matched cost reaches a desk; the unmatched remainder of the Azure bill stays visible in coverage as UNALLOCATED and never enters the Databricks chargeback report.",
  azureCoverage:
    "Audit of every Azure resource that emitted cost in the trailing 30 days: the tags it actually carries and the attribution method(s) that carried that cost — tag at source, bridge row, tag rule, resource-group rule, subscription rule, or nothing. Use it to see which mappings are still doing work, which resources to chase for tagging, and which tags could power a tag rule.",
  warehouses:
    "Waterfall rule 4 configuration: a Shared warehouse spreads its cost across products per query; a Dedicated warehouse charges the whole warehouse — idle time included — to one product. Invalid combinations (dedicated without a product, shared with one) are rejected by the form and re-checked on the server.",
  users:
    "Waterfall rule 6 input: maps a runner identity to a display name and home desk, so AD-HOC spend (queries, notebooks — never jobs) follows the person who ran it. user_id must match executed_by / identity_metadata.run_as byte-for-byte — which is why it is read-only in edit forms and pre-filled from system tables in the work queue.",
  workspaces:
    "Workspace ID → friendly name, used purely for report labels. Renames are cosmetic; removing a mapping never drops spend — a still-billing workspace simply shows as UNMAPPED: <id>.",
  discounts:
    "Purchased DBU reservation plans: date windows (both days inclusive) that bill Databricks DBU spend at list price × (1 − discount). The discount is applied at pricing time inside query_view and usage_view — DBU-metered spend only, never Azure cost — so every derived figure (cost_fact, monthly reports, desk invoices, the health reconciliation) uses the discounted rate. Windows must not overlap: the form rejects overlaps and the health page flags any that slip in. Changes re-price live views immediately; published months keep the figures they were published with.",
} as const;

export const KPI_HELP = {
  totalCost:
    "SUM(total_cost) over every monthly_chargeback row for the selected month (the published snapshot when in Published mode). Cost = DBUs × list price from Databricks system billing tables, less any DBU reservation-plan discount effective on the usage date, in USD. Includes UNALLOCATED, so this is the whole bill for the month.",
  momChange:
    "This month's total cost minus the previous month's; the percentage is current ÷ previous − 1. The previous month is always read from live figures — so in Published mode this compares snapshot vs live.",
  tagCoverage:
    "Share of the month's cost attributed by waterfall rule 1: cost with attribution_method = TAG ÷ total cost, from the attribution_coverage view. Green at ≥ 70%. Tags at source are the destination — this should rise while JOB_MAPPING and NONE shrink.",
  unallocatedCost:
    "SUM(total_cost) where data_product = 'UNALLOCATED' — spend no waterfall rule (tag, job bridge, tag rule, warehouse mapping, runner rule, or — for ad-hoc spend only — the runner's home desk) could attribute. Job spend never defaults to the runner, so unmapped jobs land here by design. Reported as a real line item, never hidden. The work queue exists to drive it to zero.",

  effectiveRate:
    "The month's total cost ÷ total DBUs from monthly_chargeback — the blended rate actually paid per DBU (list price less any reservation-plan discount). It moves when the workload mix shifts toward pricier SKUs (serverless, model serving, DLT) or when a discount window starts or ends, not when volume grows — so rate up = mix or discount change, cost up with rate flat = volume change.",
  runRate:
    "The selected month's total cost × 12 — what the year costs if every month looked like this one. Most honest on the last closed month; a partial current month understates it.",
  threeMonthGrowth:
    "Total cost this month ÷ total cost three months earlier − 1, on live figures. Smooths single-month noise — the KPI to watch for budget drift.",
  topConcentration:
    "Share of the month's total cost carried by the three most expensive products (UNALLOCATED counts as a product, so concentration never hides unattributed spend). High concentration means one migration or optimisation moves the whole bill.",
  productsTo80:
    "The smallest number of products whose combined cost reaches 80% of the month's total, counting from the most expensive down (UNALLOCATED counts as a product). A small number means the bill is a short list: optimising or migrating a handful of products moves most of the spend.",
  topDeskShare:
    "The most expensive desk's share of the month's total cost. A dominant desk means chargeback exposure is concentrated — that desk's workload decisions effectively set the bill.",

  deskMonthCost:
    "Sum of this desk's rows in live monthly_chargeback for the selected month — the figure that would be frozen into the desk's invoice at publication.",
  deskMomChange:
    "This month's desk total minus the desk's most recent prior month in the 12-month trend (live monthly_chargeback).",
  deskTagCoverage:
    "This desk's tagging discipline: TAG-attributed cost ÷ the desk's total cost, from live cost_fact for the month. Green at ≥ 70%. Same figure as the desk's row in the report-pack scorecard.",
  deskNoneCost:
    "Cost on this desk with attribution_method = NONE — spend nothing in the waterfall could attribute to a product, from live cost_fact for the month. Fix the sources in the work queue.",

  queueUnallocated30d:
    "Untagged-job cost + rogue-tag cost over the trailing 30 days — the two queues that carry real unattributed dollars. Runner, workspace and warehouse items are hygiene tasks; their cost is not double-counted here.",
  queueOpenItems:
    "Row count across all five queues: untagged jobs + unknown runners + unknown workspaces + rogue tags + unassigned warehouses.",

  usersMappedRunners:
    "Rows in user_mapping. IDs without an “@” are counted as service principals, the rest as humans.",
  usersDesksCovered:
    "Distinct home desks among mapped users, out of every desk known from the product catalogue and existing mappings.",
  usersUnknownRunners:
    "Identities that emitted spend in the trailing 30 days but have no user_mapping row — the same list as the work queue's Unknown runners tab. Their ad-hoc spend cannot reach a desk until they are mapped.",

  jobsSeen30d:
    "Distinct (workspace, job) pairs with any cost in the trailing 30 days, from live cost_fact.",
  jobsTagged:
    "Jobs whose 30-day cost attributed via TAG and never fell to NONE — fully covered by tags at source. This is the goal state for every job.",
  jobsBridged:
    "Jobs with any cost attributed through the job bridge (rule 2), a tag rule (rule 3) or a runner rule (rule 5). Each is a candidate for tagging at source with data_product, after which the mapping can be pruned — the janitor on the Job mapping page flags when a bridge row is safe to remove.",
  jobsUnmappedCost:
    "Sum of 30-day cost with attribution_method = NONE across all jobs — spend currently landing in UNALLOCATED. Fix it in the work queue: tag the job at source, or bridge it.",

  azureResourcesSeen30d:
    "Distinct Azure resources with any cost in the trailing 30 days, from live azure_cost_fact.",
  azureTagged:
    "Resources whose 30-day cost attributed via TAG only — a data_product tag on the resource itself. This is the goal state for every attributable resource.",
  azureBridged:
    "Resources with any cost attributed through the resource bridge (rule 2), an Azure tag rule (rule 3), a resource-group rule (rule 4) or a subscription rule (rule 5). Each is a candidate for a data_product tag at source, after which the mapping can be pruned.",
  azureUnmatchedCost:
    "Sum of 30-day Azure cost with attribution_method = NONE. Unlike Databricks spend this is not necessarily a problem: Azure attribution is an allowlist, and shared platform cost is expected to stay unmatched. It never reaches a desk.",
  azureAttributedCost:
    "Sum of 30-day Azure cost the waterfall attributed to a product (any method except NONE) — the slice that reaches desks via the shared catalogue's splits.",
} as const;

export const ANALYTICS_SECTION_HELP = {
  insights:
    "Auto-generated from the same figures shown on this page: spend trajectory, largest product moves, rate-vs-volume decomposition, concentration, attribution quality and unallocated direction. Rules, not AI — every bullet is reproducible from monthly_chargeback and attribution_coverage.",
  movers:
    "Products ranked by absolute month-over-month cost change. The current month follows the selected mode; the previous month is always live — same convention as the report pack's movement section.",
  productDrivers:
    "Every data product ranked by cost: share of the month's total with cumulative (Pareto) share, month-over-month change (prior month always live), blended $/DBU, the number of desks billed for it, and a trailing-12-month spend sparkline from live history. UNALLOCATED appears as a product like any other, so concentration never hides unattributed spend.",
  categories:
    "Unit economics per usage category (JOBS, SQL_WAREHOUSE, DLT, MODEL_SERVING…): cost, DBUs and the blended $/DBU rate with its month-over-month change. Rate moves signal mix shifts (e.g. serverless adoption), not volume.",
  rateTrend:
    "Blended $/DBU per month over the trailing 12 months (total cost ÷ total DBUs, live figures). Unlike total cost, this is meaningful even for a partial current month.",
  coverageTrend:
    "Attribution mix per month over the trailing 12 months, from the attribution_coverage view. Goal: TAG (green) widening, JOB_MAPPING and NONE shrinking.",
  deskDrivers:
    "Every desk ranked by cost: share of the month's total and its shift vs last month in percentage points (relative growth even when every desk rises), month-over-month change, the desk's most expensive product with its slice of the desk's bill, product count, TAG coverage from live cost_fact (same figure as the report scorecard), and a trailing-12-month spend sparkline. Desk names link to the desk's self-service page.",
} as const;

export const REPORT_SECTION_HELP = {
  movement:
    "Per desk: previous month, current month, Δ and Δ%. The current month follows the selected mode; the previous month is always read from live figures. Commentary picks the largest product move in the same direction as each desk's swing.",
  breakdown:
    "Domain subtotals with product × desk rows beneath. Share = cost ÷ the month's grand total. Domains link into the drill-down.",
  coverage:
    "Cost per attribution method for the month, exact dollars and share of total. TAG = tagged at source · JOB_MAPPING = manual job bridge · TAG_RULE = matched a tag rule (any custom tag → product) · WAREHOUSE_MAPPING = dedicated warehouse · RUNNER_RULE = runner's workload assigned to a product · USER = runner's home desk (ad-hoc only — job spend never defaults to the runner) · NONE = unattributed, lands in UNALLOCATED.",
  scorecard:
    "Per desk, always from live cost_fact regardless of mode: TAG % = TAG-attributed cost ÷ desk total; the last column is the desk's unattributed (NONE) cost. Ranked by TAG % — the tagging-adoption leaderboard.",
} as const;
