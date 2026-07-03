import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { env } from "@/lib/env";
import { exec, query, T } from "@/dal/client";
import { mockStore } from "@/dal/mock";
import { zDate, zNum, zStrOrNull } from "@/dal/parse";
import type { DbuDiscountRow } from "@/dal/types";

/**
 * DBU reservation-plan discounts (§4.9): date windows granting a % discount
 * off the DBU list price. The discount is applied at pricing time inside
 * query_view / usage_view (DBU-metered Databricks spend only), so everything
 * derived — cost_fact, monthly_chargeback, desk invoices — inherits the
 * discounted rate. Non-overlap is enforced by the actions and re-checked on
 * the health page. Plain persistence, same contract as dal/mappings.
 */

export async function listDbuDiscounts(): Promise<DbuDiscountRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("mappings");
  if (env.DAL_MOCK) {
    return [...mockStore.dbuDiscounts].sort((a, b) => b.valid_from.localeCompare(a.valid_from));
  }
  return query(
    `SELECT valid_from, valid_to, discount_pct, note, mapped_by, mapped_at
     FROM ${T("dbu_discount_plan")} ORDER BY valid_from DESC`,
    {},
    z.object({
      valid_from: zDate,
      valid_to: zDate,
      discount_pct: zNum,
      note: zStrOrNull,
      mapped_by: zStrOrNull,
      mapped_at: zStrOrNull,
    }) as z.ZodType<DbuDiscountRow>,
  );
}

export async function insertDbuDiscount(
  row: Pick<DbuDiscountRow, "valid_from" | "valid_to" | "discount_pct" | "note">,
  actor: string,
): Promise<void> {
  if (env.DAL_MOCK) {
    mockStore.dbuDiscounts.push({ ...row, mapped_by: actor, mapped_at: new Date().toISOString() });
    return;
  }
  await exec(
    `INSERT INTO ${T("dbu_discount_plan")}
       (valid_from, valid_to, discount_pct, note, mapped_by, mapped_at)
     VALUES (:valid_from, :valid_to, :discount_pct, :note, :actor, current_timestamp())`,
    { ...row, actor },
  );
}

/** Windows never overlap, so (valid_from, valid_to) identifies one plan. */
export async function deleteDbuDiscount(valid_from: string, valid_to: string): Promise<void> {
  if (env.DAL_MOCK) {
    mockStore.dbuDiscounts = mockStore.dbuDiscounts.filter(
      (d) => !(d.valid_from === valid_from && d.valid_to === valid_to),
    );
    return;
  }
  await exec(
    `DELETE FROM ${T("dbu_discount_plan")}
     WHERE valid_from = :valid_from AND valid_to = :valid_to`,
    { valid_from, valid_to },
  );
}
