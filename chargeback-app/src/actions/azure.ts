"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { formList, optionalText, parseForm, runAction } from "@/actions/run";
import * as dal from "@/dal/azure";
import { assertProductExists } from "@/services/productCatalogue";
import { DomainError } from "@/services/errors";

/**
 * Mutations for the Azure attribution rules (setup.sql §4A). Same skeleton
 * as actions/mappings: role check → validate batch up front (§7.4(b):
 * referenced products must exist before commit) → write → invalidate.
 * ARM identifiers are compared case-insensitively — the DAL lowercases them.
 */

function invalidateAzure() {
  updateTag("azure");
  updateTag("health"); // Azure reconciliation reads azure_cost_fact under 'health'
}

const lower = (s: string) => s.trim().toLowerCase();

// ============================== resource bridge ==============================

const MapResource = z.object({
  resource_id: z.string().min(1),
  data_product: z.string().min(1),
  note: optionalText,
});

export async function mapAzureResourceAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async (actor) => {
    const input = parseForm(formData, MapResource);
    await assertProductExists(input.data_product);
    const existing = await dal.listAzureResourceMappings();
    if (existing.some((m) => m.resource_id === lower(input.resource_id))) {
      throw new DomainError(
        "DUPLICATE_KEY",
        `resource '${input.resource_id}' is already mapped — remove it first`,
      );
    }
    await dal.insertAzureResourceMapping(input, actor);
    invalidateAzure();
    return `Resource mapped to '${input.data_product}'. Reminder: the durable fix is a data_product tag on the resource.`;
  });
}

const DeleteResourceMapping = z.object({ resource_id: z.string().min(1) });

export async function deleteAzureResourceMappingAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const input = parseForm(formData, DeleteResourceMapping);
    await dal.deleteAzureResourceMapping(input.resource_id);
    invalidateAzure();
    return "Mapping removed. The resource's future cost attributes via tags or scope rules — or stays unallocated.";
  });
}

export async function bulkDeleteAzureResourceMappingsAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const ids = formList(formData, "keys");
    await dal.deleteAzureResourceMappings(ids);
    invalidateAzure();
    return `${ids.length} bridge mapping${ids.length > 1 ? "s" : ""} removed. Future cost for those resources attributes via tags or scope rules — or stays unallocated.`;
  });
}

const BulkMapResources = z.object({ data_product: z.string().min(1), note: optionalText });

/** Work-queue bulk fix: NEW bridge rows for unmatched resources (vs. re-mapping existing ones). */
export async function bulkMapAzureResourcesAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async (actor) => {
    const ids = [...new Set(formList(formData, "keys"))];
    const input = parseForm(formData, BulkMapResources);
    await assertProductExists(input.data_product);
    const existing = await dal.listAzureResourceMappings();
    const dupes = ids.filter((id) => existing.some((m) => m.resource_id === lower(id)));
    if (dupes.length > 0) {
      throw new DomainError(
        "DUPLICATE_KEY",
        `already mapped: resource${dupes.length > 1 ? "s" : ""} ${dupes.join(", ")}`,
      );
    }
    await dal.insertAzureResourceMappings(ids, input.data_product, input.note, actor);
    invalidateAzure();
    return `${ids.length} resource${ids.length > 1 ? "s" : ""} mapped to '${input.data_product}'. Reminder: the durable fix is a data_product tag on each resource.`;
  });
}

const BulkRemapResources = z.object({ data_product: z.string().min(1), note: optionalText });

export async function bulkRemapAzureResourcesAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async (actor) => {
    const ids = formList(formData, "keys");
    const input = parseForm(formData, BulkRemapResources);
    await assertProductExists(input.data_product);
    const existing = await dal.listAzureResourceMappings();
    const missing = ids.filter((id) => !existing.some((m) => m.resource_id === lower(id)));
    if (missing.length > 0) {
      throw new DomainError(
        "NOT_FOUND",
        `no bridge row for resource${missing.length > 1 ? "s" : ""} ${missing.join(", ")}`,
      );
    }
    await dal.remapAzureResources(ids, input.data_product, input.note, actor);
    invalidateAzure();
    return `${ids.length} resource${ids.length > 1 ? "s" : ""} re-mapped to '${input.data_product}'. Reminder: the durable fix is tagging at source.`;
  });
}

// Tag rules are unified — addTagRuleAction / deleteTagRuleAction in
// actions/mappings handle Azure-scoped rules too (they invalidate the
// 'azure' cache whenever the rule's scope covers Azure).

// ============================== resource-group rules ==============================

