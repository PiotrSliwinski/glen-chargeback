import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getDesks } from "@/dal/reports";
import { listUsers } from "@/dal/mappings";
import { fmtMoney, fmtMonth, momKpi, shiftMonth } from "@/lib/format";
import { resolveReportParams, type SearchParams } from "@/lib/report-params";
import { PAGE_HELP } from "@/lib/kpi-help";
import { EmptyState, PageTitle } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MonthModePicker } from "@/components/month-picker";
import { DeskGridSkeleton } from "@/components/loading-skeletons";
import { SearchParamsSuspense } from "@/components/keyed-suspense";

export const metadata = { title: "Desks" };

export const unstable_instant = {
  // dev-only: skip the instant-nav validation prerender (re-runs on every
  // load/HMR; still validated at build). See app/(app)/page.tsx for why.
  unstable_disableDevValidation: true,
  prefetch: "runtime",
  samples: [{ searchParams: { month: null, mode: null } }],
};

export default function DesksPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <SearchParamsSuspense searchParams={searchParams} fallback={<DeskGridSkeleton />}>
      <Desks searchParams={searchParams} />
    </SearchParamsSuspense>
  );
}

async function Desks({ searchParams }: { searchParams: SearchParams }) {
  const { month, months, publishedMonths } = await resolveReportParams(searchParams);
  const prevMonth = shiftMonth(month, -1);
  const [desks, prevDesks, users, session] = await Promise.all([
    getDesks(month, "live"),
    getDesks(prevMonth, "live"),
    listUsers(),
    getSession(),
  ]);
  const prevByDesk = new Map(prevDesks.map((d) => [d.desk, d.total_cost]));
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
        info={PAGE_HELP.desks}
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
          {sorted.map((d) => {
            const prev = prevByDesk.get(d.desk);
            const mom = momKpi(d.total_cost, prev ?? null, fmtMonth(prevMonth));
            return (
              <Link
                key={d.desk}
                href={`/desks/${encodeURIComponent(d.desk)}?month=${month}`}
                className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <Card
                  className={`h-full transition hover:shadow hover:ring-ring/50 ${
                    d.desk === myDesk ? "ring-ring/40" : ""
                  }`}
                >
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold">{d.desk}</h2>
                      {d.desk === myDesk && (
                        <Badge variant="secondary" className="bg-indigo-100 text-indigo-700">
                          your desk
                        </Badge>
                      )}
                    </div>
                    <p className="mt-2 text-2xl font-semibold tabular-nums">
                      {fmtMoney(d.total_cost)}
                    </p>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        {prev == null ? `no ${fmtMonth(prevMonth)} cost to compare` : `${mom.value} vs ${fmtMonth(prevMonth)}`}
                      </p>
                      <span className="text-xs font-medium text-indigo-600 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                        View desk →
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
