import type { ComponentProps } from "react";
import type { AnyFieldApi } from "@tanstack/react-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Shared per-field Label + Input + error-<p> wiring for TanStack Form text
// fields — claim-username and profile otherwise hand-roll identical
// aria-invalid/aria-describedby plumbing per field. `AnyFieldApi` (not the
// form's own generics) is the documented shape for a field component reused
// across different `useForm` instances.
export function FormTextField({
  field,
  label,
  ...inputProps
}: {
  field: AnyFieldApi;
  label: string;
} & Omit<
  ComponentProps<typeof Input>,
  "id" | "value" | "onChange" | "aria-invalid" | "aria-describedby"
>) {
  const error = field.state.meta.errors[0] as unknown;
  const errorId = `${field.name}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={field.name}>{label}</Label>
      <Input
        id={field.name}
        value={field.state.value}
        onChange={(event) => field.handleChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...inputProps}
      />
      {error !== undefined && (
        <p id={errorId} className="text-sm text-destructive">
          {fieldErrorMessage(error)}
        </p>
      )}
    </div>
  );
}

// A field error is either a plain string (server-set via `form.setErrorMap`,
// e.g. the 409 "username taken" case) or a Standard Schema issue object (from
// a Zod validator) — normalize both to the message text rendered above.
function fieldErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Invalid value.";
}
