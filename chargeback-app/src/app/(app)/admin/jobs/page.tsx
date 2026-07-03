import { Suspense } from "react";
import Link from "next/link";
import { requirePageRole } from "@/lib/guards";
import { param, type SearchParams } from "@/lib/report-params";
import { PAGE_HELP } from "@/lib/kpi-help";
import { PageTitle } from "@/components/ui";
import {
  KpiRowSkeleton,
  TableCardSkeleton,
  TablePageSkeleton,
} from "@/components/loading-skeletons";
import { cn } from "@/lib/utils";
import { CoverageView } from "./coverage-view";
import { MappingsView } from "./mappings-view";

export const metadata = { title: "Job attribution" };

const VIEWS = {
  rules: {
    label: "Mapping rules",
    subtitle:
      "How job spend reaches a product when it isn't tagged at source: per-job bridge rows (rule 2), tag rules (rule 3) and runner rules (rule 5). Jobs NEVER default to the runner's desk — unresolved job spend goes to the work queue.",
    info: PAGE_HELP.jobs,
  },
  coverage: {
    label: "Coverage — last 30 days",
    subtitle:
      "Every job that emitted cost in the trailing 30 days, the tags it actually carries, and how it was mapped — tag, bridge row, tag rule, runner rule, or nothing. Jobs never default to the runner's desk.",
    info: PAGE_HELP.jobCoverage,
  },
} as const;
type View = keyof typeof VIEWS;

export default function JobsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<TablePageSkeleton label="Loading job attribution from Databricks…" kpis withPicker={false} />}>
      <Jobs searchParams={searchParams} />
    </Suspense>
  );
}

async function Jobs({ searchParams }: { searchParams: SearchParams }) {
  await requirePageRole("steward");
  const sp = await searchParams;
  const view: View = param(sp.view) === "coverage" ? "coverage" : "rules";
  const q = param(sp.q) ?? "";
  const method = param(sp.method) ?? "all";

  return (
    <div>
      <PageTitle title="Job attribution" subtitle={VIEWS[view].subtitle} info={VIEWS[view].info}>
        <ViewTabs view={view} q={q} />
      </PageTitle>
      {/* keyed on the view so the skeleton re-appears while the other tab's
          (slow) Databricks query streams in — filter changes stay unkeyed */}
      <Suspense
        key={view}
        fallback={
          <div role="status" aria-busy="true" aria-label="Loading…">
            <span className="sr-only">Loading…</span>
            <KpiRowSkeleton />
            <TableCardSkeleton />
          </div>
        }
      >
        {view === "coverage" ? (
          <CoverageView q={q} method={method} />
        ) : (
          <MappingsView q={q} />
        )}
      </Suspense>
    </div>
  );
}

/** Segmented control switching between the two views; state lives in ?view= so both are linkable. */
function ViewTabs({ view, q }: { view: View; q: string }) {
  return (
    <nav aria-label="Job attribution views" className="no-print inline-flex items-center gap-1 rounded-lg bg-muted p-1">
      {(Object.keys(VIEWS) as View[]).map((key) => {
        const params = new URLSearchParams({
          ...(key === "coverage" ? { view: "coverage" } : {}),
          ...(q ? { q } : {}),
        });
        const active = view === key;
        return (
          <Link
            key={key}
            href={`/admin/jobs${params.size ? `?${params}` : ""}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {VIEWS[key].label}
          </Link>
        );
      })}
    </nav>
  );
}
