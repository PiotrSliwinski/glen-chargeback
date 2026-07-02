import type { ReportMode } from "@/dal/types";

/** Makes live vs published unmistakable on every reporting page. */
export function ModeBanner({
  mode,
  publishedMonth,
}: {
  mode: ReportMode;
  publishedMonth: boolean;
}) {
  if (mode === "published" && publishedMonth) {
    return (
      <div className="no-print mb-4 rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
        Published snapshot — immutable; this is what desks are invoiced from.
      </div>
    );
  }
  if (mode === "published") return null; // "not published" handled by the page
  return (
    <div className="no-print mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
      You are viewing <strong>live, unpublished</strong> figures — they move as mappings change.
    </div>
  );
}
