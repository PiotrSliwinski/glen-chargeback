import { Suspense } from "react";
import Link from "next/link";
import { getDeskInvoice, getPublishedMonths } from "@/dal/reports";
import { fmtDbu, fmtMoneyExact, fmtMonth } from "@/lib/format";
import { param, type SearchParams } from "@/lib/report-params";
import { Card, EmptyState, PageTitle } from "@/components/ui";
import { ReportFooter } from "@/components/report-footer";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Desk statement" };

export default function DeskInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ desk: string }>;
  searchParams: SearchParams;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading statement…</p>}>
      <DeskInvoice params={params} searchParams={searchParams} />
    </Suspense>
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
          <a
            href={`/api/export/desk-invoice?month=${month}&mode=published&desk=${encodeURIComponent(desk)}`}
            className="btn-secondary"
          >
            ⬇ CSV
          </a>
          <PrintButton />
        </div>
      </div>

      <Card className="p-8">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Internal chargeback statement</h1>
            <p className="mt-1 text-sm text-slate-500">
              Desk <strong className="text-slate-800">{desk}</strong> — {fmtMonth(month)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-slate-500">Total due</p>
            <p className="text-2xl font-semibold text-slate-900">{fmtMoneyExact(total)}</p>
          </div>
        </div>

        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Data domain</th>
              <th className="th">Data product</th>
              <th className="th text-right">DBUs</th>
              <th className="th text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.data_domain}|${r.data_product}`}>
                <td className="td">{r.data_domain}</td>
                <td className="td">{r.data_product}</td>
                <td className="td text-right tabular-nums">{fmtDbu(r.total_dbus)}</td>
                <td className="td text-right tabular-nums">{fmtMoneyExact(r.total_cost)}</td>
              </tr>
            ))}
            <tr>
              <td className="td font-semibold" colSpan={3}>
                Total
              </td>
              <td className="td text-right font-semibold tabular-nums">{fmtMoneyExact(total)}</td>
            </tr>
          </tbody>
        </table>

        <p className="mt-4 text-xs text-slate-400">
          Issued from the published snapshot of {fmtMonth(month)}. Figures are immutable; questions
          go to the cost reporting owner.
        </p>
        <ReportFooter />
      </Card>
    </div>
  );
}
