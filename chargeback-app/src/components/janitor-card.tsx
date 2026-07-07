import type { ReactNode } from "react";
import { Sparkles, Trash2 } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { EditDialog, RowAction } from "@/components/edit-dialog";
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
import type { ActionResult } from "@/lib/action-result";

type Action = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

export interface JanitorItem {
  /** bulk-delete "keys" value AND React key */
  key: string;
  /** what the per-row remove dialog names ("job 77", "aks-shared-01") */
  dialogLabel: string;
  /** leading cells, one per entry in `headers` */
  cells: ReactNode[];
  /** hidden inputs identifying the row for the single-delete action */
  hidden: { name: string; value: string }[];
  data_product: string;
  tagged_cost_30d: number;
}

/**
 * The "safe to remove" janitor card, shared by the Databricks (/admin/jobs)
 * and Azure (/admin/azure) attribution screens: bridge rows whose entities now
 * emit TAG-attributed cost — the tag at source has landed, the bridge row is
 * redundant. Renders nothing when the list is empty.
 */
export function JanitorCard({
  noun,
  headers,
  items,
  deleteAction,
  bulkDeleteAction,
}: {
  /** "job" | "resource" — used in the explanatory copy */
  noun: string;
  /** leading column headers before Product / TAG cost 30d */
  headers: string[];
  items: JanitorItem[];
  deleteAction: Action;
  bulkDeleteAction: Action;
}) {
  if (items.length === 0) return null;
  return (
    <Card className="mb-4 ring-emerald-200 bg-emerald-50/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-emerald-800">
          <Sparkles className="size-4" aria-hidden /> Safe to remove — now tagged at source
        </CardTitle>
        <CardDescription className="text-xs text-emerald-700">
          These bridge rows point at {noun}s that produced TAG-attributed cost in the last 30
          days: the tag has landed, the bridge is redundant. Removing them shrinks this table
          toward its goal state (empty). The tag keeps winning either way — it is rule 1 of the
          waterfall.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="no-print mb-3">
          <EditDialog
            trigger={
              <Button variant="outline" size="sm">
                <Trash2 aria-hidden /> Remove all {items.length} redundant bridge
                {items.length > 1 ? "s" : ""}
              </Button>
            }
            title={`Remove ${items.length} redundant bridge mapping${items.length > 1 ? "s" : ""}?`}
            description={`Every listed ${noun} produced TAG-attributed cost in the last 30 days — the tag keeps winning either way. This just prunes the redundant rows.`}
          >
            <ActionForm action={bulkDeleteAction} submitLabel="Remove all listed">
              {items.map((i) => (
                <input key={i.key} type="hidden" name="keys" value={i.key} />
              ))}
            </ActionForm>
          </EditDialog>
        </div>
        <Table className="max-w-2xl">
          <TableHeader>
            <TableRow>
              {headers.map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
              <TableHead>Product</TableHead>
              <TableHead className="text-right">TAG cost 30d</TableHead>
              <TableHead>
                <span className="sr-only">Action</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.key}>
                {i.cells.map((c, n) => (
                  <TableCell key={n}>{c}</TableCell>
                ))}
                <TableCell className="font-mono text-xs">{i.data_product}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtMoney(i.tagged_cost_30d)}
                </TableCell>
                <TableCell>
                  <EditDialog
                    trigger={<RowAction danger>Remove bridge</RowAction>}
                    title={`Remove redundant bridge for ${i.dialogLabel}?`}
                    description={`This ${noun} produced TAG-attributed cost in the last 30 days — the tag keeps winning either way. This just prunes the redundant row.`}
                  >
                    <ActionForm action={deleteAction} submitLabel="Remove bridge" danger>
                      {i.hidden.map((h) => (
                        <input key={h.name} type="hidden" name={h.name} value={h.value} />
                      ))}
                    </ActionForm>
                  </EditDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
