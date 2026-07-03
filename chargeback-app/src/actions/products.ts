"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { dateString, optionalText, parseForm, runAction } from "@/actions/run";
import * as catalogue from "@/services/productCatalogue";

function invalidateCatalogue() {
  updateTag("catalogue");
  updateTag("queue"); // rogue-tag queue reflects catalogue membership
  updateTag("reports-live"); // live attribution changes immediately
  updateTag("health");
}

/**
 * Desk split as posted by <SplitEditor>: a JSON array of { desk, pct }
 * rows, pct in percent. Semantic rules (sum = 100%, unique desks) are
 * enforced in the service layer.
 */
const splitsField = z
  .string()
  .transform((v, ctx): { desk: string; pct: number }[] => {
    try {
      const parsed: unknown = JSON.parse(v);
      if (
        Array.isArray(parsed) &&
        parsed.every(
          (r) =>
            r != null &&
            typeof r === "object" &&
            typeof (r as { desk?: unknown }).desk === "string" &&
            typeof (r as { pct?: unknown }).pct === "number",
        )
      ) {
        return parsed as { desk: string; pct: number }[];
      }
    } catch {
      // fall through to the issue below
    }
    ctx.addIssue({ code: "custom", message: "expected desk split rows" });
    return z.NEVER;
  });

function describeSplits(splits: { desk: string; pct: number }[]): string {
  if (splits.length === 1) return `desk ${splits[0].desk}`;
  return `desks ${splits.map((s) => `${s.desk} (${s.pct}%)`).join(" + ")}`;
}

const CreateProduct = z.object({
  data_product: z.string().min(1),
  data_domain: z.string().min(1),
  splits: splitsField,
  product_owner: optionalText,
  valid_from: dateString,
});

export async function createProductAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async (actor) => {
    const input = parseForm(formData, CreateProduct);
    await catalogue.createProduct(input, actor);
    invalidateCatalogue();
    return `Product '${input.data_product}' registered on ${describeSplits(input.splits)} (valid from ${input.valid_from}).`;
  });
}

const MoveProduct = z.object({
  data_product: z.string().min(1),
  cutover: dateString,
  new_domain: z.string().min(1),
  splits: splitsField,
  new_owner: optionalText,
});

export async function moveProductAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async (actor) => {
    const input = parseForm(formData, MoveProduct);
    await catalogue.moveProduct(input, actor);
    invalidateCatalogue();
    return `'${input.data_product}' moves to ${describeSplits(input.splits)} in ${input.new_domain} on ${input.cutover}. History before the cutover keeps the old desk split; published months are unaffected.`;
  });
}

const RetireProduct = z.object({
  data_product: z.string().min(1),
  valid_to: dateString,
});

export async function retireProductAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async (actor) => {
    const input = parseForm(formData, RetireProduct);
    await catalogue.retireProduct(input.data_product, input.valid_to, actor);
    invalidateCatalogue();
    return `'${input.data_product}' retired as of ${input.valid_to}. Later usage will fall to the work queue.`;
  });
}

const UpdateOwner = z.object({
  data_product: z.string().min(1),
  product_owner: optionalText,
});

export async function updateOwnerAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async (actor) => {
    const input = parseForm(formData, UpdateOwner);
    await catalogue.updateProductOwner(input.data_product, input.product_owner, actor);
    updateTag("catalogue");
    return `Owner updated for '${input.data_product}'.`;
  });
}
