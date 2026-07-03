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

export const metadata = { title: "Azure attribution" };

const VIEWS = {
  rules: {
    label: "Mapping rules",
    subtitle:
      "How Azure spend reaches a product when the resource isn't tagged at source: per-resource bridge rows (rule 2), tag rules (rule 3), resource-group rules (rule 4) and subscription rules (rule 5). Attribution is an allowlist — unmatched Azure cost stays unallocated and never reaches a desk.",
    info: PAGE_HELP.azure,
  },
  coverage: {
    label: "Coverage — last 30 days",
    subtitle:
      "Every Azure resource that emitted cost in the trailing 30 days, the tags it actually carries, and how it was attributed — tag, bridge row, tag rule, resource-group rule, subscription rule, or nothing.",
    info: PAGE_HELP.azureCoverage,
  },
} as const;
type View = keyof typeof VIEWS;

export default function AzurePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<TablePageSkeleton label="Loading Azure attribution from Databricks…" kpis withPicker={false} />}>
      <Azure searchParams={searchParams} />
    </Suspense>
  );
}

async function Azure({ searchParams }: { searchParams: SearchParams }) {
  await requirePageRole("steward");
  const sp = await searchParams;
  const view: View = param(sp.view) === "coverage" ? "coverage" : "rules";
  const q = param(sp.q) ?? "";
  const method = param(sp.method) ?? "all";

  return (
    <div>
      <PageTitle title="Azure attribution" subtitle={VIEWS[view].subtitle} info={VIEWS[view].info}>
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
          <CoverageView q={q} method={method} page={param(sp.page)} />
        ) : (
          <MappingsView
            q={q}
            pages={{
              bridge: param(sp.page),
              tags: param(sp.tagsPage),
              rgs: param(sp.rgsPage),
              subs: param(sp.subsPage),
            }}
          />
        )}
      </Suspense>
    </div>
  );
}

/** Segmented control switching between the two views; state lives in ?view= so both are linkable. */
function ViewTabs({ view, q }: { view: View; q: string }) {
  return (
    <nav aria-label="Azure attribution views" className="no-print inline-flex items-center gap-1 rounded-lg bg-muted p-1">
      {(Object.keys(VIEWS) as View[]).map((key) => {
        const params = new URLSearchParams({
          ...(key === "coverage" ? { view: "coverage" } : {}),
          ...(q ? { q } : {}),
        });
        const active = view === key;
        return (
          <Link
            key={key}
            href={`/admin/azure${params.size ? `?${params}` : ""}`}
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