const AddRgRule = z.object({
  subscription_id: z.string().min(1),
  resource_group: z.string().min(1),
  data_product: z.string().min(1),
  note: optionalText,
});

export async function addAzureRgRuleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async (actor) => {
    const input = parseForm(formData, AddRgRule);
    await assertProductExists(input.data_product);
    const existing = await dal.listAzureRgRules();
    if (
      existing.some(
        (r) =>
          r.subscription_id === lower(input.subscription_id) &&
          r.resource_group === lower(input.resource_group),
      )
    ) {
      throw new DomainError(
        "DUPLICATE_KEY",
        `resource group '${input.resource_group}' in that subscription already has a rule`,
      );
    }
    await dal.insertAzureRgRule(input, actor);
    invalidateAzure();
    return `Rule created: everything in resource group '${input.resource_group}' → '${input.data_product}' — present and future resources included.`;
  });
}

const EditRgRule = z.object({
  subscription_id: z.string().min(1),
  resource_group: z.string().min(1),
  data_product: z.string().min(1),
  note: optionalText,
});

/** Re-point an RG rule at a new product; subscription + RG stay fixed. */
export async function editAzureRgRuleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async (actor) => {
    const input = parseForm(formData, EditRgRule);
    await assertProductExists(input.data_product);
    const existing = await dal.listAzureRgRules();
    if (
      !existing.some(
        (r) =>
          r.subscription_id === lower(input.subscription_id) &&
          r.resource_group === lower(input.resource_group),
      )
    ) {
      throw new DomainError(
        "NOT_FOUND",
        `no rule for resource group '${input.resource_group}' in that subscription`,
      );
    }
    await dal.updateAzureRgRule(
      input.subscription_id,
      input.resource_group,
      input.data_product,
      input.note,
      actor,
    );
    invalidateAzure();
    return `Rule updated: resource group '${input.resource_group}' now routes to '${input.data_product}' — all cost it carries follows.`;
  });
}

const DeleteRgRule = z.object({
  subscription_id: z.string().min(1),
  resource_group: z.string().min(1),
});

export async function deleteAzureRgRuleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const input = parseForm(formData, DeleteRgRule);
    await dal.deleteAzureRgRule(input.subscription_id, input.resource_group);
    invalidateAzure();
    return `Rule removed for resource group '${input.resource_group}'. Its cost falls back to subscription rules — or stays unallocated.`;
  });
}

// ============================== subscription rules ==============================

const AddSubscriptionRule = z.object({
  subscription_id: z.string().min(1),
  data_product: z.string().min(1),
  note: optionalText,
});

export async function addAzureSubscriptionRuleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async (actor) => {
    const input = parseForm(formData, AddSubscriptionRule);
    await assertProductExists(input.data_product);
    const existing = await dal.listAzureSubscriptionRules();
    if (existing.some((r) => r.subscription_id === lower(input.subscription_id))) {
      throw new DomainError(
        "DUPLICATE_KEY",
        `subscription '${input.subscription_id}' already has a rule — remove it first`,
      );
    }
    await dal.insertAzureSubscriptionRule(input, actor);
    invalidateAzure();
    return `Rule created: everything in subscription ${lower(input.subscription_id)} → '${input.data_product}'.`;
  });
}

const EditSubscriptionRule = z.object({
  subscription_id: z.string().min(1),
  data_product: z.string().min(1),
  note: optionalText,
});

/** Re-point a subscription rule at a new product; the subscription stays fixed. */
export async function editAzureSubscriptionRuleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async (actor) => {
    const input = parseForm(formData, EditSubscriptionRule);
    await assertProductExists(input.data_product);
    const existing = await dal.listAzureSubscriptionRules();
    if (!existing.some((r) => r.subscription_id === lower(input.subscription_id))) {
      throw new DomainError(
        "NOT_FOUND",
        `no rule for subscription '${input.subscription_id}'`,
      );
    }
    await dal.updateAzureSubscriptionRule(
      input.subscription_id,
      input.data_product,
      input.note,
      actor,
    );
    invalidateAzure();
    return `Rule updated: subscription ${lower(input.subscription_id)} now routes to '${input.data_product}'.`;
  });
}

const DeleteSubscriptionRule = z.object({ subscription_id: z.string().min(1) });

export async function deleteAzureSubscriptionRuleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const input = parseForm(formData, DeleteSubscriptionRule);
    await dal.deleteAzureSubscriptionRule(input.subscription_id);
    invalidateAzure();
    return `Rule removed for subscription ${lower(input.subscription_id)}. Its unclaimed cost stays visible in coverage until another rule catches it.`;
  });
}
