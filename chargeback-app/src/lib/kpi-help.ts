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
  ai:
    "AI spend carved out of the same figures as every other report: the billing categories Databricks marks as AI-native (MODEL_SERVING — realtime endpoints and ai_query batch inference alike — VECTOR_SEARCH, FOUNDATION_MODEL_TRAINING, AGENT_EVALUATION), rolled up per serving endpoint, offering type, product and desk from live cost_fact. Because it is the same cost_fact, AI figures always reconcile with the monthly chargeback — this page is a lens, not a second source of truth. Note the freshness caveat: system.billing.usage lags real usage by roughly 1–2 hours (no official SLA), so the current day's AI spend is always incomplete.",
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
    "The operational to-do list: cost drivers from the trailing 30 days that no attribution waterfall could (fully) place, split into queues grouped by source — Databricks (untagged jobs, unknown runners, unknown workspaces, rogue tags, unassigned warehouses), Azure (unmatched resources) and AI (unmapped serving endpoints). Every row carries a pre-filled inline fix that writes to the mapping tables. Fixes change live views immediately and never touch published months.",
  health:
    "Pre-publication control room. Reconciliation proves billing truth = cost_fact = report for every month within the configured tolerance; the Azure counterpart proves the same for the Azure bill = azure_cost_fact = Azure rollup (informational — Azure is never published); integrity checks catch catalogue overlaps, desk splits that don't sum to 100%, orphan bridge rows, duplicate keys and inconsistent warehouse flags; the diff shows exactly what the snapshot will freeze. Publication unlocks only when the Databricks checks are green — and the gate re-checks server-side at submit.",
  admin:
    "The write surface of the chargeback system: the mapping tables that steer the Databricks attribution waterfall, the four Azure rule tables, and the DBU reservation-discount windows that set the effective DBU price. Everything else in the app is derived, read-only reporting. Edits here change live views immediately and never restate published months.",
  products:
    "The hierarchy backbone: data_product_mapping, one row per product per desk per validity window. A product can be split across several desks by % share (shares must sum to 100%) — cost_fact then bills each desk its share of every cost line. Domain and desk always derive from here — never from tags. Desk/domain/split moves atomically close the old window and insert successor rows, so published history never restates; products are retired, never deleted. Editing needs the steward role (viewers see reports only) and is deliberately not free-form: there is no in-place edit or delete — use Move for domain/desk/split changes, Edit owner for metadata, Retire to close a product. Product keys are permanent because they are the tag vocabulary; a rename is retire + register under the new key.",
  jobs:
    "The three explicit mechanisms that route job spend to a product: the per-job bridge (rule 2), tag rules matching any custom tag key=value (rule 3), and runner rules assigning everything an identity runs (rule 5). Jobs are created by the data platform but consumed by desks, so job spend NEVER defaults to the runner's home desk — what none of these mechanisms (or a tag at source) catches goes to the work queue. Target state: bridge empty, rules few and deliberate.",
  jobCoverage:
    "Audit of every job that emitted cost in the trailing 30 days: the custom tags it actually carries and the attribution method(s) that carried that cost — tag at source, bridge row, tag rule, runner rule, or nothing. Use it to see which mappings are still doing work, which jobs to chase for tagging, and which tags could power a tag rule.",
  azure:
    "The four explicit mechanisms that route Azure spend (azure_cleaned.amortized_costs) to a data product: the per-resource bridge (rule 2), Azure tag rules matching any resource tag key=value (rule 3), resource-group rules (rule 4) and subscription rules (rule 5). A data_product tag on the resource itself (rule 1) always wins. Rules point at the SAME product catalogue as Databricks spend, so domain, desk and multi-desk % splits apply identically. Attribution is an allowlist — only matched cost reaches a desk; the unmatched remainder of the Azure bill stays visible in coverage as UNALLOCATED and never enters the Databricks chargeback report.",
  azureCoverage:
    "Audit of every Azure resource that emitted cost in the trailing 30 days: the tags it actually carries and the attribution method(s) that carried that cost — tag at source, bridge row, tag rule, resource-group rule, subscription rule, or nothing. Use it to see which mappings are still doing work, which resources to chase for tagging, and which tags could power a tag rule.",
  azureCosts:
    "Monthly view of the whole Azure bill (azure_cleaned.amortized_costs), separate from the Databricks chargeback: cost by meter category, desk and attribution method, a 12-month trend, and every resource behind the month's spend. Attribution runs through the Azure allowlist waterfall against the SAME product catalogue as Databricks spend — matched cost reaches desks with domain and % splits applied identically; the unmatched remainder stays visible here as UNALLOCATED and is never billed. Live figures only: Azure cost is not part of the published snapshot, so there is no Live/Published toggle.",
  warehouses:
    "Waterfall rule 4 configuration: a Shared warehouse spreads its cost across products per query; a Dedicated warehouse charges the whole warehouse — idle time included — to one product. Invalid combinations (dedicated without a product, shared with one) are rejected by the form and re-checked on the server.",
  endpoints:
    "Waterfall rule 4b configuration: one AI/model-serving endpoint → one product, the serving analogue of a dedicated warehouse. AI serving is USER-FIRST, so spend run by a mapped user bills that user's desk; the endpoint's remaining spend — no run_as, unmapped identities, realtime and ai_query batch alike — bills to this product. A data_product tag on the endpoint itself beats the bridge; this bridge exists for endpoints not yet tagged at source, and the goal state is to empty it. endpoint_name must match usage_metadata.endpoint_name exactly and is only unique per workspace, hence the composite key.",
  users:
    "USER-rule input: maps a runner identity to a display name and home desk, so AD-HOC spend (serverless warehouse queries and AI serving user-first, other queries and notebooks last-resort — never jobs) follows the person who ran it. user_id must match executed_by / identity_metadata.run_as byte-for-byte — which is why it is read-only in edit forms and pre-filled from system tables in the work queue.",
  workspaces:
    "Workspace ID → friendly name, used purely for report labels. Renames are cosmetic; removing a mapping never drops spend — a still-billing workspace simply shows as UNMAPPED: <id>.",
  discounts:
    "Purchased DBU reservation plans: date windows (both days inclusive) that bill Databricks DBU spend at list price × (1 − discount). The discount is applied at pricing time inside query_view and usage_view — DBU-metered spend only, never Azure cost — so every derived figure (cost_fact, monthly reports, desk invoices, the health reconciliation) uses the discounted rate. Windows must not overlap: the form rejects overlaps and the health page flags any that slip in. Changes re-price live views immediately; published months keep the figures they were published with.",
} as const;

