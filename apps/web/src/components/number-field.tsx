import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Bounds check shared between the field's own error rendering and callers
 * gating a submit button on it (new.tsx, settings-section.tsx) — one source
 * of truth for what counts as "invalid" for a NumberField's current value.
 */
export function numberFieldInvalid(value: number, min: number, max?: number): boolean {
  return !Number.isInteger(value) || value < min || (max !== undefined && value > max);
}

function numberFieldErrorMessage(min: number, max?: number): string {
  return max === undefined ? `Must be at least ${min}.` : `Must be between ${min} and ${max}.`;
}

/**
 * Shared numeric-input wiring for picksPerWeek / maxBracketsPerMember /
 * maxMembers / custom round values (league-settings-fields.tsx). A local
 * string draft holds "" / partial input without the controlled `value` prop
 * snapping it back. Any fully-parsed integer commits to the parent
 * immediately, even out of range — the server is the real gate (spec: 1-16
 * picksPerWeek, 2-100 maxMembers, etc.), so an out-of-range value commits
 * visibly with an inline error (mirrors the a11y idiom of form-field.tsx's
 * FormTextField) rather than being silently clamped. Free typing is allowed
 * while focused; on blur, a leftover draft that doesn't parse to an integer
 * is restored to the committed `value` so the field always displays exactly
 * what will be submitted — displayed state never drifts from submitted state.
 */
export function NumberField({
  id,
  label,
  value,
  onValueChange,
  min,
  max,
  description,
}: {
  id: string;
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max?: number;
  // Muted helper text under the input (e.g. the field's valid range) —
  // distinct from the error message, and included in aria-describedby
  // alongside it rather than replacing it.
  description?: string;
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

  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;
  // Out-of-range is live (not blur-gated): a fully-parsed but out-of-bounds
  // integer already committed via onChange below, so the error must appear
  // immediately — that's the whole fix for the silent-clamp bug.
  const showError = numberFieldInvalid(value, min, max);
  const describedBy =
    [description ? descriptionId : null, showError ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

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
        aria-invalid={showError ? true : undefined}
        aria-describedby={describedBy}
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
          const parses = draft.trim() !== "" && Number.isInteger(parsed);
          if (!parses) {
            setDraft(String(value));
          }
        }}
      />
      {description && (
        <p id={descriptionId} className="text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {showError && (
        <p id={errorId} className="text-sm text-destructive">
          {numberFieldErrorMessage(min, max)}
        </p>
      )}
    </div>
  );
}
