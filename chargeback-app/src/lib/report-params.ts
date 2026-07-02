import { getAvailableMonths, getPublishedMonths } from "@/dal/reports";
import type { ReportMode } from "@/dal/types";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export interface ReportParams {
  month: string;
  mode: ReportMode;
  months: string[];
  publishedMonths: string[];
  sp: Record<string, string | string[] | undefined>;
}

const str = (v: string | string[] | undefined): string | undefined =>
  typeof v === "string" ? v : undefined;

/**
 * Month/mode state lives in the URL (?month=2026-06&mode=published).
 * Default month: last closed month (Methodology §10.2).
 */
export async function resolveReportParams(searchParams: SearchParams): Promise<ReportParams> {
  const sp = await searchParams;
  const [months, publishedMonths] = await Promise.all([
    getAvailableMonths(),
    getPublishedMonths(),
  ]);
  const current = new Date().toISOString().slice(0, 7);
  const requested = str(sp.month);
  const month =
    requested && months.includes(requested)
      ? requested
      : (months.find((m) => m < current) ?? months[0] ?? current);
  const mode: ReportMode = str(sp.mode) === "published" ? "published" : "live";
  return { month, mode, months, publishedMonths, sp };
}

export const param = str;
