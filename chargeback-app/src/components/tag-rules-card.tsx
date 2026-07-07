import Link from "next/link";
import { Plus } from "lucide-react";
import { addTagRuleAction, deleteTagRuleAction } from "@/actions/mappings";
import { ActionForm, Field, SelectField } from "@/components/action-form";
import { EditDialog, RowAction } from "@/components/edit-dialog";
import { EmptyState } from "@/components/ui";
import { TablePagination } from "@/components/table-pagination";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { paginate } from "@/lib/paginate";
import { SCOPE_LABELS, TAG_RULE_SCOPES } from "@/lib/tag-rules";
import { cn } from "@/lib/utils";
import type { TagRuleRow, TagRuleScope } from "@/dal/types";

const SCOPE_BADGE: Record<TagRuleScope, string> = {
  databricks: "bg-orange-50 text-orange-700 ring-orange-200",
  azure: "bg-sky-50 text-sky-700 ring-sky-200",
  both: "bg-violet-50 text-violet-700 ring-violet-200",
};

function ScopeBadge({ scope }: { scope: TagRuleScope }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        SCOPE_BADGE[scope],
      )}
    >
      {SCOPE_LABELS[scope]}
    </span>
  );
}

/**
 * The ONE tag-rule table (tag_product_mapping), shared by the Databricks
 * (/admin/jobs) and Azure (/admin/azure) attribution screens. Rule 3 of
 * both waterfalls reads it, filtered by each rule's scope — so both screens
 * show the full list and only the add-form default differs.
 */
export function TagRulesCard({
  rules,
  productOptions,
  defaultScope,
  pageCursor,
  coverageHref,
}: {
  rules: TagRuleRow[];
  productOptions: { value: string; label: string }[];
  /** which scope the add form pre-selects — the side this screen manages */
  defaultScope: Exclude<TagRuleScope, "both">;
  pageCursor?: string;
  /** the coverage tab where this screen shows each item's actual tags */
  coverageHref: string;
}) {
  const { rows: page, ...paged } = paginate(rules, pageCursor);
  const tagSource =
    defaultScope === "databricks"
      ? "custom_tags in system.billing.usage"
      : "the resource tags in the cost export";

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Tag rules — tag_product_mapping (unified)</CardTitle>
        <CardDescription className="text-xs">
          Rule 3 of BOTH waterfalls: any tag key=value → product. One table covers Databricks
          custom tags and Azure resource tags — each rule&apos;s scope says which namespace(s) it
          matches, so a rule added here is the same rule the other attribution screen shows.
          Scope &quot;Both&quot; is for organisation-wide tags that mean the same thing everywhere;
          keys like team that differ per namespace get one scoped rule each. Each item&apos;s
          actual tags are visible in{" "}
          <Link href={coverageHref} className="text-indigo-600 hover:underline">
            coverage
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="no-print mb-4">
          <EditDialog
            trigger={
              <Button size="sm" variant="outline">
                <Plus aria-hidden /> Add tag rule
              </Button>
            }
            title="Add tag rule"
            description={`Key and value must match ${tagSource} exactly (case-sensitive).`}
          >
            <ActionForm action={addTagRuleAction} submitLabel="Add rule" resetOnSuccess>
              <Field label="Tag key" name="tag_key" placeholder="team" />
              <Field label="Tag value" name="tag_value" placeholder="market-data-eng" />
              <SelectField label="Data product" name="data_product" options={productOptions} />
              <SelectField
                label="Scope (which tags the rule matches)"
                name="scope"
                defaultValue={defaultScope}
                options={TAG_RULE_SCOPES.map((s) => ({ value: s, label: SCOPE_LABELS[s] }))}
              />
              <Field label="Note (why this rule)" name="note" required={false} />
            </ActionForm>
          </EditDialog>
        </div>
        {rules.length === 0 ? (
          <EmptyState message="No tag rules. Add one to route spend by team/application tags when the data_product tag is missing." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tag</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Mapped by / at</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.map((r) => (
                <TableRow key={`${r.tag_key}|${r.tag_value}|${r.scope}`}>
                  <TableCell className="font-mono text-xs">
                    {r.tag_key}={r.tag_value}
                  </TableCell>
                  <TableCell>
                    <ScopeBadge scope={r.scope} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.data_product}</TableCell>
                  <TableCell className="text-xs">{r.note ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.mapped_by ?? "—"}
                    {r.mapped_at && <> · {r.mapped_at.slice(0, 10)}</>}
                  </TableCell>
                  <TableCell>
                    <EditDialog
                      trigger={<RowAction danger>Remove</RowAction>}
                      title={`Remove ${SCOPE_LABELS[r.scope]} rule ${r.tag_key}=${r.tag_value}?`}
                      description="Spend carried by this rule falls back to later waterfall rules — or the work queue / unallocated."
                    >
                      <ActionForm action={deleteTagRuleAction} submitLabel="Remove rule" danger>
                        <input type="hidden" name="tag_key" value={r.tag_key} />
                        <input type="hidden" name="tag_value" value={r.tag_value} />
                        <input type="hidden" name="scope" value={r.scope} />
                      </ActionForm>
                    </EditDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <TablePagination {...paged} noun="tag rule" paramName="tagsPage" />
      </CardContent>
    </Card>
  );
}
