import Link from "next/link";
import { getDeskInvoice, getPublishedMonths } from "@/dal/reports";
import { fmtDbu, fmtMoneyExact, fmtMonth } from "@/lib/format";
import { param, type SearchParams } from "@/lib/report-params";
import { EmptyState, PageTitle } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportFooter } from "@/components/report-footer";
import { PrintButton } from "@/components/print-button";
import { TablePageSkeleton } from "@/components/loading-skeletons";
import { SearchParamsSuspense } from "@/components/keyed-suspense";

export const metadata = { title: "Desk statement" };

export default function DeskInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ desk: string }>;
  searchParams: SearchParams;
}) {
  return (
    <SearchParamsSuspense
      searchParams={searchParams}
      fallback={<TablePageSkeleton label="Loading statement from Databricks…" rows={8} />}
    >
      <DeskInvoice params={params} searchParams={searchParams} />
    </SearchParamsSuspense>
  );
}

async function DeskInvoice({
  params,
  searchParams,
}: {
  params: Promise<{ desk: string }>;
  searchParams: SearchParams;
}) {
  const { desk: rawDesk } = await params;
  const desk = decodeURIComponent(rawDesk);
  const sp = await searchParams;
  const publishedMonths = await getPublishedMonths();
  const requested = param(sp.month);
  const month =
    requested && publishedMonths.includes(requested) ? requested : publishedMonths[0];

  if (!month) {
    return <EmptyState message="No published month available yet." />;
  }

  const rows = await getDeskInvoice(month, desk);

  if (rows.length === 0) {
    return (
      <div>
        <PageTitle title={`Desk: ${desk}`} />
        <EmptyState
          message={`No published invoice for ${desk} in ${fmtMonth(month)}. If the month was just closed, publish it from the Health page first — invoices never fall back to live data.`}
        />
      </div>
    );
  }

  const total = rows[0].desk_month_total;

  return (
    <div>
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/invoices?month=${month}`} className="text-sm text-indigo-600 hover:underline">
          ← All invoices
        </Link>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <a
              href={`/api/export/desk-invoice?month=${month}&mode=published&desk=${encodeURIComponent(desk)}`}
            >
              ⬇ CSV
            </a>
          </Button>
          <PrintButton />
        </div>
      </div>

      <Card className="[--card-spacing:--spacing(8)]">
        <CardContent>
          <div className="mb-6 flex items-start justify-between">
            <div>
              <h1 className="text-xl font-semibold">Internal chargeback statement</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Desk <strong className="text-foreground">{desk}</strong> — {fmtMonth(month)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Total due</p>
              <p className="text-2xl font-semibold">{fmtMoneyExact(total)}</p>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data domain</TableHead>
                <TableHead>Data product</TableHead>
                <TableHead className="text-right">DBUs</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.data_domain}|${r.data_product}`}>
                  <TableCell>{r.data_domain}</TableCell>
                  <TableCell>{r.data_product}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtDbu(r.total_dbus)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtMoneyExact(r.total_cost)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-semibold" colSpan={3}>
                  Total
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {fmtMoneyExact(total)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>

          <p className="mt-4 text-xs text-muted-foreground/70">
            Issued from the published snapshot of {fmtMonth(month)}. Figures are immutable; questions
            go to the cost reporting owner.
          </p>
          <ReportFooter />
        </CardContent>
      </Card>
    </div>
  );
}
