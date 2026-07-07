import Link from "next/link";
import { listActiveProducts, listTagRules } from "@/dal/mappings";
import {
  getAzureDeskTotals,
  getTaggedAzureBridgeResources,
  listAzureResourceMappings,
  listAzureRgRules,
  listAzureSubscriptionRules,
} from "@/dal/azure";
import {
  addAzureRgRuleAction,
  addAzureSubscriptionRuleAction,
  bulkDeleteAzureResourceMappingsAction,
  bulkRemapAzureResourcesAction,
  deleteAzureResourceMappingAction,
  deleteAzureRgRuleAction,
  deleteAzureSubscriptionRuleAction,
  editAzureRgRuleAction,
  editAzureSubscriptionRuleAction,
  mapAzureResourceAction,
} from "@/actions/azure";
import { TagRulesCard } from "@/components/tag-rules-card";
import { JanitorCard } from "@/components/janitor-card";
import { scopeCovers } from "@/lib/tag-rules";
import { ArrowRightLeft, Plus, Trash2 } from "lucide-react";
import { ActionForm, Field, SelectField } from "@/components/action-form";
import { EditDialog, RowAction } from "@/components/edit-dialog";
import {
  BulkActionBar,
  BulkAppliesTo,
  BulkCheckbox,
  BulkCheckboxAll,
  BulkSelect,
  BulkSelectedInputs,
} from "@/components/bulk-select";
import { EmptyState, FilteredCount, KpiTile } from "@/components/ui";
import { KPI_HELP } from "@/lib/kpi-help";
import { TableFilter } from "@/components/table-filter";
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
import { fmtMoney } from "@/lib/format";
import { paginate } from "@/lib/paginate";
import { toProductOptions } from "@/lib/product-options";

/** Last ARM segment — the human-readable resource name. */
const resourceName = (id: string) => id.split("/").at(-1) ?? id;

/** Resource name bold, full ARM id underneath — the id is the join key. */
function ResourceCell({ resource_id }: { resource_id: string }) {
  return (
    <>
      <p className="text-sm font-medium">{resourceName(resource_id)}</p>
      <p className="max-w-72 break-all font-mono text-[11px] leading-tight text-muted-foreground">
        {resource_id}
      </p>
    </>
  );
}

