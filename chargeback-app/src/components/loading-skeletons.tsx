import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/**
 * Page-shaped loading states shown while Databricks queries stream in.
 * Each mirrors the layout of the page it stands in for, so the swap from
 * skeleton to data doesn't jump.
 */

function LoadingShell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-label={label}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function PageHeaderSkeleton({ withPicker = true }: { withPicker?: boolean }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <Skeleton className="h-6 w-56" />
        <Skeleton className="mt-1.5 h-4 w-72" />
      </div>
      {withPicker && (
        <div className="flex gap-2">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-8 w-40" />
        </div>
      )}
    </div>
  );
}

export function KpiRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} size="sm">
          <CardContent>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-7 w-28" />
            <Skeleton className="mt-1.5 h-3 w-32" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ChartCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <Skeleton className="h-4 w-48" />
      </CardHeader>
      <CardContent className="space-y-2.5">
        <Skeleton className="h-4 w-[90%]" />
        <Skeleton className="h-4 w-[70%]" />
        <Skeleton className="h-4 w-[55%]" />
        <Skeleton className="h-4 w-[40%]" />
        <Skeleton className="h-4 w-[25%]" />
      </CardContent>
    </Card>
  );
}

export function TableCardSkeleton({ rows = 6 }: { rows?: number }) {
  // Varied widths per cell so the shimmer reads as a table, not stripes.
  const widths = ["w-40", "w-24", "w-32", "w-20"];
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-52" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {Array.from({ length: rows }, (_, r) => (
            <div key={r} className="flex items-center justify-between gap-4">
              {widths.map((w, c) => (
                <Skeleton key={c} className={`h-4 ${w} ${c > 0 ? "max-sm:hidden" : ""}`} />
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i}>
          <CardContent>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-3 h-7 w-24" />
            <Skeleton className="mt-1.5 h-3 w-28" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Dashboard: KPI row + two chart cards + full-width coverage card. */
export function DashboardSkeleton() {
  return (
    <LoadingShell label="Loading dashboard from Databricks…">
      <PageHeaderSkeleton />
      <KpiRowSkeleton />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCardSkeleton />
        <ChartCardSkeleton />
        <ChartCardSkeleton className="lg:col-span-2" />
      </div>
    </LoadingShell>
  );
}

/** Generic report page: header + optional KPI row + one or more tables. */
export function TablePageSkeleton({
  label = "Loading data from Databricks…",
  kpis = false,
  tables = 1,
  rows = 6,
  withPicker = true,
}: {
  label?: string;
  kpis?: boolean;
  tables?: number;
  rows?: number;
  withPicker?: boolean;
}) {
  return (
    <LoadingShell label={label}>
      <PageHeaderSkeleton withPicker={withPicker} />
      {kpis && <KpiRowSkeleton />}
      <div className="space-y-4">
        {Array.from({ length: tables }, (_, i) => (
          <TableCardSkeleton key={i} rows={rows} />
        ))}
      </div>
    </LoadingShell>
  );
}

/** Desks index: header + grid of desk cost cards. */
export function DeskGridSkeleton() {
  return (
    <LoadingShell label="Loading desks from Databricks…">
      <PageHeaderSkeleton />
      <CardGridSkeleton />
    </LoadingShell>
  );
}

/** Desk detail / monthly report: KPIs, a chart and tables. */
export function ReportSkeleton({ label = "Assembling report from Databricks…" }: { label?: string }) {
  return (
    <LoadingShell label={label}>
      <PageHeaderSkeleton />
      <KpiRowSkeleton />
      <div className="space-y-4">
        <ChartCardSkeleton />
        <TableCardSkeleton rows={8} />
      </div>
    </LoadingShell>
  );
}
