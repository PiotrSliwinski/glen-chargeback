import Link from "next/link";
import {
  getAzureDeskTotals,
  getAzureResourceAttributions,
  listAzureResourceMappings,
} from "@/dal/azure";
import { KPI_HELP } from "@/lib/kpi-help";
import { fmtMoney } from "@/lib/format";
import { AZURE_METHOD_STYLE, AzureMethodBadge, EmptyState, FilteredCount, KpiTile } from "@/components/ui";
import { TableFilter } from "@/components/table-filter";
import { TablePagination } from "@/components/table-pagination";
import { paginate } from "@/lib/paginate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  AzureAttributionMethod,
  AzureResourceAttributionRow,
  AzureResourceMappingRow,
} from "@/dal/types";

const METHOD_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All resources" },
  { key: "TAG", label: "Tagged at source" },
  { key: "RESOURCE_MAPPING", label: "Via bridge" },
  { key: "TAG_RULE", label: "Via tag rule" },
  { key: "RESOURCE_GROUP", label: "Via RG rule" },
  { key: "SUBSCRIPTION", label: "Via subscription" },
  { key: "NONE", label: "Unmatched" },
];

/** Union of a resource group's tags across its attribution slices. */
function resourceTags(rows: AzureResourceAttributionRow[]): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const r of rows) {
    if (!r.tags_json) continue;
    try {
      Object.assign(tags, JSON.parse(r.tags_json));
    } catch {
      // malformed tags_json — skip the slice, never break the page
    }
  }
  return tags;
}

interface ResourceGroup {
  resource_id: string;
  resource_name: string | null;
  subscription_id: string;
  resource_group: string | null;
  meter_category: string | null;
  rows: AzureResourceAttributionRow[];
  methods: Set<AzureAttributionMethod>;
  total_cost: number;
  bridge: AzureResourceMappingRow | undefined;
}