/** Write surface: resource bridge rows, tag rules, RG rules and subscription rules. */
export async function MappingsView({
  q,
  pages,
}: {
  q: string;
  // one page cursor per table on this view
  pages: { bridge?: string; tags?: string; rgs?: string; subs?: string };
}) {
  const [rows, products, taggedResources, tagRules, rgRules, subRules, deskTotals] =
    await Promise.all([
      listAzureResourceMappings(),
      listActiveProducts(),
      getTaggedAzureBridgeResources(),
      listTagRules(), // unified table — the same rules /admin/jobs shows
      listAzureRgRules(),
      listAzureSubscriptionRules(),
      getAzureDeskTotals(),
    ]);
  const productOptions = toProductOptions(products);
  const unmatchedCost = deskTotals.find((d) => d.desk === "UNALLOCATED")?.cost_30d ?? 0;
  const azureRules = tagRules.filter((r) => scopeCovers(r.scope, "azure")).length;

  const query = q.toLowerCase();
  const shown = rows.filter(
    (r) =>
      !query ||
      `${r.resource_id} ${r.data_product} ${r.note ?? ""} ${r.mapped_by ?? ""}`
        .toLowerCase()
        .includes(query),
  );
  const { rows: pageRows, ...bridgePaged } = paginate(shown, pages.bridge);
  const { rows: rgRulePage, ...rgsPaged } = paginate(rgRules, pages.rgs);
  const { rows: subRulePage, ...subsPaged } = paginate(subRules, pages.subs);

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiTile
          label="Bridge rows"
          value={String(rows.length)}
          hint="goal state: 0 — tag at source"
          tone={rows.length === 0 ? "good" : "default"}
        />
        <KpiTile
          label="Safe to remove"
          value={String(taggedResources.length)}
          hint="now tagged at source (janitor)"
          tone={taggedResources.length > 0 ? "warn" : "good"}
        />
        <KpiTile
          label="Attribution rules"
          value={`${azureRules} tag · ${rgRules.length} RG · ${subRules.length} sub`}
          hint="tag rules covering Azure, resource-group and subscription rules"
        />
        <KpiTile
          label="Unallocated Azure cost 30d"
          value={fmtMoney(unmatchedCost)}
          hint="unmatched by design — never billed to a desk"
          info={KPI_HELP.azureUnmatchedCost}
          infoAlign="end"
        />
      </div>

      <div className="no-print mb-6 flex flex-wrap items-start gap-3">
        <EditDialog
          trigger={
            <Button>
              <Plus aria-hidden /> Map a resource
            </Button>
          }
          title="Map an Azure resource"
          description="Paste the full ARM resource ID (from the coverage tab or the Azure portal). Case doesn't matter — it is stored lowercase."
        >
          <ActionForm action={mapAzureResourceAction} submitLabel="Map resource" resetOnSuccess>
            <Field
              label="Resource ID"
              name="resource_id"
              placeholder="/subscriptions/…/resourcegroups/…/providers/…"
            />
            <SelectField label="Data product" name="data_product" options={productOptions} />
            <Field label="Note (why mapped manually)" name="note" required={false} />
          </ActionForm>
        </EditDialog>
        <div className="ml-auto">
          <TableFilter placeholder="Filter by resource, product, note…" />
        </div>
      </div>

      <JanitorCard
        noun="resource"
        headers={["Resource"]}
        items={taggedResources.map((r) => ({
          key: r.resource_id,
          dialogLabel: resourceName(r.resource_id),
          cells: [<ResourceCell key="res" resource_id={r.resource_id} />],
          hidden: [{ name: "resource_id", value: r.resource_id }],
          data_product: r.data_product,
          tagged_cost_30d: r.tagged_cost_30d,
        }))}
        deleteAction={deleteAzureResourceMappingAction}
        bulkDeleteAction={bulkDeleteAzureResourceMappingsAction}
      />

      <BulkSelect values={pageRows.map((r) => r.resource_id)}>
        <Card>
          <CardHeader>
            <CardTitle>Resource bridge — azure_resource_product_mapping</CardTitle>
            <CardDescription className="text-xs">
              Waterfall rule 2: pins one ARM resource to a product. Strongest mapping after the
              tag itself, but pure technical debt — tag the resource at source and prune the row.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {shown.length === 0 ? (
              <EmptyState
                message={
                  rows.length === 0
                    ? "No bridge mappings — every attributed resource carries its own tag or matches a scope rule. That's the goal state."
                    : "No mappings match the filter."
                }
              />
            ) : (
              <>
                {q && <FilteredCount shown={shown.length} total={rows.length} noun="mapping" />}
                <Table className="align-top">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">
                        <BulkCheckboxAll label="Select all shown bridge mappings" />
                      </TableHead>
                      <TableHead>Resource</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead>Mapped by / at</TableHead>
                      <TableHead>
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageRows.map((r) => (
                      <TableRow key={r.resource_id}>
                        <TableCell>
                          <BulkCheckbox
                            value={r.resource_id}
                            label={`Select resource ${resourceName(r.resource_id)}`}
                          />
                        </TableCell>
                        <TableCell>
                          <ResourceCell resource_id={r.resource_id} />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{r.data_product}</TableCell>
                        <TableCell className="text-xs">{r.note ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.mapped_by ?? "—"}
                          {r.mapped_at && <> · {r.mapped_at.slice(0, 10)}</>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-start gap-4">
                            {/* full ARM id — resource names are not unique across RGs */}
                            <Link
                              href={`/admin/azure?view=coverage&q=${encodeURIComponent(r.resource_id)}`}
                              className="text-xs font-medium text-indigo-600 hover:underline"
                            >
                              Attribution
                            </Link>
                            <EditDialog
                              trigger={<RowAction>Re-map</RowAction>}
                              title={`Re-map ${resourceName(r.resource_id)}`}
                              description="Points this bridge row at a different product. Reminder: the durable fix is tagging the resource at source."
                            >
                              <ActionForm
                                action={bulkRemapAzureResourcesAction}
                                submitLabel="Re-map"
                              >
                                <input type="hidden" name="keys" value={r.resource_id} />
                                <SelectField
                                  label="Data product"
                                  name="data_product"
                                  defaultValue={r.data_product}
                                  options={productOptions}
                                />
                                <Field
                                  label="Note (why re-mapped)"
                                  name="note"
                                  defaultValue={r.note ?? ""}
                                  required={false}
                                />
                              </ActionForm>
                            </EditDialog>
                            <EditDialog
                              trigger={<RowAction danger>Remove</RowAction>}
                              title={`Remove mapping for ${resourceName(r.resource_id)}?`}
                              description="Remove once the resource is tagged at source — otherwise its cost falls back to scope rules, or stays unallocated."
                            >
                              <ActionForm
                                action={deleteAzureResourceMappingAction}
                                submitLabel="Remove mapping"
                                danger
                              >
                                <input type="hidden" name="resource_id" value={r.resource_id} />
                              </ActionForm>
                            </EditDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <TablePagination {...bridgePaged} noun="mapping" />
              </>
            )}
          </CardContent>
        </Card>

        <BulkActionBar noun="mapping">
          <EditDialog
            trigger={
              <Button variant="outline" size="sm">
                <ArrowRightLeft aria-hidden /> Re-map to product
              </Button>
            }
            title="Re-map selected resources"
            description="Points every selected bridge row at a different product. Reminder: the durable fix is tagging the resource at source."
          >
            <ActionForm action={bulkRemapAzureResourcesAction} submitLabel="Apply to selected">
              <BulkSelectedInputs name="keys" />
              <SelectField label="Data product" name="data_product" options={productOptions} />
              <Field label="Note (why re-mapped)" name="note" required={false} />
              <BulkAppliesTo noun="mapping" />
            </ActionForm>
          </EditDialog>
          <EditDialog
            trigger={
              <Button variant="destructive" size="sm">
                <Trash2 aria-hidden /> Remove selected
              </Button>
            }
            title="Remove selected bridge mappings?"
            description="Remove once the resources are tagged at source — otherwise their cost falls back to scope rules, or stays unallocated."
          >
            <ActionForm
              action={bulkDeleteAzureResourceMappingsAction}
              submitLabel="Remove mappings"
              danger
            >
              <BulkSelectedInputs name="keys" />
              <BulkAppliesTo noun="mapping" />
            </ActionForm>
          </EditDialog>
        </BulkActionBar>
      </BulkSelect>

      <TagRulesCard
        rules={tagRules}
        productOptions={productOptions}
        defaultScope="azure"
        pageCursor={pages.tags}
        coverageHref="/admin/azure?view=coverage"
      />

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Resource-group rules — azure_rg_product_mapping</CardTitle>
          <CardDescription className="text-xs">
            Waterfall rule 4: every resource in one (subscription, resource group) → product. The
            analogue of a dedicated warehouse — the whole RG, present and future resources
            included, belongs to one product. RG names are only unique per subscription, so both
            are required.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="no-print mb-4">
            <EditDialog
              trigger={
                <Button size="sm" variant="outline">
                  <Plus aria-hidden /> Add resource-group rule
                </Button>
              }
              title="Add resource-group rule"
              description="Subscription ID (GUID) + resource group name. Case doesn't matter — both are stored lowercase."
            >
              <ActionForm action={addAzureRgRuleAction} submitLabel="Add rule" resetOnSuccess>
                <Field label="Subscription ID" name="subscription_id" />
                <Field label="Resource group" name="resource_group" placeholder="rg-risk-var" />
                <SelectField label="Data product" name="data_product" options={productOptions} />
                <Field label="Note (why this rule)" name="note" required={false} />
              </ActionForm>
            </EditDialog>
          </div>
          {rgRules.length === 0 ? (
            <EmptyState message="No resource-group rules. Add one when an entire RG serves a single product." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Resource group</TableHead>
                  <TableHead>Subscription</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Mapped by / at</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rgRulePage.map((r) => (
                  <TableRow key={`${r.subscription_id}|${r.resource_group}`}>
                    <TableCell className="font-mono text-xs">{r.resource_group}</TableCell>
                    <TableCell className="font-mono text-xs">{r.subscription_id}</TableCell>
                    <TableCell className="font-mono text-xs">{r.data_product}</TableCell>
                    <TableCell className="text-xs">{r.note ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.mapped_by ?? "—"}
                      {r.mapped_at && <> · {r.mapped_at.slice(0, 10)}</>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-start gap-4">
                        <EditDialog
                          trigger={<RowAction>Edit</RowAction>}
                          title={`Edit rule for ${r.resource_group}`}
                          description="Points the rule at a different product — all cost it carries follows. Subscription and RG stay fixed; to change those, remove and re-add."
                        >
                          <ActionForm action={editAzureRgRuleAction} submitLabel="Save rule">
                            <input type="hidden" name="subscription_id" value={r.subscription_id} />
                            <input type="hidden" name="resource_group" value={r.resource_group} />
                            <SelectField
                              label="Data product"
                              name="data_product"
                              defaultValue={r.data_product}
                              options={productOptions}
                            />
                            <Field
                              label="Note (why this rule)"
                              name="note"
                              defaultValue={r.note ?? ""}
                              required={false}
                            />
                          </ActionForm>
                        </EditDialog>
                        <EditDialog
                          trigger={<RowAction danger>Remove</RowAction>}
                          title={`Remove rule for ${r.resource_group}?`}
                          description="The RG's cost falls back to subscription rules — or stays unallocated."
                        >
                          <ActionForm action={deleteAzureRgRuleAction} submitLabel="Remove rule" danger>
                            <input type="hidden" name="subscription_id" value={r.subscription_id} />
                            <input type="hidden" name="resource_group" value={r.resource_group} />
                          </ActionForm>
                        </EditDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <TablePagination {...rgsPaged} noun="resource-group rule" paramName="rgsPage" />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Subscription rules — azure_subscription_product_mapping</CardTitle>
          <CardDescription className="text-xs">
            Waterfall rule 5: everything in a subscription → product. The coarsest opt-in — for
            subscriptions dedicated to a single product. Anything more mixed belongs to a tag or
            resource-group rule instead.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="no-print mb-4">
            <EditDialog
              trigger={
                <Button size="sm" variant="outline">
                  <Plus aria-hidden /> Add subscription rule
                </Button>
              }
              title="Add subscription rule"
              description="Subscription ID (GUID). Case doesn't matter — stored lowercase."
            >
              <ActionForm
                action={addAzureSubscriptionRuleAction}
                submitLabel="Add rule"
                resetOnSuccess
              >
                <Field label="Subscription ID" name="subscription_id" />
                <SelectField label="Data product" name="data_product" options={productOptions} />
                <Field label="Note (why this rule)" name="note" required={false} />
              </ActionForm>
            </EditDialog>
          </div>
          {subRules.length === 0 ? (
            <EmptyState message="No subscription rules. Add one when a whole subscription's cost belongs to a single product." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subscription</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Mapped by / at</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subRulePage.map((r) => (
                  <TableRow key={r.subscription_id}>
                    <TableCell className="font-mono text-xs">{r.subscription_id}</TableCell>
                    <TableCell className="font-mono text-xs">{r.data_product}</TableCell>
                    <TableCell className="text-xs">{r.note ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.mapped_by ?? "—"}
                      {r.mapped_at && <> · {r.mapped_at.slice(0, 10)}</>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-start gap-4">
                        <EditDialog
                          trigger={<RowAction>Edit</RowAction>}
                          title={`Edit rule for subscription ${r.subscription_id}`}
                          description="Points the rule at a different product — all cost it carries follows. The subscription stays fixed; to change it, remove and re-add."
                        >
                          <ActionForm action={editAzureSubscriptionRuleAction} submitLabel="Save rule">
                            <input type="hidden" name="subscription_id" value={r.subscription_id} />
                            <SelectField
                              label="Data product"
                              name="data_product"
                              defaultValue={r.data_product}
                              options={productOptions}
                            />
                            <Field
                              label="Note (why this rule)"
                              name="note"
                              defaultValue={r.note ?? ""}
                              required={false}
                            />
                          </ActionForm>
                        </EditDialog>
                        <EditDialog
                          trigger={<RowAction danger>Remove</RowAction>}
                          title={`Remove rule for subscription ${r.subscription_id}?`}
                          description="The subscription's unclaimed cost stays visible in coverage until another rule catches it."
                        >
                          <ActionForm
                            action={deleteAzureSubscriptionRuleAction}
                            submitLabel="Remove rule"
                            danger
                          >
                            <input type="hidden" name="subscription_id" value={r.subscription_id} />
                          </ActionForm>
                        </EditDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <TablePagination {...subsPaged} noun="subscription rule" paramName="subsPage" />
        </CardContent>
      </Card>
    </div>
  );
}
