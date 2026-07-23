import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Shared numeric-input wiring for picksPerWeek / maxBracketsPerMember /
// custom round values (league-settings-fields.tsx). A local string draft
// holds "" / partial input without the controlled `value` prop snapping it
// back; only a full integer propagates up, and blur normalizes the draft to
// the last valid value, clamped to min/max (submit-time Zod validation is
// still the real gate).
export function NumberField({
  id,
  label,
  value,
  onValueChange,
  min,
  max,
}: {
  id: string;
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  const [committedValue, setCommittedValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);

  // Derived-state-from-props, run during render rather than an effect: picks
  // up an external `value` change (e.g. a sibling control resetting this
  // field) without clobbering a live keystroke.
  if (value !== committedValue && !isFocused) {
    setCommittedValue(value);
    setDraft(String(value));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={draft}
        onFocus={() => setIsFocused(true)}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const parsed = Number(next);
          if (next.trim() !== "" && Number.isInteger(parsed)) {
            setCommittedValue(parsed);
            onValueChange(parsed);
          }
        }}
        onBlur={() => {
          setIsFocused(false);
          const parsed = Number(draft);
          const base = draft.trim() !== "" && Number.isInteger(parsed) ? parsed : value;
          const normalized = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min, base));
          setDraft(String(normalized));
          setCommittedValue(normalized);
          if (normalized !== value) onValueChange(normalized);
        }}
      />
    </div>
  );
}
