import { Suspense } from "react";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getDesks } from "@/dal/reports";
import { listUsers } from "@/dal/mappings";
import { fmtMoney, fmtMonth } from "@/lib/format";
import { resolveReportParams, type SearchParams } from "@/lib/report-params";
import { Card, EmptyState, PageTitle } from "@/components/ui";
import { MonthModePicker } from "@/components/month-picker";

export const metadata = { title: "Desks" };

export default function DesksPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading desks…</p>}>
      <Desks searchParams={searchParams} />
    </Suspense>
  );
}

async function Desks({ searchParams }: { searchParams: SearchParams }) {
  const { month, months, publishedMonths } = await resolveReportParams(searchParams);
  const [desks, users, session] = await Promise.all([
    getDesks(month, "live"),
    listUsers(),
    getSession(),
  ]);
  const myDesk =
    users.find((u) => u.user_id.toLowerCase() === session?.user.email.toLowerCase())?.desk ?? null;
  const sorted = [...desks].sort(
    (a, b) => Number(b.desk === myDesk) - Number(a.desk === myDesk) || b.total_cost - a.total_cost,
  );

  return (
    <div>
      <PageTitle
        title="Desks"
        subtitle={`Self-service per-desk view — ${fmtMonth(month)}, live figures`}
      >
        <MonthModePicker
          months={months}
          publishedMonths={publishedMonths}
          month={month}
          mode="live"
          showModeToggle={false}
        />
      </PageTitle>

      {sorted.length === 0 ? (
        <EmptyState message="No desk has cost in the selected month." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((d) => (
            <Link key={d.desk} href={`/desks/${encodeURIComponent(d.desk)}?month=${month}`}>
              <Card
                className={`h-full transition hover:border-indigo-300 hover:shadow ${
                  d.desk === myDesk ? "border-indigo-400 ring-1 ring-indigo-200" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-900">{d.desk}</h2>
                  {d.desk === myDesk && (
                    <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700">
                      your desk
                    </span>
                  )}
                </div>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {fmtMoney(d.total_cost)}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{fmtMonth(month)}, live</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
