/**
 * One home for "render an ISO timestamp in the viewer's local timezone"
 * (engineering rules: kickoff times/deadlines always render local, never a
 * fixed zone) — every kickoff/deadline display in the SPA goes through this.
 * Minute-grained: kickoffs, deadlines and "last updated" stamps never need
 * second precision, and the locale default (`toLocaleString()` with no
 * options) includes seconds.
 */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

// Calendar days from one instant to the other, in the viewer's local timezone —
// "is this the same day" is a calendar question, not a 24-hour one, so both
// sides collapse to local midnight first. `Math.round` absorbs the 23- and
// 25-hour days a DST boundary produces.
function localDaysBetween(from: Date, to: Date): number {
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((midnight(to) - midnight(from)) / 86_400_000);
}

/**
 * A kickoff or deadline, named the way a member would say it: "Today 1:00 PM",
 * "Sun 8:20 PM", falling back to the absolute stamp beyond a week.
 *
 * Pick'em is played inside a seven-day window, so the relative form is almost
 * always the useful one — `Sun 1:00 PM` answers "when do I need to have picked"
 * far faster than `9/13/26, 1:00 PM` does. Weekday names stop at six days out
 * precisely because the seventh would be ambiguous with today.
 *
 * `now` is passed in rather than read here: it must come from the app clock
 * (`useAppNow`, arch D13), which under the simulator is not the browser's. A
 * function that reached for `Date.now()` itself would be right in production
 * and quietly wrong in exactly the environment built to test this.
 *
 * Deliberately *not* what `formatDateTime` does. Settled kickoffs, "last
 * updated" stamps, and audit rows want the precise instant — "yesterday" beside
 * a final score is worse than a date.
 */
export function formatKickoff(iso: string, now: Date): string {
  const at = new Date(iso);
  const days = localDaysBetween(now, at);
  const time = at.toLocaleTimeString(undefined, { timeStyle: "short" });

  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days === -1) return `Yesterday ${time}`;
  if (days > 1 && days < 7)
    return `${at.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  return formatDateTime(iso);
}

/**
 * Date-only counterpart for stamps that never carry a time component (invite
 * created date, member joined date) — same locale-aware, no-hardcoded-zone
 * reasoning as formatDateTime.
 */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "short" });
}

/**
 * Renders an ISO instant as the local "YYYY-MM-DDTHH:mm" a `datetime-local`
 * input expects — `toISOString` renders UTC, which would silently show the
 * operator a different instant than the one being edited. Shared by the
 * simulated-clock card and the fixture editor (SIM-9).
 */
export function toLocalDateTimeInputValue(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}
