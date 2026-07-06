/**
 * Known limitations — the Methodology (§11) requires these in every report
 * footer. Rendered once, reused on every reporting page and invoice. The
 * Azure cost screen reports different money (the Azure bill, not DBUs), so
 * it carries its own caveat list.
 */
const LIMITATIONS = {
  databricks: [
    "Databricks DBU cost only; Azure VM/network/storage for classic compute billed separately by Microsoft is out of scope.",
    "List-price basis (with effective_list where populated); invoice-level discounts not reflected.",
    "Warehouse queries attributed to their start hour; multi-hour statements not split.",
    "Per-query warehouse detail limited by ~90-day system.query.history retention until materialization has accumulated history.",
  ],
  azure: [
    "Amortized Azure cost in USD as exported to azure_cleaned.amortized_costs; invoice-level adjustments, credits and refunds are not reflected.",
    "Attribution is an allowlist — unmatched cost stays UNALLOCATED and is never billed to a desk.",
    "Live figures only: Azure cost is never snapshotted at publication and never enters the Databricks chargeback report or an invoiced total — desk statements and the health page show it in separate, informational sections.",
    "Multi-desk products split by the catalogue's cost_split_pct as of each usage date, same as Databricks spend.",
  ],
} as const;

export function ReportFooter({ scope = "databricks" }: { scope?: keyof typeof LIMITATIONS }) {
  return (
    <footer className="mt-8 rounded-lg border bg-muted/50 p-4 text-xs text-muted-foreground">
      <p className="mb-1 font-semibold text-foreground/80">Known limitations</p>
      <ul className="list-inside list-disc space-y-0.5">
        {LIMITATIONS[scope].map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </footer>
  );
}
