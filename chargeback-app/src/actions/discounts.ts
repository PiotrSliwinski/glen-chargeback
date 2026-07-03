"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { dateString, optionalText, parseForm, runAction } from "@/actions/run";
import * as dal from "@/dal/discounts";
import { DomainError } from "@/services/errors";

/** Discounts re-price live views, so cost figures everywhere go stale. */
function invalidateDiscounts() {
  updateTag("mappings");
  updateTag("queue");
  updateTag("reports-live");
  updateTag("health");
}

const AddDiscount = z.object({
  valid_from: dateString,
  valid_to: dateString,
  // entered as a percentage (27 = 27% off list price), stored as a 0–1 fraction
  discount_pct: z.coerce.number().gt(0, "must be above 0%").lte(100, "cannot exceed 100%"),
  note: optionalText,
});

export async function addDbuDiscountAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async (actor) => {
    const input = parseForm(formData, AddDiscount);
    if (input.valid_to < input.valid_from) {
      throw new DomainError("VALIDATION", "the last covered day cannot be before the first");
    }
    // one discount per day: [from, to] windows are inclusive on both ends
    const existing = await dal.listDbuDiscounts();
    const clash = existing.find(
      (d) => input.valid_from <= d.valid_to && d.valid_from <= input.valid_to,
    );
    if (clash) {
      throw new DomainError(
        "DUPLICATE_KEY",
        `window overlaps the existing plan ${clash.valid_from} → ${clash.valid_to} (${(clash.discount_pct * 100).toFixed(2).replace(/\.?0+$/, "")}%) — remove or shorten that plan first`,
      );
    }
    await dal.insertDbuDiscount(
      {
        valid_from: input.valid_from,
        valid_to: input.valid_to,
        discount_pct: input.discount_pct / 100,
        note: input.note,
      },
      actor,
    );
    invalidateDiscounts();
    return `Reservation plan recorded: ${input.discount_pct}% off the DBU list price from ${input.valid_from} to ${input.valid_to}. Databricks DBU spend in that window re-prices in all live views immediately; published months are unaffected.`;
  });
}

const DeleteDiscount = z.object({
  valid_from: dateString,
  valid_to: dateString,
});

export async function deleteDbuDiscountAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const input = parseForm(formData, DeleteDiscount);
    const existing = await dal.listDbuDiscounts();
    if (!existing.some((d) => d.valid_from === input.valid_from && d.valid_to === input.valid_to)) {
      throw new DomainError(
        "NOT_FOUND",
        `no reservation plan covers ${input.valid_from} → ${input.valid_to}`,
      );
    }
    await dal.deleteDbuDiscount(input.valid_from, input.valid_to);
    invalidateDiscounts();
    return `Reservation plan removed. DBU spend from ${input.valid_from} to ${input.valid_to} re-prices at full list in all live views; published months keep the figures they were published with.`;
  });
}
