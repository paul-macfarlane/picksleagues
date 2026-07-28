// One home for "render an ISO timestamp in the viewer's local timezone"
// (engineering rules: kickoff times/deadlines always render local, never a
// fixed zone) — every kickoff/deadline display in the SPA goes through this.
// Minute-grained: kickoffs, deadlines and "last updated" stamps never need
// second precision, and the locale default (`toLocaleString()` with no
// options) includes seconds.
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

// Date-only counterpart for stamps that never carry a time component (invite
// created date, member joined date) — same locale-aware, no-hardcoded-zone
// reasoning as formatDateTime.
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "short" });
}

// Renders an ISO instant as the local "YYYY-MM-DDTHH:mm" a `datetime-local`
// input expects — `toISOString` renders UTC, which would silently show the
// operator a different instant than the one being edited. Shared by the
// simulated-clock card and the fixture editor (SIM-9).
export function toLocalDateTimeInputValue(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}
