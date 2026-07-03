import { Suspense } from "react";
import { redirect } from "next/navigation";
import { param, type SearchParams } from "@/lib/report-params";
import { TablePageSkeleton } from "@/components/loading-skeletons";

/**
 * Coverage merged into /admin/jobs as the "coverage" view — this route only
 * keeps old deep links (bookmarks, ?q= drill-downs) working.
 */
export default function LegacyJobCoveragePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <Suspense fallback={<TablePageSkeleton label="Redirecting…" withPicker={false} />}>
      <Redirector searchParams={searchParams} />
    </Suspense>
  );
}

async function Redirector({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<React.ReactNode> {
  const sp = await searchParams;
  const params = new URLSearchParams({ view: "coverage" });
  const q = param(sp.q);
  const method = param(sp.method);
  if (q) params.set("q", q);
  if (method) params.set("method", method);
  redirect(`/admin/jobs?${params}`);
}
