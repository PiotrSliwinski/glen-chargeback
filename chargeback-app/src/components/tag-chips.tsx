import { Badge } from "@/components/ui/badge";

/**
 * Shared tag-chip display for the coverage audits (/admin/jobs and
 * /admin/azure): the entity's actual tags, data_product highlighted — the
 * input tag rules match on. One implementation so both screens collapse,
 * sort and highlight identically.
 */

/** Union of tags_json across a group's attribution slices — defensive parse. */
export function mergeTagsJson(rows: { tags_json: string | null }[]): Record<string, string> {
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

// Most entities carry a dozen boilerplate platform/policy tags; only the first
// few are worth row height. data_product sorts first — it's the input tag
// rules match on.
const VISIBLE_TAGS = 4;

export function TagChip({ k, v, className = "" }: { k: string; v: string; className?: string }) {
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

export function TagChips({ tags }: { tags: Record<string, string> }) {
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
  // native <details> keeps this a server component — no client JS for the
  // toggle; all chips live in the summary so the list wraps as one flow
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