export const KPI_HELP = {
  totalCost:
    "SUM(total_cost) over every monthly_chargeback row for the selected month (the published snapshot when in Published mode). Cost = DBUs × time-effective price from Databricks system billing tables, less any DBU reservation-plan discount effective on the usage date, in USD. Includes UNALLOCATED, so this is the whole Databricks bill for the month — Azure spend is separate money, reported on the Azure costs screen.",
  momChange:
    "This month's total cost minus the previous month's; the percentage is current ÷ previous − 1. The previous month is always read from live figures — so in Published mode this compares snapshot vs live.",
  tagCoverage:
    "Share of the month's cost attributed by waterfall rule 1: cost with attribution_method = TAG ÷ total cost, from the attribution_coverage view. Green at ≥ 70%. Tags at source are the destination — this should rise while JOB_MAPPING and NONE shrink.",
  unallocatedCost:
    "SUM(total_cost) where data_product = 'UNALLOCATED' — spend no waterfall rule (the runner's home desk for interactive/ad-hoc spend, tag, job bridge, tag rule, warehouse mapping, runner rule) could attribute. Job spend never defaults to the runner, so unmapped jobs land here by design. Reported as a real line item, never hidden. The work queue exists to drive it to zero.",

  effectiveRate:
    "The month's total cost ÷ total DBUs from monthly_chargeback — the blended rate actually paid per DBU (list price less any reservation-plan discount). It moves when the workload mix shifts toward pricier SKUs (serverless, model serving, DLT) or when a discount window starts or ends, not when volume grows — so rate up = mix or discount change, cost up with rate flat = volume change.",
  runRate:
    "The selected month's total cost × 12 — what the year costs if every month looked like this one. Most honest on the last closed month; a partial current month understates it.",
  threeMonthGrowth:
    "Total cost this month ÷ total cost three months earlier − 1, on live figures. Smooths single-month noise — the KPI to watch for budget drift.",
  topConcentration:
    "Share of the month's total cost carried by the three most expensive products (UNALLOCATED counts as a product, so concentration never hides unallocated spend). High concentration means one migration or optimisation moves the whole bill.",
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
    "All unallocated cost over the trailing 30 days: Databricks (untagged jobs + rogue tags) + Azure (unmatched resources) + AI (unmapped endpoints). Each dollar is counted in exactly one source queue. Runner, workspace and warehouse items are hygiene tasks; their cost is not double-counted here.",
  queueDatabricksUnallocated30d:
    "Untagged-job cost + rogue-tag cost from cost_fact over the trailing 30 days — the two Databricks queues that carry real unallocated dollars. AI serving spend with an endpoint dimension is counted in the AI tile instead.",
  queueAzureUnallocated30d:
    "Azure cost with attribution_method = NONE from azure_cost_fact over the trailing 30 days — no tag, bridge or scope rule matched. Visible in coverage, never billed to a desk until mapped.",
  queueAiUnallocated30d:
    "Serving-endpoint cost that fell to UNALLOCATED over the trailing 30 days. AI is user-first: mapping the run-as identity routes it to their desk; the endpoint bridge catches spend with no attributable user.",

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

  azureMonthCost:
    "SUM(total_cost) over the month's azure_monthly_chargeback rows — the whole Azure bill for the month in USD, attributed or not, straight from azure_cleaned.amortized_costs (amortized cost). Separate money from the Databricks chargeback: the two never mix.",
  azureMomChange:
    "This month's Azure total minus the previous month's, both from live azure_monthly_chargeback — Azure has no published mode, so this is always live vs live.",
  azureAttributedShare:
    "Azure cost the waterfall attributed to a product (any method except NONE) ÷ the month's Azure total — the slice that reaches desks via the shared catalogue's domain, desk and % splits.",
  azureMonthUnallocated:
    "The month's Azure cost with attribution_method = NONE. Unlike Databricks spend this is not necessarily a problem: Azure attribution is an allowlist, and shared platform cost is expected to stay unmatched. It never reaches a desk.",

  aiMonthCost:
    "SUM(total_cost) over the month's monthly_chargeback rows whose usage category is AI-native (MODEL_SERVING, VECTOR_SEARCH, FOUNDATION_MODEL_TRAINING, AGENT_EVALUATION). Same pricing as everything else: DBUs × time-effective list price less any reservation-plan discount. The hint shows this as a share of the whole bill.",
  aiMomChange:
    "This month's AI cost minus the previous month's, over the same AI categories. The previous month is always read from live figures — in Published mode this compares snapshot vs live.",
  aiBatchShare:
    "Cost with product_features.model_serving.offering_type = BATCH_INFERENCE (ai_query batch jobs) ÷ the month's AI cost, from live cost_fact. Distinguishes scheduled batch extraction from realtime endpoint traffic.",
  aiUnallocatedCost:
    "AI-category cost that landed on data_product = 'UNALLOCATED' — endpoints and AI workloads nothing in the waterfall could attribute. Tag the endpoint at source with data_product, or bridge it under Reference data → Endpoints.",

  endpointsMapped:
    "Rows in endpoint_product_mapping — endpoints explicitly routed to a product by waterfall rule 4b. Goal state: 0, with every endpoint tagged at source instead.",
  endpointsUnmapped30d:
    "Endpoints whose trailing-30-day spend fell to UNALLOCATED (attribution_method = NONE in live cost_fact) — candidates for a tag at source or a bridge row.",
  endpointsUnmappedCost30d:
    "Sum of that unallocated 30-day endpoint spend — the dollars a mapping would route to a desk.",
} as const;

