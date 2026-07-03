import Link from "next/link";
import {
  listActiveProducts,
  listJobMappings,
  listRunnerRules,
  listTagRules,
  listWorkspaces,
} from "@/dal/mappings";
import { getTaggedBridgeJobs, getUntaggedJobs } from "@/dal/workQueue";
import {
  addRunnerRuleAction,
  addTagRuleAction,
  bulkDeleteJobMappingsAction,
  bulkRemapJobsAction,
  deleteJobMappingAction,
  deleteRunnerRuleAction,
  deleteTagRuleAction,
  mapJobAction,
} from "@/actions/mappings";
import { ArrowRightLeft, Plus, Sparkles, Trash2 } from "lucide-react";
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
import { TableFilter } from "@/components/table-filter";
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

/** Write surface: job bridge rows, tag rules and runner rules. */
export async function MappingsView({ q }: { q: string }) {
  const [rows, products, workspaces, taggedJobs, untaggedJobs, tagRules, runnerRules] =
    await Promise.all([
      listJobMappings(),
      listActiveProducts(),
      listWorkspaces(),
      getTaggedBridgeJobs(),
      getUntaggedJobs(),
      listTagRules(),
      listRunnerRules(),
    ]);
  const productOptions = products.map((p) => ({
    value: p.data_product,
    label: `${p.data_product} (${p.desk})`,
  }));
  const wsName = new Map(workspaces.map((w) => [w.workspace_id, w.workspace_name]));
  const productsReferenced = new Set(rows.map((r) => r.data_product)).size;

  const query = q.toLowerCase();
  const shown = rows.filter(
    (r) =>
      !query ||
      `${wsName.get(r.workspace_id) ?? ""} ${r.workspace_id} ${r.job_id} ${r.data_product} ${r.note ?? ""} ${r.mapped_by ?? ""}`
        .toLowerCase()
        .includes(query),
  );

  return (
    <div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Bridge rows"
          value={String(rows.length)}
          hint="goal state: 0 — tag at source"
          tone={rows.length === 0 ? "good" : "default"}
        />
        <KpiTile
          label="Safe to remove"
          value={String(taggedJobs.length)}
          hint="now tagged at source (janitor)"
          tone={taggedJobs.length > 0 ? "warn" : "good"}
        />
        <KpiTile
          label="Attribution rules"
          value={`${tagRules.length} tag · ${runnerRules.length} runner`}
          hint={`${productsReferenced} product(s) referenced by bridge rows`}
        />
        <KpiTile
          label="Untagged jobs 30d"
          value={String(untaggedJobs.length)}
          hint="in the work queue, waiting for a mapping"
          tone={untaggedJobs.length > 0 ? "warn" : "good"}
        />
      </div>

      <div className="no-print mb-6 flex flex-wrap items-start gap-3">
        <EditDialog
          trigger={
            <Button>
              <Plus aria-hidden /> Map a job
            </Button>
          }
          title="Map a job"
          description="job_id is only unique within a workspace — both are required."
        >
          <ActionForm action={mapJobAction} submitLabel="Map job" resetOnSuccess>
            <SelectField
              label="Workspace"
              name="workspace_id"
              options={workspaces.map((w) => ({
                value: w.workspace_id,
                label: `${w.workspace_name} (${w.workspace_id})`,
              }))}
            />
            <Field label="Job ID" name="job_id" />
            <SelectField label="Data product" name="data_product" options={productOptions} />
            <Field label="Note (why mapped manually)" name="note" required={false} />
          </ActionForm>
        </EditDialog>
        <div className="ml-auto">
          <TableFilter placeholder="Filter by workspace, job, product, note…" />
        </div>
      </div>

      {taggedJobs.length > 0 && (
        <Card className="mb-4 ring-emerald-200 bg-emerald-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5 text-emerald-800">
              <Sparkles className="size-4" aria-hidden /> Safe to remove — now tagged at source
            </CardTitle>
            <CardDescription className="text-xs text-emerald-700">
              These bridge rows point at jobs that produced TAG-attributed cost in the last 30
              days: the tag has landed, the bridge is redundant. Removing them shrinks this table
              toward its goal state (empty). The tag keeps winning either way — it is rule 1 of
              the waterfall.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="no-print mb-3">
              <EditDialog
                trigger={
                  <Button variant="outline" size="sm">
                    <Trash2 aria-hidden /> Remove all {taggedJobs.length} redundant bridge
                    {taggedJobs.length > 1 ? "s" : ""}
                  </Button>
                }
                title={`Remove ${taggedJobs.length} redundant bridge mapping${taggedJobs.length > 1 ? "s" : ""}?`}
                description="Every listed job produced TAG-attributed cost in the last 30 days — the tag keeps winning either way. This just prunes the redundant rows."
              >
                <ActionForm action={bulkDeleteJobMappingsAction} submitLabel="Remove all listed">
                  {taggedJobs.map((j) => (
                    <input
                      key={`${j.workspace_id}|${j.job_id}`}
                      type="hidden"
                      name="keys"
                      value={`${j.workspace_id}|${j.job_id}`}
                    />
                  ))}
                </ActionForm>
              </EditDialog>
            </div>
            <Table className="max-w-2xl">
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Job ID</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">TAG cost 30d</TableHead>
                  <TableHead>
                    <span className="sr-only">Action</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {taggedJobs.map((j) => (
                  <TableRow key={`${j.workspace_id}|${j.job_id}`}>
                    <TableCell>{wsName.get(j.workspace_id) ?? j.workspace_id}</TableCell>
                    <TableCell className="font-mono text-xs">{j.job_id}</TableCell>
                    <TableCell className="font-mono text-xs">{j.data_product}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtMoney(j.tagged_cost_30d)}
                    </TableCell>
                    <TableCell>
                      <EditDialog
                        trigger={<RowAction danger>Remove bridge</RowAction>}
                        title={`Remove redundant bridge for job ${j.job_id}?`}
                        description="This job produced TAG-attributed cost in the last 30 days — the tag keeps winning either way. This just prunes the redundant row."
                      >
                        <ActionForm
                          action={deleteJobMappingAction}
                          submitLabel="Remove bridge"
                          danger
                        >
                          <input type="hidden" name="workspace_id" value={j.workspace_id} />
                          <input type="hidden" name="job_id" value={j.job_id} />
                        </ActionForm>
                      </EditDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <BulkSelect values={shown.map((r) => `${r.workspace_id}|${r.job_id}`)}>
      <Card>
        <CardHeader>
          <CardTitle>Job bridge — job_product_mapping</CardTitle>
          <CardDescription className="text-xs">
            Waterfall rule 2: pins one (workspace, job) to a product. Strongest mapping after the
            tag itself, but pure technical debt — tag the job at source and prune the row.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {shown.length === 0 ? (
            <EmptyState
              message={
                rows.length === 0
                  ? "No bridge mappings — every job attributes via tags. That's the goal state."
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
                  <TableHead>Workspace</TableHead>
                  <TableHead>Job ID</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Mapped by / at</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r) => (
                  <TableRow key={`${r.workspace_id}|${r.job_id}`}>
                    <TableCell>
                      <BulkCheckbox
                        value={`${r.workspace_id}|${r.job_id}`}
                        label={`Select job ${r.job_id} in ${wsName.get(r.workspace_id) ?? r.workspace_id}`}
                      />
                    </TableCell>
                    <TableCell>{wsName.get(r.workspace_id) ?? r.workspace_id}</TableCell>
                    <TableCell className="font-mono text-xs">{r.job_id}</TableCell>
                    <TableCell className="font-mono text-xs">{r.data_product}</TableCell>
                    <TableCell className="text-xs">{r.note ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.mapped_by ?? "—"}
                      {r.mapped_at && <> · {r.mapped_at.slice(0, 10)}</>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-start gap-4">
                      <Link
                        href={`/admin/jobs?view=coverage&q=${encodeURIComponent(r.job_id)}`}
                        className="text-xs font-medium text-indigo-600 hover:underline"
                      >
                        Attribution
                      </Link>
                      <EditDialog
                        trigger={<RowAction danger>Remove</RowAction>}
                        title={`Remove mapping for job ${r.job_id}?`}
                        description="Remove once the job is tagged at source — otherwise its spend falls back to the work queue."
                      >
                        <ActionForm
                          action={deleteJobMappingAction}
                          submitLabel="Remove mapping"
                          danger
                        >
                          <input type="hidden" name="workspace_id" value={r.workspace_id} />
                          <input type="hidden" name="job_id" value={r.job_id} />
                        </ActionForm>
                      </EditDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
          title="Re-map selected jobs"
          description="Points every selected bridge row at a different product. Reminder: the durable fix is tagging the job at source."
        >
          <ActionForm action={bulkRemapJobsAction} submitLabel="Apply to selected">
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
          description="Remove once the jobs are tagged at source — otherwise their spend falls back to the work queue."
        >
          <ActionForm action={bulkDeleteJobMappingsAction} submitLabel="Remove mappings" danger>
            <BulkSelectedInputs name="keys" />
            <BulkAppliesTo noun="mapping" />
          </ActionForm>
        </EditDialog>
      </BulkActionBar>
      </BulkSelect>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Tag rules — tag_product_mapping</CardTitle>
          <CardDescription className="text-xs">
            Waterfall rule 3: any custom tag key=value → product. Catches platform-created jobs
            that carry team/project tags but no data_product tag — one rule covers every job with
            the tag, present and future. Each job&apos;s actual tags are visible in{" "}
            <Link href="/admin/jobs?view=coverage" className="text-indigo-600 hover:underline">
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
              description="Key and value must match custom_tags in system.billing.usage exactly (case-sensitive)."
            >
              <ActionForm action={addTagRuleAction} submitLabel="Add rule" resetOnSuccess>
                <Field label="Tag key" name="tag_key" placeholder="team" />
                <Field label="Tag value" name="tag_value" placeholder="market-data-eng" />
                <SelectField label="Data product" name="data_product" options={productOptions} />
                <Field label="Note (why this rule)" name="note" required={false} />
              </ActionForm>
            </EditDialog>
          </div>
          {tagRules.length === 0 ? (
            <EmptyState message="No tag rules. Add one to route spend by team/project tags when the data_product tag is missing." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tag</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Mapped by / at</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tagRules.map((r) => (
                  <TableRow key={`${r.tag_key}|${r.tag_value}`}>
                    <TableCell className="font-mono text-xs">
                      {r.tag_key}={r.tag_value}
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
                        title={`Remove rule ${r.tag_key}=${r.tag_value}?`}
                        description="Spend carried by this rule falls back to later waterfall rules — or the work queue."
                      >
                        <ActionForm action={deleteTagRuleAction} submitLabel="Remove rule" danger>
                          <input type="hidden" name="tag_key" value={r.tag_key} />
                          <input type="hidden" name="tag_value" value={r.tag_value} />
                        </ActionForm>
                      </EditDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Runner rules — runner_product_mapping</CardTitle>
          <CardDescription className="text-xs">
            Waterfall rule 5: everything an identity runs → product. The explicit opt-in for
            platform service principals whose entire output serves one product. This replaces the
            old implicit behaviour — job spend never silently lands on the runner&apos;s home desk
            anymore.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="no-print mb-4">
            <EditDialog
              trigger={
                <Button size="sm" variant="outline">
                  <Plus aria-hidden /> Add runner rule
                </Button>
              }
              title="Add runner rule"
              description="user_id must match identity_metadata.run_as exactly — email or service principal ID."
            >
              <ActionForm action={addRunnerRuleAction} submitLabel="Add rule" resetOnSuccess>
                <Field label="Runner (user / service principal ID)" name="user_id" />
                <SelectField label="Data product" name="data_product" options={productOptions} />
                <Field label="Note (why this rule)" name="note" required={false} />
              </ActionForm>
            </EditDialog>
          </div>
          {runnerRules.length === 0 ? (
            <EmptyState message="No runner rules. Add one when a service principal's entire workload belongs to a single product." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Runner</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Mapped by / at</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runnerRules.map((r) => (
                  <TableRow key={r.user_id}>
                    <TableCell className="font-mono text-xs">{r.user_id}</TableCell>
                    <TableCell className="font-mono text-xs">{r.data_product}</TableCell>
                    <TableCell className="text-xs">{r.note ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.mapped_by ?? "—"}
                      {r.mapped_at && <> · {r.mapped_at.slice(0, 10)}</>}
                    </TableCell>
                    <TableCell>
                      <EditDialog
                        trigger={<RowAction danger>Remove</RowAction>}
                        title={`Remove rule for ${r.user_id}?`}
                        description="The runner's job spend stops attributing here — jobs never fall back to the runner's desk."
                      >
                        <ActionForm action={deleteRunnerRuleAction} submitLabel="Remove rule" danger>
                          <input type="hidden" name="user_id" value={r.user_id} />
                        </ActionForm>
                      </EditDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
