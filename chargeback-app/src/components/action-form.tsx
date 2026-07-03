"use client";

import { useActionState, useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/action-result";

type FormAction = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

/**
 * Generic mutation form: wires a server action through useActionState and
 * renders the structured result inline. Compose fields as children.
 */
export function ActionForm({
  action,
  submitLabel,
  danger = false,
  note,
  children,
  className,
}: {
  action: FormAction;
  submitLabel: string;
  danger?: boolean;
  note?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    // whitespace-normal: these forms often render inside table cells, which
    // set whitespace-nowrap — without the reset, notes and status messages
    // refuse to wrap and blow out the table width.
    <form action={formAction} className={cn("space-y-3 whitespace-normal", className)}>
      {children}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <Button type="submit" disabled={pending} variant={danger ? "destructive" : "default"}>
        {pending ? "Saving…" : submitLabel}
      </Button>
      {state && (
        <p
          role="status"
          className={cn(
            "rounded-lg px-3 py-2 text-sm",
            state.ok ? "bg-emerald-50 text-emerald-800" : "bg-destructive/10 text-destructive",
          )}
        >
          {state.ok ? (state.message ?? "Done.") : state.message}
        </p>
      )}
    </form>
  );
}

export function Field({
  label,
  name,
  defaultValue,
  type = "text",
  required = true,
  readOnly = false,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  type?: string;
  required?: boolean;
  readOnly?: boolean;
  placeholder?: string;
}) {
  // useId, not `name`: the same form repeats once per table row, so a
  // name-derived id would be duplicated across the page and label clicks
  // (and screen readers) would target the first matching row's input.
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        readOnly={readOnly}
        placeholder={placeholder}
        className={cn(readOnly && "bg-muted text-muted-foreground")}
      />
    </div>
  );
}

/**
 * Native select styled to match the shadcn Input. Kept native (rather than
 * the Radix Select) because these forms rely on plain FormData semantics,
 * including empty-string option values, which Radix Select does not allow.
 */
export function SelectField({
  label,
  name,
  options,
  defaultValue,
  required = true,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  required?: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <select
        id={id}
        name={name}
        aria-label={label}
        defaultValue={defaultValue}
        required={required}
        className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Free-text input with datalist suggestions (e.g. desk names: existing values
 * are suggested but new ones are allowed). Ids come from useId so the field
 * can repeat once per table row without colliding.
 */
export function DatalistField({
  label,
  name,
  options,
  defaultValue,
  required = true,
}: {
  label: string;
  name: string;
  options: string[];
  defaultValue?: string;
  required?: boolean;
}) {
  const id = useId();
  const listId = `${id}-list`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input id={id} name={name} defaultValue={defaultValue} required={required} list={listId} />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </div>
  );
}
