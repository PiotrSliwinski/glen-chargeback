import { Suspense } from "react";
import { requirePageRole } from "@/lib/guards";
import { listDbuDiscounts } from "@/dal/discounts";
import { addDbuDiscountAction, deleteDbuDiscountAction } from "@/actions/discounts";
import { Plus } from "lucide-react";
import { ActionForm, Field } from "@/components/action-form";
import { EditDialog, RowAction } from "@/components/edit-dialog";
import { PAGE_HELP } from "@/lib/kpi-help";
import { fmtPct, plural } from "@/lib/format";
import { EmptyState, KpiTile, PageTitle } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePageSkeleton } from "@/components/loading-skeletons";

export const metadata = { title: "DBU discounts" };

export default function DiscountsPage() {
  return (
    <Suspense fallback={<TablePageSkeleton label="Loading reservation plans from Databricks…" kpis withPicker={false} />}>
      <Discounts />
    </Suspense>
  );
}

async function Discounts() {
  await requirePageRole("steward");
  const rows = await listDbuDiscounts();

  const today = new Date().toISOString().slice(0, 10);
  const active = rows.find((r) => r.valid_from <= today && r.valid_to >= today);
  const upcoming = rows
    .filter((r) => r.valid_from > today)
    .sort((a, b) => a.valid_from.localeCompare(b.valid_from))[0];

  return (
    <div>
      <PageTitle
        title="DBU reservation discounts"
        subtitle="dbu_discount_plan — date windows billing Databricks DBU spend at list price × (1 − discount). Applies to DBU services only, never Azure cost."
        info={PAGE_HELP.discounts}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <KpiTile
          label="Discount in effect today"
          value={active ? fmtPct(active.discount_pct) : "—"}
          hint={active ? `${active.valid_from} → ${active.valid_to}` : "DBUs bill at full list price"}
          tone={active ? "good" : undefined}
        />
        <KpiTile
          label="Plan windows"
          value={String(rows.length)}
          hint={`${plural(rows.length, "window")} incl. past and future`}
        />
        <KpiTile
          label="Next window"
          value={upcoming ? upcoming.valid_from : "—"}
          hint={upcoming ? `${fmtPct(upcoming.discount_pct)} off list` : "none scheduled"}
        />
      </div>

      <div className="no-print mb-6 flex flex-wrap items-start gap-3">
        <EditDialog
          trigger={
            <Button>
              <Plus aria-hidden /> Add reservation plan
            </Button>
          }
          title="Add reservation plan"
          description="Both days are inclusive. Windows must not overlap — one discount per day. DBU spend in the window re-prices in all live views immediately; published months are unaffected."
        >
          <ActionForm action={addDbuDiscountAction} submitLabel="Save plan" resetOnSuccess>
            <Field label="First day covered" name="valid_from" type="date" />
            <Field label="Last day covered (inclusive)" name="valid_to" type="date" />
            <Field
              label="Discount (% off DBU list price)"
              name="discount_pct"
              placeholder="e.g. 27"
            />
            <Field label="Note (contract / PO reference)" name="note" required={false} />
          </ActionForm>
        </EditDialog>
      </div>

      <Card>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState message="No reservation plans recorded — all DBU spend bills at full list price." />
          ) : (
            <Table className="align-top">
              <TableHeader>
                <TableRow>
                  <TableHead>First day</TableHead>
                  <TableHead>Last day</TableHead>
                  <TableHead>Discount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Recorded by</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const status =
                    r.valid_to < today ? "expired" : r.valid_from > today ? "scheduled" : "active";
                  return (
                    <TableRow key={`${r.valid_from}|${r.valid_to}`}>
                      <TableCell className="font-mono text-xs">{r.valid_from}</TableCell>
                      <TableCell className="font-mono text-xs">{r.valid_to}</TableCell>
                      <TableCell className="font-medium">{fmtPct(r.discount_pct)}</TableCell>
                      <TableCell
                        className={
                          status === "active"
                            ? "text-emerald-600"
                            : status === "scheduled"
                              ? "text-indigo-600"
                              : "text-muted-foreground"
                        }
                      >
                        {status}
                      </TableCell>
                      <TableCell className="max-w-xs text-xs text-muted-foreground">
                        {r.note ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.mapped_by ?? "—"}
                      </TableCell>
                      <TableCell>
                        <EditDialog
                          trigger={<RowAction danger>Remove</RowAction>}
                          title={`Remove the ${fmtPct(r.discount_pct)} plan ${r.valid_from} → ${r.valid_to}?`}
                          description="DBU spend in this window re-prices at full list in all live views. Published months keep the figures they were published with. To change dates or the rate, remove the plan and add a corrected one."
                        >
                          <ActionForm
                            action={deleteDbuDiscountAction}
                            submitLabel="Remove plan"
                            danger
                          >
                            <input type="hidden" name="valid_from" value={r.valid_from} />
                            <input type="hidden" name="valid_to" value={r.valid_to} />
                          </ActionForm>
                        </EditDialog>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