export const AI_SECTION_HELP = {
  categories:
    "The month's AI cost per billing category with blended $/DBU: MODEL_SERVING covers realtime endpoints and ai_query batch inference; VECTOR_SEARCH, FOUNDATION_MODEL_TRAINING and AGENT_EVALUATION are the other AI-native billing origins. Same rows as the analytics unit-economics table, filtered to AI.",
  trend:
    "AI cost per month over the trailing 12 months, stacked by category, always from live history — the adoption curve of AI workloads in the bill.",
  endpoints:
    "Every endpoint that emitted AI spend in the month (top 500 slices by cost), per serving endpoint × offering type × run-as identity from live cost_fact: who ran it (identity_metadata.run_as — the mapped name, or the raw identity for unmapped runners), the workspace it serves from (friendly name from workspace mapping; UNMAPPED: <id> otherwise), which product and desk it bills to, the attribution rule that routed it, the days of the month it was active, DBUs and cost. Filterable by any of those. BATCH_INFERENCE marks ai_query batch jobs. Rows without an endpoint (vector search, training) group under “(no endpoint)”. MoM Δ compares the endpoint against last month's live figures — “new” means it had no spend then; an endpoint split across desks or runners shows “—” because a per-row Δ would double-count. AI serving is USER-FIRST: spend run by a mapped user bills that user's desk as AD_HOC before any tag; tags and the endpoint bridge catch the remainder (no run_as, unmapped identities, job-launched ai_query) — so mapping a runner routes their endpoint cost to their desk, exactly like serverless warehouse queries. Active days are day-precision: billing usage is pre-aggregated, so per-call counts and timestamps do not exist in billing data. Endpoint detail is never snapshotted, so this table reads live data in both modes.",
  desks:
    "The month's AI cost per desk: absolute cost, month-over-month change (previous month always live), the desk's share of all AI spend, and AI intensity — AI cost ÷ the desk's whole bill, i.e. how AI-heavy that desk's usage is. Same monthly_chargeback rows as the KPI tiles, so the desks sum to the AI cost tile.",
  runners:
    "Who created the month's AI cost: spend per run-as identity (identity_metadata.run_as, from the same live endpoint slices as the table below), with the number of endpoints each identity ran, month-over-month change and share of AI spend. Mapped identities show their display name; a raw id in amber is an unmapped runner — map them under Reference data → Users and their serving spend bills to their desk as AD_HOC via the user-first rule.",
  movers:
    "Endpoints ranked by absolute month-over-month cost change (both months live, compared per workspace × endpoint × offering type × category, so a re-mapped endpoint compares against itself). “new” = no spend last month; “gone” = spent last month, nothing this month. The list behind the MoM Δ tile: these are the endpoints that moved the AI bill.",
} as const;

