import type { TagRuleScope } from "@/dal/types";

/**
 * Shared vocabulary for the unified tag rules (tag_product_mapping.scope):
 * one rule table drives waterfall rule 3 on both the Databricks and the
 * Azure side, scoped per rule.
 */

export const TAG_RULE_SCOPES: TagRuleScope[] = ["databricks", "azure", "both"];

export const SCOPE_LABELS: Record<TagRuleScope, string> = {
  databricks: "Databricks",
  azure: "Azure",
  both: "Both",
};

/** Does a rule with this scope apply to the given source's tags? */
export function scopeCovers(scope: TagRuleScope, source: "databricks" | "azure"): boolean {
  return scope === "both" || scope === source;
}

/**
 * Two rules on the same key=value conflict iff their scopes can match the
 * same record — same scope, or either is 'both'.
 */
export function scopesOverlap(a: TagRuleScope, b: TagRuleScope): boolean {
  return a === b || a === "both" || b === "both";
}
