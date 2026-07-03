export const PAGE_SIZE = 25;

export interface Paged<T> {
  rows: T[];
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
}

/**
 * Slice a full result set to one page. The requested page comes straight from
 * the URL (?page=), so it is clamped: out-of-range or garbage values land on
 * the nearest valid page rather than an empty table — a stale link after rows
 * were fixed/removed still shows data.
 */
export function paginate<T>(
  rows: T[],
  pageParam: string | undefined,
  pageSize: number = PAGE_SIZE,
): Paged<T> {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const requested = Number.parseInt(pageParam ?? "1", 10);
  const page = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), pageCount) : 1;
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), page, pageCount, total, pageSize };
}
