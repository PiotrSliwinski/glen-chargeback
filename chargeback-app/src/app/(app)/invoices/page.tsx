import { Suspense } from "react";
import Link from "next/link";
import { getDesks, getPublishedMonths } from "@/dal/reports";
import { fmtMoney, fmtMonth } from "@/lib/format";
import { param, type SearchParams } from "@/lib/report-params";
import { Card, EmptyState, PageTitle } from "@/components/ui";

export const metadata = { title: "Desk invoices" };

export default function InvoicesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading invoices…</p>}>
      <Invoices searchParams={searchParams} />
    </Suspense>
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
        <PageTitle title="Desk invoices" subtitle="Issued from published snapshots only" />
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
      >
        <div className="flex gap-1.5">
          {publishedMonths.map((m) => (
            <Link
              key={m}
              href={`/invoices?month=${m}`}
              className={`tab ${m === month ? "tab-active" : ""}`}
            >
              {fmtMonth(m)}
            </Link>
          ))}
        </div>
      </PageTitle>

      <Card>
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Desk</th>
              <th className="th text-right">Total for {fmtMonth(month)}</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {desks.map((d) => (
              <tr key={d.desk}>
                <td className="td font-medium">{d.desk}</td>
                <td className="td text-right tabular-nums">{fmtMoney(d.total_cost)}</td>
                <td className="td text-right">
                  <Link
                    href={`/invoices/${encodeURIComponent(d.desk)}?month=${month}`}
                    className="text-indigo-600 hover:underline"
                  >
                    View statement →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