/** Read-only audit: how every Azure resource with recent cost was attributed. */
export async function CoverageView({
  q,
  method,
  page,
}: {
  q: string;
  method: string;
  page?: string;
}) {
  const query = q.toLowerCase();

  const [attributions, bridges, deskTotals] = await Promise.all([
    getAzureResourceAttributions(),
    listAzureResourceMappings(),
    getAzureDeskTotals(),
  ]);
  const bridgeByKey = new Map(bridges.map((b) => [b.resource_id, b]));

  // one group per resource; a resource can attribute via several methods within the window
  const groups = new Map<string, ResourceGroup>();
  for (const row of attributions) {
    const g = groups.get(row.resource_id) ?? {
      resource_id: row.resource_id,
      resource_name: row.resource_name,
      subscription_id: row.subscription_id,
      resource_group: row.resource_group,
      meter_category: row.meter_category,
      rows: [],
      methods: new Set<AzureAttributionMethod>(),
      total_cost: 0,
      bridge: bridgeByKey.get(row.resource_id),
    };
    g.rows.push(row);
    g.methods.add(row.attribution_method);
    g.total_cost += row.cost_30d;
    g.resource_name ??= row.resource_name;
    g.meter_category ??= row.meter_category;
    groups.set(row.resource_id, g);
  }
  const all = [...groups.values()].sort((a, b) => b.total_cost - a.total_cost);

  const totalCost = deskTotals.reduce((s, d) => s + d.cost_30d, 0);
  const unmatchedCost = deskTotals.find((d) => d.desk === "UNALLOCATED")?.cost_30d ?? 0;

  const kpis = {
    resources: all.length,
    // disjoint from "Via mapping / rule": a resource mid-transition (tagged AND
    // still bridge-attributed within the window) counts only as a cleanup candidate
    tagged: all.filter((g) => g.methods.has("TAG") && g.methods.size === 1).length,
    mapped: all.filter(
      (g) =>
        g.methods.has("RESOURCE_MAPPING") ||
        g.methods.has("TAG_RULE") ||
        g.methods.has("RESOURCE_GROUP") ||
        g.methods.has("SUBSCRIPTION"),
    ).length,
    attributedCost: totalCost - unmatchedCost,
  };

  const matchesQ = (g: ResourceGroup) =>
    !query ||
    [
      g.resource_name ?? "",
      g.resource_id,
      g.subscription_id,
      g.resource_group ?? "",
      g.meter_category ?? "",
      ...g.rows.flatMap((r) => [r.data_product, r.desk]),
      ...Object.entries(resourceTags(g.rows)).map(([k, v]) => `${k}=${v}`),
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  const shown = all.filter(
    (g) => matchesQ(g) && (method === "all" || g.methods.has(method as AzureAttributionMethod)),
  );
  const { rows: pageGroups, ...paged } = paginate(shown, page);

  const attributedDesks = deskTotals.filter((d) => d.desk !== "UNALLOCATED");

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiTile
          label="Resources seen 30d"
          value={String(kpis.resources)}
          info={KPI_HELP.azureResourcesSeen30d}
        />
        <KpiTile
          label="Tagged at source"
          value={String(kpis.tagged)}
          hint="attribute via TAG only — goal state"
          tone="good"
          info={KPI_HELP.azureTagged}
        />
        <KpiTile
          label="Via mapping / rule"
          value={String(kpis.mapped)}
          hint="candidates for tagging at source"
          tone={kpis.mapped > 0 ? "warn" : "good"}
          info={KPI_HELP.azureBridged}
        />
        <KpiTile
          label="Attributed cost 30d"
          value={fmtMoney(kpis.attributedCost)}
          hint={`of ${fmtMoney(totalCost)} total — the rest stays unallocated`}
          info={KPI_HELP.azureAttributedCost}
          infoAlign="end"
        />
      </div>

      {attributedDesks.length > 0 && (
        <Card className="mb-6" size="sm">
          <CardHeader>
            <CardTitle>Azure cost reaching desks — last 30 days</CardTitle>
            <CardDescription className="text-xs">
              The attributed slice, split by desk via the shared product catalogue (multi-desk %
              splits applied). Unmatched cost ({fmtMoney(unmatchedCost)}) is not billed to any
              desk.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              {attributedDesks.map((d) => (
                <p key={d.desk} className="text-sm">
                  <span className="font-medium">{d.desk}</span>{" "}
                  <span className="tabular-nums text-muted-foreground">
                    {fmtMoney(d.cost_30d)}
                  </span>
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        {METHOD_FILTERS.map((f) => {
          const href = `/admin/azure?${new URLSearchParams({
            view: "coverage",
            ...(f.key !== "all" ? { method: f.key } : {}),
            ...(q ? { q } : {}),
          })}`;
          const active = method === f.key;
          return (
            <Button key={f.key} asChild size="sm" variant={active ? "default" : "outline"}>
              <Link href={href}>{f.label}</Link>
            </Button>
          );
        })}
        <div className="ml-auto">
          <TableFilter placeholder="Filter by resource, RG, subscription, product, desk…" />
        </div>
      </div>

      <Card>
        <CardContent>
          {shown.length === 0 ? (
            <EmptyState
              message={
                all.length === 0
                  ? "No Azure cost in the trailing 30 days."
                  : "No resources match the current filter."
              }
            />
          ) : (
            <>
              {(q || method !== "all") && (
                <FilteredCount shown={shown.length} total={all.length} noun="resource" />
              )}
              <Table className="align-top">
                <TableHeader>
                  <TableRow>
                    <TableHead>Resource</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Tags on the resource</TableHead>
                    <TableHead>Attributed as</TableHead>
                    <TableHead className="text-right">Cost 30d</TableHead>
                    <TableHead>Bridge row</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageGroups.map((g) => (
                    <TableRow key={g.resource_id}>
                      <TableCell>
                        <p className="text-sm font-medium">{g.resource_name ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">
                          {g.meter_category ?? "—"}
                        </p>
                      </TableCell>
                      <TableCell className="text-xs">
                        <p
                          className="max-w-32 truncate font-mono"
                          title={g.resource_group ?? undefined}
                        >
                          {g.resource_group ?? "—"}
                        </p>
                        <p
                          className="max-w-32 truncate font-mono text-muted-foreground"
                          title={g.subscription_id}
                        >
                          {g.subscription_id}
                        </p>
                      </TableCell>
                      <TableCell>
                        <ResourceTagChips tags={resourceTags(g.rows)} />
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1.5">
                          {[...g.rows]
                            .sort((a, b) => b.cost_30d - a.cost_30d)
                            .map((r) => (
                              <div
                                key={`${r.attribution_method}|${r.data_product}|${r.desk}`}
                                className="flex flex-wrap items-center gap-2 text-xs"
                              >
                                <AzureMethodBadge method={r.attribution_method} />
                                <span className="font-mono">{r.data_product}</span>
                                <span className="text-muted-foreground">→ desk {r.desk}</span>
                                <span className="tabular-nums text-muted-foreground">
                                  {fmtMoney(r.cost_30d)}
                                </span>
                              </div>
                            ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtMoney(g.total_cost)}
                      </TableCell>
                      <TableCell className="max-w-44 text-xs text-muted-foreground">
                        {g.bridge ? (
                          <>
                            <p className="font-mono text-foreground">{g.bridge.data_product}</p>
                            <p>
                              {g.bridge.mapped_by ?? "—"}
                              {g.bridge.mapped_at && <> · {g.bridge.mapped_at.slice(0, 10)}</>}
                            </p>
                            {g.bridge.note && <p className="italic">“{g.bridge.note}”</p>}
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <ResourceStatus group={g} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePagination {...paged} noun="resource" />
            </>
          )}
        </CardContent>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        A resource with several “attributed as” lines changed how it attributes within the window
        — e.g. bridge-mapped early, tagged at source since. TAG always wins from the moment the
        tag lands; bridge rows and scope rules only matter for cost nothing earlier in the
        waterfall caught. Unmatched cost stays unallocated by design — Azure attribution is an
        allowlist, and shared platform cost is expected to remain here.
      </p>
    </div>
  );
}

// Most resources carry a dozen boilerplate policy tags; only the first few are
// worth row height. data_product sorts first — it's the input tag rules match on.
const VISIBLE_TAGS = 4;

function TagChip({ k, v, className = "" }: { k: string; v: string; className?: string }) {
  return (
    <Badge
      variant="secondary"
      className={`${
        k === "data_product"
          ? "bg-emerald-100 font-mono text-[11px] text-emerald-800"
          : "bg-muted font-mono text-[11px] text-muted-foreground"
      } ${className}`}
    >
      {k}={v}
    </Badge>
  );
}

/** The resource's tags, data_product highlighted — the input tag rules match on. */
function ResourceTagChips({ tags }: { tags: Record<string, string> }) {
  const entries = Object.entries(tags).sort(([a], [b]) =>
    a === "data_product" ? -1 : b === "data_product" ? 1 : a.localeCompare(b),
  );
  if (entries.length === 0) {
    return <span className="text-xs text-muted-foreground">no tags</span>;
  }
  const head = entries.slice(0, VISIBLE_TAGS);
  const rest = entries.slice(VISIBLE_TAGS);
  if (rest.length === 0) {
    return (
      <div className="flex max-w-64 flex-wrap gap-1">
        {head.map(([k, v]) => (
          <TagChip key={k} k={k} v={v} />
        ))}
      </div>
    );
  }
  // native <details> keeps this a server component — no client JS for the toggle
  return (
    <details className="group max-w-64">
      <summary className="flex cursor-pointer list-none flex-wrap gap-1 [&::-webkit-details-marker]:hidden">
        {head.map(([k, v]) => (
          <TagChip key={k} k={k} v={v} />
        ))}
        {rest.map(([k, v]) => (
          <TagChip key={k} k={k} v={v} className="hidden group-open:inline-flex" />
        ))}
        <Badge variant="outline" className="text-[11px] text-muted-foreground group-open:hidden">
          +{rest.length} more
        </Badge>
        <Badge
          variant="outline"
          className="hidden text-[11px] text-muted-foreground group-open:inline-flex"
        >
          show less
        </Badge>
      </summary>
    </details>
  );
}

// Status chips reuse the Azure waterfall palette from AZURE_METHOD_STYLE — one
// source of truth, so the status column always matches the method badges.
function ResourceStatus({ group }: { group: ResourceGroup }) {
  if (group.methods.has("NONE")) {
    return (
      <Badge variant="secondary" className={AZURE_METHOD_STYLE.NONE.chip}>
        unmatched — not billed
      </Badge>
    );
  }
  if (group.methods.has("TAG") && group.bridge) {
    return (
      <Badge variant="secondary" className={AZURE_METHOD_STYLE.TAG.chip}>
        tag landed — bridge removable
      </Badge>
    );
  }
  if (group.methods.has("RESOURCE_MAPPING")) {
    return (
      <Badge variant="secondary" className={AZURE_METHOD_STYLE.RESOURCE_MAPPING.chip}>
        via bridge — tag at source
      </Badge>
    );
  }
  if (group.methods.has("TAG_RULE")) {
    return (
      <Badge variant="secondary" className={AZURE_METHOD_STYLE.TAG_RULE.chip}>
        via tag rule
      </Badge>
    );
  }
  if (group.methods.has("RESOURCE_GROUP")) {
    return (
      <Badge variant="secondary" className={AZURE_METHOD_STYLE.RESOURCE_GROUP.chip}>
        via RG rule
      </Badge>
    );
  }
  if (group.methods.has("SUBSCRIPTION")) {
    return (
      <Badge variant="secondary" className={AZURE_METHOD_STYLE.SUBSCRIPTION.chip}>
        via subscription rule
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className={AZURE_METHOD_STYLE.TAG.chip}>
      tagged at source
    </Badge>
  );
}