export const AZURE_SECTION_HELP = {
  categories:
    "The month's Azure cost per meter category (Virtual Machines, Storage, Azure Databricks…), with the number of distinct resources behind each and the category's share of the Azure bill. MoM Δ compares against last month's rollup.",
  domains:
    "The month's attributed Azure cost per data domain — level 1 of the same domain → product → desk hierarchy every Databricks report uses, derived from the shared product catalogue. UNALLOCATED is the unmatched remainder. Same rows as the KPI tiles, so domains + UNALLOCATED sum to the Azure cost tile.",
  trend:
    "Azure cost per month over the trailing 12 months, stacked by desk. UNALLOCATED (grey) is the unmatched remainder of the bill — watch whether the attributed slice grows as tagging and rules improve.",
  desks:
    "The month's attributed Azure cost per desk, via the shared product catalogue (multi-desk % splits applied) — plus UNALLOCATED, the slice no desk pays. Same rows as the KPI tiles, so desks + UNALLOCATED sum to the Azure cost tile.",
  methods:
    "How the month's Azure cost was attributed, in waterfall order: TAG = data_product tag on the resource · RESOURCE_MAPPING = per-resource bridge row · TAG_RULE = matched an Azure tag rule · RESOURCE_GROUP = whole-RG rule · SUBSCRIPTION = whole-subscription rule · NONE = unmatched, stays unallocated. Goal: TAG widening, the bridge shrinking.",
  resources:
    "Every Azure resource behind the month's bill (top 500 by cost), with the attribution method, product and desk that carried each slice. A resource appearing twice changed how it attributes mid-month — e.g. bridge-mapped early, tagged at source since. Stewards fix attribution under Reference data → Azure attribution.",
} as const;

