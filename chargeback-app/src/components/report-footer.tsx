/**
 * Known limitations — the Methodology (§11) requires these in every report
 * footer. Rendered once, reused on every reporting page and invoice.
 */
export function ReportFooter() {
  return (
    <footer className="mt-8 rounded-lg border bg-muted/50 p-4 text-xs text-muted-foreground">
      <p className="mb-1 font-semibold text-foreground/80">Known limitations</p>
      <ul className="list-inside list-disc space-y-0.5">
        <li>
          Databricks DBU cost only; Azure VM/network/storage for classic compute billed separately
          by Microsoft is out of scope.
        </li>
        <li>List-price basis (with effective_list where populated); invoice-level discounts not reflected.</li>
        <li>Warehouse queries attributed to their start hour; multi-hour statements not split.</li>
        <li>
          Per-query warehouse detail limited by ~90-day system.query.history retention until
          materialization has accumulated history.
        </li>
      </ul>
    </footer>
  );
}
