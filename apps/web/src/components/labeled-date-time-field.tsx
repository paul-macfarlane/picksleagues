import { Label } from "@/components/ui/label";
import { DateTimePicker } from "@/components/ui/date-time-picker";

/**
 * Label + DateTimePicker composition for the two plain-`useState` sites
 * (sim-clock-card.tsx's "Instant" control, invite-panel.tsx's invite expiry)
 * — same Label-wiring idiom as LabeledSelect, just fronting DateTimePicker
 * instead of Select. The TanStack Form site (sim-fixture-row.tsx) goes
 * through FormDateTimeField instead, which adapts a field the way
 * FormTextField adapts one for a plain Input.
 */
export function LabeledDateTimeField({
  id,
  label,
  value,
  onChange,
  disabled,
  "aria-describedby": ariaDescribedby,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  "aria-describedby"?: string;
}) {
  const labelId = `${id}-label`;

  return (
    <div className="flex flex-col gap-1.5">
      <Label id={labelId} htmlFor={id}>
        {label}
      </Label>
      <DateTimePicker
        id={id}
        value={value}
        onChange={onChange}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={ariaDescribedby}
      />
    </div>
  );
}
