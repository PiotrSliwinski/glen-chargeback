import Link from "next/link";
import { getDesks, getPublishedMonths } from "@/dal/reports";
import { fmtMoney, fmtMonth } from "@/lib/format";
import { param, type SearchParams } from "@/lib/report-params";
import { PAGE_HELP } from "@/lib/kpi-help";
import { EmptyState, PageTitle } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePageSkeleton } from "@/components/loading-skeletons";
import { SearchParamsSuspense } from "@/components/keyed-suspense";

export const metadata = { title: "Desk invoices" };

export default function InvoicesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <SearchParamsSuspense
      searchParams={searchParams}
      fallback={<TablePageSkeleton label="Loading invoices from Databricks…" />}
    >
      <Invoices searchParams={searchParams} />
    </SearchParamsSuspense>
  );
}

async function Invoices({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const publishedMonths = await getPublishedMonths();
  const requested = param(sp.month);
  const month =
    requested && publishedMonths.includes(requested) ? requested : publishedMonths[0];

  if (!month) {
    return (
      <div>
        <PageTitle
          title="Desk invoices"
          subtitle="Issued from published snapshots only"
          info={PAGE_HELP.invoices}
        />
        <EmptyState message="No month has been published yet. Publish one from the Health page." />
      </div>
    );
  }

  const desks = await getDesks(month, "published");

  return (
    <div>
      <PageTitle
        title="Desk invoices"
        subtitle="Issued from the published snapshot — mapping edits never change these figures"
        info={PAGE_HELP.invoices}
      >
        <div className="flex gap-1.5">
          {publishedMonths.map((m) => (
            <Button
              key={m}
              asChild
              size="sm"
              variant={m === month ? "secondary" : "ghost"}
              className={m === month ? undefined : "text-muted-foreground"}
            >
              <Link href={`/invoices?month=${m}`} aria-current={m === month ? "page" : undefined}>
                {fmtMonth(m)}
              </Link>
            </Button>
          ))}
        </div>
      </PageTitle>

      <Card>
        <CardContent>
          {desks.length === 0 ? (
            <EmptyState message="No desk cost in this published month." />
          ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Desk</TableHead>
                <TableHead className="text-right">Total for {fmtMonth(month)}</TableHead>
                <TableHead>
                  <span className="sr-only">Statement</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {desks.map((d) => (
                <TableRow key={d.desk}>
                  <TableCell className="font-medium">
                    {/* live analytical view; the statement link is the published one */}
                    <Link
                      href={`/desks/${encodeURIComponent(d.desk)}?month=${month}`}
                      className="hover:underline"
                    >
                      {d.desk}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(d.total_cost)}</TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/invoices/${encodeURIComponent(d.desk)}?month=${month}`}
                      className="text-indigo-600 hover:underline"
                    >
                      View statement →
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
