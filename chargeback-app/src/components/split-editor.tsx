"use client";

import { useId, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface SplitRow {
  desk: string;
  pct: number;
}

/**
 * Desk split editor for product forms: one row per desk with its share in
 * percent. Serializes to a hidden JSON input (name defaults to "splits")
 * so the plain-FormData ActionForm flow stays unchanged. Single desk at
 * 100% is the common case and the default; "Add desk" opens the split up.
 * Server-side validation (sum = 100%, unique desks) remains authoritative.
 */
export function SplitEditor({
  name = "splits",
  initial,
  deskOptions = [],
}: {
  name?: string;
  initial?: SplitRow[];
  deskOptions?: string[];
}) {
  const [rows, setRows] = useState<SplitRow[]>(
    initial && initial.length > 0 ? initial : [{ desk: "", pct: 100 }],
  );
  const id = useId();
  const listId = `${id}-desks`;

  const patch = (i: number, part: Partial<SplitRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...part } : r)));
  const remove = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));
  const add = () =>
    setRows((rs) => {
      const used = rs.reduce((s, r) => s + (Number.isFinite(r.pct) ? r.pct : 0), 0);
      return [...rs, { desk: "", pct: Math.max(Math.round((100 - used) * 100) / 100, 0) }];
    });

  const total = rows.reduce((s, r) => s + (Number.isFinite(r.pct) ? r.pct : 0), 0);
  const balanced = Math.abs(total - 100) <= 0.01;

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        {rows.length > 1 ? "Desk split (who pays what share)" : "Desk (who pays)"}
      </Label>
      <input type="hidden" name={name} value={JSON.stringify(rows)} />
      <datalist id={listId}>
        {deskOptions.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              aria-label={`Desk ${i + 1}`}
              value={row.desk}
              onChange={(e) => patch(i, { desk: e.target.value })}
              placeholder="rates"
              required
              list={listId}
              className="flex-1"
            />
            <div className="relative w-24 shrink-0">
              <Input
                aria-label={`Share of desk ${i + 1} in percent`}
                type="number"
                min={0.01}
                max={100}
                step={0.01}
                required
                value={Number.isFinite(row.pct) ? row.pct : ""}
                onChange={(e) => patch(i, { pct: e.target.valueAsNumber })}
                className="pr-6 text-right tabular-nums"
              />
              <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground">
                %
              </span>
            </div>
            {rows.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove desk ${i + 1}`}
                onClick={() => remove(i)}
              >
                <X aria-hidden />
              </Button>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <Button type="button" variant="ghost" size="sm" onClick={add}>
          <Plus aria-hidden /> Add desk
        </Button>
        {rows.length > 1 && (
          <p
            className={cn(
              "text-xs tabular-nums",
              balanced ? "text-muted-foreground" : "font-medium text-destructive",
            )}
          >
            total {Number(total.toFixed(2))}%{balanced ? "" : " — must be 100%"}
          </p>
        )}
      </div>
    </div>
  );
}
