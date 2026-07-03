"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Row selection for bulk editing. BulkSelect wraps a table (server-rendered
 * children pass through) and owns the picked set; `values` is the list of
 * keys currently shown, so selection self-prunes when rows are filtered out
 * or disappear after a mutation revalidates the page.
 */

type BulkSelectContext = {
  values: string[];
  selected: string[];
  isSelected: (v: string) => boolean;
  toggle: (v: string) => void;
  setAll: (on: boolean) => void;
  clear: () => void;
};

const Ctx = createContext<BulkSelectContext | null>(null);

function useBulkSelect(component: string): BulkSelectContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error(`${component} must be used inside <BulkSelect>`);
  return ctx;
}

export function BulkSelect({
  values,
  children,
}: {
  values: string[];
  children: React.ReactNode;
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const ctx = useMemo<BulkSelectContext>(() => {
    const selected = values.filter((v) => picked.has(v));
    return {
      values,
      selected,
      isSelected: (v) => picked.has(v),
      toggle: (v) =>
        setPicked((prev) => {
          const next = new Set(prev);
          if (next.has(v)) next.delete(v);
          else next.add(v);
          return next;
        }),
      setAll: (on) => setPicked(on ? new Set(values) : new Set()),
      clear: () => setPicked(new Set()),
    };
  }, [values, picked]);
  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

const checkboxClass =
  "size-4 cursor-pointer rounded accent-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/** One checkbox per row. `label` is the screen-reader name for the row. */
export function BulkCheckbox({ value, label }: { value: string; label: string }) {
  const { isSelected, toggle } = useBulkSelect("BulkCheckbox");
  return (
    <input
      type="checkbox"
      className={checkboxClass}
      aria-label={label}
      checked={isSelected(value)}
      onChange={() => toggle(value)}
    />
  );
}

/** Header checkbox — selects/deselects every currently shown row. */
export function BulkCheckboxAll({ label = "Select all rows" }: { label?: string }) {
  const { values, selected, setAll } = useBulkSelect("BulkCheckboxAll");
  const all = values.length > 0 && selected.length === values.length;
  return (
    <input
      type="checkbox"
      className={checkboxClass}
      aria-label={label}
      checked={all}
      ref={(el) => {
        if (el) el.indeterminate = selected.length > 0 && !all;
      }}
      onChange={(e) => setAll(e.currentTarget.checked)}
    />
  );
}

/**
 * Floating action bar; appears once something is selected. Children are the
 * bulk actions (dialog triggers) composed by the page.
 */
export function BulkActionBar({
  noun = "row",
  children,
}: {
  noun?: string;
  children: React.ReactNode;
}) {
  const { selected, clear } = useBulkSelect("BulkActionBar");
  return (
    // CSS-hidden rather than unmounted when empty: a bulk dialog stays open
    // (it portals out of this subtree) while the mutation it submitted prunes
    // the selection — unmounting here would tear the dialog down before the
    // user sees its success message.
    <div
      className={cn(
        "no-print pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4",
        selected.length === 0 && "hidden",
      )}
    >
      <div
        role="toolbar"
        aria-label="Bulk actions"
        className="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-background px-4 py-2.5 shadow-lg"
      >
        <p className="text-sm font-medium tabular-nums" role="status">
          {selected.length} {plural(selected.length, noun)} selected
        </p>
        {children}
        <Button variant="ghost" size="sm" onClick={clear}>
          Clear
        </Button>
      </div>
    </div>
  );
}

/** Hidden inputs carrying the selection — drop inside a bulk ActionForm. */
export function BulkSelectedInputs({ name }: { name: string }) {
  const { selected } = useBulkSelect("BulkSelectedInputs");
  return (
    <>
      {selected.map((v) => (
        <input key={v} type="hidden" name={name} value={v} />
      ))}
    </>
  );
}

/**
 * "Applies to N rows." line for bulk dialogs — the selection can be wider
 * than the user remembers (it survives earlier mutations), so every bulk
 * form states its blast radius right above the submit button.
 */
export function BulkAppliesTo({ noun = "row" }: { noun?: string }) {
  const { selected } = useBulkSelect("BulkAppliesTo");
  return (
    <p className="text-sm font-medium tabular-nums">
      Applies to {selected.length} {plural(selected.length, noun)}.
    </p>
  );
}
