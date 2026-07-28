import type { AnyFieldApi } from "@tanstack/react-form";
import { Label } from "@/components/ui/label";
import { DateTimePicker } from "@/components/ui/date-time-picker";
// Shared with FormTextField: one normalization of "string | Standard Schema
// issue" so the two field adapters can't drift on what an error renders as.
import { fieldErrorMessage } from "@/components/form-field";

// TanStack Form adapter for DateTimePicker, mirroring FormTextField's
// Label + control + error-<p> wiring (form-field.tsx) for the one form field
// that needs a date/time control instead of a plain Input — sim-fixture-row's
// `kickoffAt`. Kept as its own component rather than teaching FormTextField
// to swap controls, matching how LabeledSelect stays separate from
// FormTextField today.
export function FormDateTimeField({
  field,
  label,
  id,
}: {
  field: AnyFieldApi;
  label: string;
  // Overrides the DOM id (defaults to `field.name`) — same reason
  // FormTextField takes one: one editor per row in a list
  // (sim-fixture-row.tsx) would otherwise collide on `field.name` across rows.
  id?: string;
}) {
  const error = field.state.meta.errors[0] as unknown;
  const fieldId = id ?? field.name;
  const errorId = `${fieldId}-error`;
  const labelId = `${fieldId}-label`;

  return (
    <div className="flex flex-col gap-1.5">
      <Label id={labelId} htmlFor={fieldId}>
        {label}
      </Label>
      <DateTimePicker
        id={fieldId}
        value={field.state.value}
        onChange={field.handleChange}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        aria-labelledby={labelId}
      />
      {error !== undefined && (
        <p id={errorId} className="text-sm text-destructive">
          {fieldErrorMessage(error)}
        </p>
      )}
    </div>
  );
}
