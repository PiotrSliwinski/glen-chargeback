"use client";

import { useActionState } from "react";
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
    <form action={formAction} className={cn("space-y-3", className)}>
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
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={name}
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
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <select
        id={name}
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
