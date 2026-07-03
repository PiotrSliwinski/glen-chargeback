import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getDesks } from "@/dal/reports";
import { listUsers } from "@/dal/mappings";
import { fmtMoney, fmtMonth } from "@/lib/format";
import { resolveReportParams, type SearchParams } from "@/lib/report-params";
import { PAGE_HELP } from "@/lib/kpi-help";
import { EmptyState, PageTitle } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MonthModePicker } from "@/components/month-picker";
import { DeskGridSkeleton } from "@/components/loading-skeletons";
import { SearchParamsSuspense } from "@/components/keyed-suspense";

export const metadata = { title: "Desks" };

export default function DesksPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <SearchParamsSuspense searchParams={searchParams} fallback={<DeskGridSkeleton />}>
      <Desks searchParams={searchParams} />
    </SearchParamsSuspense>
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
          {sorted.map((d) => (
            <Link key={d.desk} href={`/desks/${encodeURIComponent(d.desk)}?month=${month}`}>
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
                  <p className="mt-2 text-2xl font-semibold">{fmtMoney(d.total_cost)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{fmtMonth(month)}, live</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
