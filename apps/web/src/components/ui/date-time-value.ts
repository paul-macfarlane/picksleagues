// Pure conversions between the "YYYY-MM-DDTHH:mm" local wall-clock string the
// app's date/time fields carry on the wire (the same shape a native
// `datetime-local` input produced, and what `toLocalDateTimeInputValue`
// seeds — see lib/format.ts) and the split { date, time } shape
// DateTimePicker's calendar and time input each drive independently. Kept
// pure and out of the component so the boundary that actually carries bugs
// here — local vs UTC, midnight vs "unset" — is unit-testable without
// mounting anything.

export type LocalDateTimeParts = {
  date: Date | undefined;
  time: string; // "HH:mm"; "" when no time has been chosen yet
};

const TIME_PATTERN = /^\d{2}:\d{2}$/;

// `new Date(value)` here parses a value the operator already typed or
// selected — the sanctioned exception to the Clock rule (not a "now" read;
// see invite-panel.tsx for the same reasoning at the existing call sites).
export function splitLocalDateTimeValue(value: string): LocalDateTimeParts {
  if (!value) return { date: undefined, time: "" };
  const [, timePart = ""] = value.split("T");
  const parsed = new Date(value);
  return {
    date: Number.isNaN(parsed.getTime()) ? undefined : parsed,
    time: TIME_PATTERN.test(timePart) ? timePart : "",
  };
}

// Recombines a calendar-selected date with a "HH:mm" time-of-day into the
// same "YYYY-MM-DDTHH:mm" shape the input this replaces produced — the exact
// round trip `toLocalDateTimeInputValue`/`buildFixturePatch` depend on. Reads
// the date's local getters (never UTC ones), matching how the calendar
// itself represents the selected day.
export function combineLocalDateTimeValue(date: Date, time: string): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${datePart}T${TIME_PATTERN.test(time) ? time : "00:00"}`;
}