export const ANALYTICS_SECTION_HELP = {
  insights:
    "Auto-generated from the same figures shown on this page: spend trajectory, largest product moves, rate-vs-volume decomposition, concentration, attribution quality and unallocated direction. Rules, not AI — every bullet is reproducible from monthly_chargeback and attribution_coverage.",
  movers:
    "Products ranked by absolute month-over-month cost change. The current month follows the selected mode; the previous month is always live — same convention as the report pack's movement section.",
  productDrivers:
    "Every data product ranked by cost: share of the month's total with cumulative (Pareto) share, month-over-month change (prior month always live), blended $/DBU, the number of desks billed for it, and a trailing-12-month spend sparkline from live history. UNALLOCATED appears as a product like any other, so concentration never hides unallocated spend.",
  categories:
    "Unit economics per usage category (JOBS, SQL_WAREHOUSE, DLT, MODEL_SERVING…): cost, DBUs and the blended $/DBU rate with its month-over-month change. Rate moves signal mix shifts (e.g. serverless adoption), not volume.",
  rateTrend:
    "Blended $/DBU per month over the trailing 12 months (total cost ÷ total DBUs, live figures). Unlike total cost, this is meaningful even for a partial current month.",
  coverageTrend:
    "Attribution mix per month over the trailing 12 months, from the attribution_coverage view. Goal: TAG (green) widening, JOB_MAPPING and NONE shrinking.",
  sourceScorecard:
    "The month's cost per spend source split by how it attributed: tagged at source (the data_product tag itself), carried by rules (user-first for interactive spend, bridges, tag/runner/scope rules, ad-hoc), or unallocated. One standard measured identically on Databricks, its AI slice and Azure. AI is a subset of Databricks, so rows compare and never sum. Note the per-source policy: jobs and Azure are tag-first (their tagged share should rise), while AI serving and serverless warehouse queries are USER-FIRST — their spend deliberately lands in the rules column when a mapped user ran it, and tags only catch the userless remainder. Goal: unallocated shrinking everywhere.",
  deskDrivers:
    "Every desk ranked by cost: share of the month's total and its shift vs last month in percentage points (relative growth even when every desk rises), month-over-month change, the desk's most expensive product with its slice of the desk's bill, product count, TAG coverage from live cost_fact (same figure as the report scorecard), and a trailing-12-month spend sparkline. Desk names link to the desk's self-service page.",
} as const;

export const REPORT_SECTION_HELP = {
  movement:
    "Per desk: previous month, current month, Δ and Δ%. The current month follows the selected mode; the previous month is always read from live figures. Commentary picks the largest product move in the same direction as each desk's swing.",
  breakdown:
    "Domain subtotals with product × desk rows beneath. Share = cost ÷ the month's grand total. Domains link into the drill-down.",
  coverage:
    "Cost per attribution method for the month, exact dollars and share of total. USER = runner's home desk — FIRST for interactive spend (serverless-warehouse queries and AI serving run by a mapped user), last resort for other ad-hoc; job spend never defaults to the runner · TAG = tagged at source · JOB_MAPPING = manual job bridge · TAG_RULE = matched a tag rule (any custom tag → product) · WAREHOUSE_MAPPING = dedicated warehouse · ENDPOINT_MAPPING = dedicated AI/serving endpoint · PIPELINE_MAPPING = dedicated DLT pipeline · RUNNER_RULE = runner's workload assigned to a product · NONE = no rule matched, lands in UNALLOCATED.",
  scorecard:
    "Per desk, always from live cost_fact regardless of mode: TAG % = TAG-attributed cost ÷ desk total; the last column is the desk's unallocated (NONE) cost. Ranked by TAG % — the tagging-adoption leaderboard.",
} as const;
