import type { ComponentProps, ReactNode } from "react";
import type { AnyFieldApi } from "@tanstack/react-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Shared per-field Label + Input + error-<p> wiring for TanStack Form text
 * fields — claim-username and profile otherwise hand-roll identical
 * aria-invalid/aria-describedby plumbing per field. `AnyFieldApi` (not the
 * form's own generics) is the documented shape for a field component reused
 * across different `useForm` instances.
 */
export function FormTextField({
  field,
  label,
  id,
  hint,
  ...inputProps
}: {
  field: AnyFieldApi;
  label: string;
  // Overrides the DOM id (defaults to `field.name`) — needed when the same
  // field name repeats across independent form instances, e.g. one editor per
  // row in a list (sim-fixture-row.tsx), where `field.name` alone would
  // collide across rows.
  id?: string;
  // Standing guidance about the field, rendered muted beneath the input and
  // wired into `aria-describedby`. It lives here rather than beside a call site
  // because a hint the input doesn't point at is one a screen reader never
  // reads — the same plumbing reason the error <p> is here. Guidance about
  // *one field* belongs on that field, not in the surrounding card's prose,
  // where it reads as page copy and is missed by anyone tabbing to the input.
  hint?: ReactNode;
} & Omit<
  ComponentProps<typeof Input>,
  "id" | "value" | "onChange" | "aria-invalid" | "aria-describedby"
>) {
  const error = field.state.meta.errors[0] as unknown;
  const fieldId = id ?? field.name;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;
  // Both when both are present: the hint stays true while an error is showing,
  // so dropping it would silently narrow what a screen reader hears exactly
  // when the member most needs the guidance.
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={fieldId}>{label}</Label>
      <Input
        id={fieldId}
        value={field.state.value}
        onChange={(event) => field.handleChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...inputProps}
      />
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className="text-sm text-destructive">
          {fieldErrorMessage(error)}
        </p>
      )}
    </div>
  );
}

/**
 * `FormTextField`'s multi-line sibling — identical Label/error/hint a11y
 * wiring around a `Textarea`, extracted for the same reason: per-field ARIA
 * plumbing hand-rolled at call sites comes out slightly different every time.
 */
export function FormTextareaField({
  field,
  label,
  id,
  hint,
  ...textareaProps
}: {
  field: AnyFieldApi;
  label: string;
  id?: string;
  hint?: ReactNode;
} & Omit<
  ComponentProps<typeof Textarea>,
  "id" | "value" | "onChange" | "aria-invalid" | "aria-describedby"
>) {
  const error = field.state.meta.errors[0] as unknown;
  const fieldId = id ?? field.name;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={fieldId}>{label}</Label>
      <Textarea
        id={fieldId}
        value={field.state.value}
        onChange={(event) => field.handleChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...textareaProps}
      />
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className="text-sm text-destructive">
          {fieldErrorMessage(error)}
        </p>
      )}
    </div>
  );
}

/**
 * A field error is either a plain string (server-set via `form.setErrorMap`,
 * e.g. the 409 "username taken" case) or a Standard Schema issue object (from
 * a Zod validator) — normalize both to the message text rendered above.
 */
export function fieldErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Invalid value.";
}
