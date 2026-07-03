"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/format";

/**
 * Pager under a table. Server pages slice with paginate() and pass the result
 * here; the current page lives in the URL (?page= by default, `paramName` for
 * pages with several paginated tables) so paged views stay linkable, matching
 * the TableFilter idiom. `paramName` must be "page" or end in "Page"
 * (tagsPage, runnersPage…) — TableFilter resets exactly those params when the
 * filter changes. Client-side tables pass `onPageChange` instead and keep the
 * page in local state.
 *
 * Renders nothing when everything fits on one page, so it can sit under every
 * table unconditionally. Hidden in print — printed pages get the current page
 * only, same as the screen.
 */
export function TablePagination({
  page,
  pageCount,
  total,
  pageSize,
  noun,
  paramName = "page",
  onPageChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  noun: string;
  paramName?: string;
  onPageChange?: (page: number) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (total <= pageSize) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  function goTo(next: number) {
    if (onPageChange) {
      onPageChange(next);
      return;
    }
    const params = new URLSearchParams(searchParams);
    if (next <= 1) params.delete(paramName);
    else params.set(paramName, String(next));
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  }

  return (
    <nav
      aria-label={`Pagination — ${noun}s`}
      className="no-print mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3"
    >
      <p className="text-xs tabular-nums text-muted-foreground">
        Showing {start}–{end} of {total} {plural(total, noun)}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => goTo(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft aria-hidden /> Prev
        </Button>
        <span className="text-xs tabular-nums text-muted-foreground" aria-current="page">
          Page {page} of {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pageCount}
          onClick={() => goTo(page + 1)}
          aria-label="Next page"
        >
          Next <ChevronRight aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
