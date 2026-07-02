import { env } from "@/lib/env";
import { exec, T } from "@/dal/client";
import { mockStore } from "@/dal/mock";
import { monthStart } from "@/lib/format";

/**
 * Monthly publication (Methodology §9): snapshot the closed month into
 * monthly_chargeback_published. Desks are invoiced from the snapshot only —
 * mapping edits after publication never change an issued invoice.
 * Single INSERT…SELECT = atomic.
 */
export async function publishMonth(month: string): Promise<void> {
  if (env.DAL_MOCK) {
    if (!mockStore.publishedMonths.includes(month)) mockStore.publishedMonths.push(month);
    return;
  }
  await exec(
    `INSERT INTO ${T("monthly_chargeback_published")}
     SELECT current_timestamp() AS published_at, billing_month AS snapshot_month, *
     FROM ${T("monthly_chargeback")}
     WHERE billing_month = :month`,
    { month: monthStart(month) },
  );
}
