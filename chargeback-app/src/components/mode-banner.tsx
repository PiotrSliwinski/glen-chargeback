import { Alert, AlertDescription } from "@/components/ui/alert";
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
      <Alert className="no-print mb-4 border-indigo-200 bg-indigo-50">
        <AlertDescription className="text-indigo-800">
          Published snapshot — immutable; this is what desks are invoiced from.
        </AlertDescription>
      </Alert>
    );
  }
  if (mode === "published") return null; // "not published" handled by the page
  return (
    <Alert className="no-print mb-4 border-amber-200 bg-amber-50">
      <AlertDescription className="text-amber-800">
        You are viewing <strong>live, unpublished</strong> figures — they move as mappings change.
      </AlertDescription>
    </Alert>
  );
}
