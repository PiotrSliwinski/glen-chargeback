"use client";

import { useActionState } from "react";
import clsx from "clsx";
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
    <form action={formAction} className={clsx("space-y-3", className)}>
      {children}
      {note && <p className="text-xs text-slate-500">{note}</p>}
      <button type="submit" disabled={pending} className={danger ? "btn-danger" : "btn"}>
        {pending ? "Saving…" : submitLabel}
      </button>
      {state && (
        <p
          role="status"
          className={clsx(
            "rounded-md px-3 py-2 text-sm",
            state.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800",
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
    <div>
      <label className="label" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        readOnly={readOnly}
        placeholder={placeholder}
        className={clsx("input", readOnly && "bg-slate-100 text-slate-500")}
      />
    </div>
  );
}

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
    <div>
      <label className="label" htmlFor={name}>
        {label}
      </label>
      <select id={name} name={name} defaultValue={defaultValue} required={required} className="input">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
