import { formatInTimeZone } from "date-fns-tz";

export function formatUtc(d: Date | null): string {
  if (!d) return "—";
  return formatInTimeZone(d, "UTC", "yyyy-MM-dd HH:mm 'UTC'");
}

export function toUtcInput(d: Date): string {
  return formatInTimeZone(d, "UTC", "yyyy-MM-dd HH:mm");
}

export function numberToInput(n: number | null): string {
  return n === null ? "" : String(n);
}
