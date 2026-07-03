"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { optionalText, parseForm, runAction } from "@/actions/run";
import * as dal from "@/dal/mappings";
import { assertProductExists } from "@/services/productCatalogue";
import { DomainError } from "@/services/errors";

function invalidateMappings() {
  updateTag("mappings");
  updateTag("queue");
  updateTag("reports-live");
  updateTag("health");
}

const MapJob = z.object({
  workspace_id: z.string().min(1),
  job_id: z.string().min(1),
  data_product: z.string().min(1),
  note: optionalText,
});

export async function mapJobAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async (actor) => {
    const input = parseForm(formData, MapJob);
    await assertProductExists(input.data_product); // §7.4(b) before commit
    const existing = await dal.listJobMappings();
    if (
      existing.some(
        (j) => j.workspace_id === input.workspace_id && j.job_id === input.job_id,
      )
    ) {
      throw new DomainError(
        "DUPLICATE_KEY",
        `job ${input.job_id} in workspace ${input.workspace_id} is already mapped`,
      );
    }
    await dal.insertJobMapping(input, actor);
    invalidateMappings();
    return `Job ${input.job_id} mapped to '${input.data_product}'. Reminder: the durable fix is tagging the job at source.`;
  });
}

const DeleteJobMapping = z.object({
  workspace_id: z.string().min(1),
  job_id: z.string().min(1),
});

export async function deleteJobMappingAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const input = parseForm(formData, DeleteJobMapping);
    await dal.deleteJobMapping(input.workspace_id, input.job_id);
    invalidateMappings();
    return `Mapping removed for job ${input.job_id}. Its future spend attributes via tags — or falls to the work queue.`;
  });
}

const AddTagRule = z.object({
  tag_key: z.string().min(1),
  tag_value: z.string().min(1),
  data_product: z.string().min(1),
  note: optionalText,
});

export async function addTagRuleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async (actor) => {
    const input = parseForm(formData, AddTagRule);
    await assertProductExists(input.data_product); // §7.4(b) before commit
    const existing = await dal.listTagRules();
    if (existing.some((r) => r.tag_key === input.tag_key && r.tag_value === input.tag_value)) {
      throw new DomainError(
        "DUPLICATE_KEY",
        `a rule for tag ${input.tag_key}=${input.tag_value} already exists`,
      );
    }
    await dal.insertTagRule(input, actor);
    invalidateMappings();
    return `Rule created: tag ${input.tag_key}=${input.tag_value} → '${input.data_product}'. Applies to all past and future spend carrying that tag.`;
  });
}

const DeleteTagRule = z.object({
  tag_key: z.string().min(1),
  tag_value: z.string().min(1),
});

export async function deleteTagRuleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const input = parseForm(formData, DeleteTagRule);
    await dal.deleteTagRule(input.tag_key, input.tag_value);
    invalidateMappings();
    return `Rule removed for tag ${input.tag_key}=${input.tag_value}. Spend it carried falls back to later waterfall rules — or the work queue.`;
  });
}

const AddRunnerRule = z.object({
  user_id: z.string().min(1),
  data_product: z.string().min(1),
  note: optionalText,
});

export async function addRunnerRuleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async (actor) => {
    const input = parseForm(formData, AddRunnerRule);
    await assertProductExists(input.data_product); // §7.4(b) before commit
    const existing = await dal.listRunnerRules();
    if (existing.some((r) => r.user_id === input.user_id)) {
      throw new DomainError(
        "DUPLICATE_KEY",
        `runner '${input.user_id}' already has a rule — remove it first`,
      );
    }
    await dal.insertRunnerRule(input, actor);
    invalidateMappings();
    return `Rule created: everything '${input.user_id}' runs → '${input.data_product}'.`;
  });
}

const DeleteRunnerRule = z.object({
  user_id: z.string().min(1),
});

export async function deleteRunnerRuleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const input = parseForm(formData, DeleteRunnerRule);
    await dal.deleteRunnerRule(input.user_id);
    invalidateMappings();
    return `Rule removed for '${input.user_id}'. Their job spend no longer attributes via this rule — jobs never default to the runner's desk.`;
  });
}

const AddUser = z.object({
  user_id: z.string().min(1),
  user_name: z.string().min(1),
  desk: z.string().min(1),
});

export async function upsertUserAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const input = parseForm(formData, AddUser);
    await dal.upsertUser(input);
    invalidateMappings();
    return `Runner '${input.user_id}' mapped to desk ${input.desk}.`;
  });
}

const DeleteUser = z.object({
  user_id: z.string().min(1),
});

export async function deleteUserAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const input = parseForm(formData, DeleteUser);
    const existing = await dal.listUsers();
    if (!existing.some((u) => u.user_id === input.user_id)) {
      throw new DomainError("NOT_FOUND", `runner '${input.user_id}' is not in user_mapping`);
    }
    await dal.deleteUser(input.user_id);
    invalidateMappings();
    return `Runner '${input.user_id}' removed. Their future ad-hoc spend loses its desk and will surface in the work queue.`;
  });
}

const AddWorkspace = z.object({
  workspace_id: z.string().min(1),
  workspace_name: z.string().min(1),
});

export async function upsertWorkspaceAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const input = parseForm(formData, AddWorkspace);
    await dal.upsertWorkspace(input);
    invalidateMappings();
    return `Workspace ${input.workspace_id} named '${input.workspace_name}'.`;
  });
}

const DeleteWorkspace = z.object({
  workspace_id: z.string().min(1),
});

export async function deleteWorkspaceAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const input = parseForm(formData, DeleteWorkspace);
    const existing = await dal.listWorkspaces();
    if (!existing.some((w) => w.workspace_id === input.workspace_id)) {
      throw new DomainError(
        "NOT_FOUND",
        `workspace ${input.workspace_id} is not in workspace_mapping`,
      );
    }
    await dal.deleteWorkspace(input.workspace_id);
    invalidateMappings();
    return `Workspace ${input.workspace_id} removed. If it still bills, it will show as 'UNMAPPED: ${input.workspace_id}' in reports and reappear in the work queue — spend is never dropped.`;
  });
}

const AssignWarehouse = z.object({
  warehouse_id: z.string().min(1),
  mode: z.enum(["shared", "dedicated"]),
  data_product: optionalText,
});

export async function assignWarehouseAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const input = parseForm(formData, AssignWarehouse);
    // The shared/dedicated toggle makes §7.4(d) violations unrepresentable.
    if (input.mode === "dedicated") {
      if (!input.data_product) {
        throw new DomainError("VALIDATION", "a dedicated warehouse needs a data product");
      }
      await assertProductExists(input.data_product);
      await dal.upsertWarehouseMapping({
        warehouse_id: input.warehouse_id,
        data_product: input.data_product,
        is_shared: false,
      });
      invalidateMappings();
      return `Warehouse ${input.warehouse_id} dedicated to '${input.data_product}' — including its idle cost.`;
    }
    await dal.upsertWarehouseMapping({
      warehouse_id: input.warehouse_id,
      data_product: null,
      is_shared: true,
    });
    invalidateMappings();
    return `Warehouse ${input.warehouse_id} marked shared — allocated per query.`;
  });
}
