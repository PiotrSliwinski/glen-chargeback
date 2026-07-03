/**
 * Centralised tooltip copy rendered by <InfoTip>: what each page does and how
 * each KPI is calculated. Kept in one module so the same figure is explained
 * identically everywhere it appears (dashboard, report pack, desk pages).
 * Sources referenced below are the derived views described in the Methodology
 * (§6 attribution waterfall, §7 checks, §9 publication).
 */

export const PAGE_HELP = {
  dashboard:
    "Landing view of the chargeback system: one month of Databricks spend — live from monthly_chargeback, or the frozen snapshot in Published mode — rolled up by data domain, with a 12-month trend and a breakdown of how cost was attributed. All figures are list-price USD derived from Databricks system billing tables; discounts are not applied.",
  report:
    "The distribution-ready monthly pack: executive summary, month-over-month movement by desk with auto-generated commentary, domain → product → desk breakdown, attribution coverage, and the per-desk tagging scorecard. Same figures as the dashboard for the selected month and mode. Print it, or download the XLSX workbook / CSVs at the bottom.",
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
    "The write surface of the chargeback system: the seven mapping tables that steer the attribution waterfall. Everything else in the app is derived, read-only reporting. Edits here change live views immediately and never restate published months.",
  products:
    "The hierarchy backbone: data_product_mapping, one row per product per desk per validity window. A product can be split across several desks by % share (shares must sum to 100%) — cost_fact then bills each desk its share of every cost line. Domain and desk always derive from here — never from tags. Desk/domain/split moves atomically close the old window and insert successor rows, so published history never restates; products are retired, never deleted.",
  jobs:
    "The three explicit mechanisms that route job spend to a product: the per-job bridge (rule 2), tag rules matching any custom tag key=value (rule 3), and runner rules assigning everything an identity runs (rule 5). Jobs are created by the data platform but consumed by desks, so job spend NEVER defaults to the runner's home desk — what none of these mechanisms (or a tag at source) catches goes to the work queue. Target state: bridge empty, rules few and deliberate.",
  jobCoverage:
    "Audit of every job that emitted cost in the trailing 30 days: the custom tags it actually carries and the attribution method(s) that carried that cost — tag at source, bridge row, tag rule, runner rule, or nothing. Use it to see which mappings are still doing work, which jobs to chase for tagging, and which tags could power a tag rule.",
  warehouses:
    "Waterfall rule 4 configuration: a Shared warehouse spreads its cost across products per query; a Dedicated warehouse charges the whole warehouse — idle time included — to one product. Invalid combinations (dedicated without a product, shared with one) are rejected by the form and re-checked on the server.",
  users:
    "Waterfall rule 6 input: maps a runner identity to a display name and home desk, so AD-HOC spend (queries, notebooks — never jobs) follows the person who ran it. user_id must match executed_by / identity_metadata.run_as byte-for-byte — which is why it is read-only in edit forms and pre-filled from system tables in the work queue.",
  workspaces:
    "Workspace ID → friendly name, used purely for report labels. Renames are cosmetic; removing a mapping never drops spend — a still-billing workspace simply shows as UNMAPPED: <id>.",
} as const;

export const KPI_HELP = {
  totalCost:
    "SUM(total_cost) over every monthly_chargeback row for the selected month (the published snapshot when in Published mode). Cost = DBUs × list price from Databricks system billing tables, in USD. Includes UNALLOCATED, so this is the whole bill for the month.",
  momChange:
    "This month's total cost minus the previous month's; the percentage is current ÷ previous − 1. The previous month is always read from live figures — so in Published mode this compares snapshot vs live.",
  tagCoverage:
    "Share of the month's cost attributed by waterfall rule 1: cost with attribution_method = TAG ÷ total cost, from the attribution_coverage view. Green at ≥ 70%. Tags at source are the destination — this should rise while JOB_MAPPING and NONE shrink.",
  unallocatedCost:
    "SUM(total_cost) where data_product = 'UNALLOCATED' — spend no waterfall rule (tag, job bridge, tag rule, warehouse mapping, runner rule, or — for ad-hoc spend only — the runner's home desk) could attribute. Job spend never defaults to the runner, so unmapped jobs land here by design. Reported as a real line item, never hidden. The work queue exists to drive it to zero.",

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
