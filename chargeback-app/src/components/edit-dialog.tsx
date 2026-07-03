import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Dedicated edit dialog: trigger + modal shell around a mutation form.
 * Server pages compose it with an ActionForm as children; Radix handles
 * focus trap, Escape and focus restore. The form's success/error result
 * renders inside the dialog, so the user sees the outcome before closing.
 */
export function EditDialog({
  trigger,
  title,
  description,
  children,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Text-style trigger for row-level actions — visually identical to the old
 * <summary> links so tables keep their density.
 */
export function RowAction({
  danger = false,
  className,
  ...props
}: React.ComponentProps<"button"> & { danger?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "cursor-pointer text-xs font-medium hover:underline",
        danger ? "text-destructive" : "text-indigo-600",
        className,
      )}
      {...props}
    />
  );
}
