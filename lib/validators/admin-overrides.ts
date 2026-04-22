import { z } from "zod";

import { eventStatusEnum } from "@/lib/db/schema/sports";

export const OVERRIDE_ENTITIES = ["team", "phase", "event", "odds"] as const;
export type OverrideEntity = (typeof OVERRIDE_ENTITIES)[number];

export const toggleLockSchema = z.object({
  entity: z.enum(OVERRIDE_ENTITIES),
  id: z.string().uuid({ error: "Invalid id." }),
  locked: z.boolean(),
});

export type ToggleLockInput = z.infer<typeof toggleLockSchema>;

// Shared UTC datetime literal (e.g. "2025-09-10 13:00"). The schema keeps the
// value as a string so the same schema works on both the client (RHF) and the
// server; `parseUtcDatetime` below converts to Date after a successful parse.
// We deliberately avoid <input type="datetime-local">: it reinterprets strings
// in the browser's local timezone, which is unsafe for an admin correction
// tool where the DB truth is in UTC.
export const UTC_DATETIME_FORMAT = "YYYY-MM-DD HH:MM (UTC)";
const utcDatetimeRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

const utcDatetimeString = z
  .string({ error: "Required." })
  .regex(utcDatetimeRegex, `Format: ${UTC_DATETIME_FORMAT}`)
  .refine(isValidUtcDatetime, {
    message: `Invalid date. Format: ${UTC_DATETIME_FORMAT}`,
  });

export function parseUtcDatetime(value: string): Date {
  return new Date(`${value.replace(" ", "T")}:00Z`);
}

function isValidUtcDatetime(value: string): boolean {
  // Reject calendar rollovers (e.g. "2025-02-30" → Mar 2). The regex
  // guarantees shape; this confirms every field is in-range by reading
  // the Date back out and comparing components.
  if (!utcDatetimeRegex.test(value)) return false;
  const [y, mo, d, h, mi] = value
    .replace(" ", "-")
    .replace(":", "-")
    .split("-")
    .map(Number);
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > 31) return false;
  if (h > 23 || mi > 59) return false;
  const parsed = parseUtcDatetime(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return (
    parsed.getUTCFullYear() === y &&
    parsed.getUTCMonth() + 1 === mo &&
    parsed.getUTCDate() === d &&
    parsed.getUTCHours() === h &&
    parsed.getUTCMinutes() === mi
  );
}

const optionalUrl = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.union([z.null(), z.string().url("Must be a valid URL.")]));

export const updateTeamSchema = z.object({
  id: z.string().uuid({ error: "Invalid id." }),
  name: z.string().trim().min(1, "Required.").max(100),
  location: z.string().trim().min(1, "Required.").max(100),
  abbreviation: z
    .string()
    .trim()
    .min(2, "At least 2 characters.")
    .max(5, "At most 5 characters.")
    .toUpperCase()
    .refine((v) => /^[A-Z]+$/.test(v), "Letters only."),
  logoUrl: optionalUrl,
  logoDarkUrl: optionalUrl,
});

export type UpdateTeamInput = z.input<typeof updateTeamSchema>;

export const updatePhaseSchema = z
  .object({
    id: z.string().uuid({ error: "Invalid id." }),
    label: z.string().trim().min(1, "Required.").max(100),
    startDate: utcDatetimeString,
    endDate: utcDatetimeString,
    pickLockTime: utcDatetimeString,
  })
  // ISO UTC strings compare lexically — same ordering as Date comparison.
  .refine((data) => data.startDate < data.endDate, {
    message: "Start date must be before end date.",
    path: ["endDate"],
  });

export type UpdatePhaseInput = z.input<typeof updatePhaseSchema>;

const scoreString = z
  .string()
  .trim()
  .regex(/^\d*$/, "Enter a non-negative whole number or leave empty.");

export function parseScore(value: string): number | null {
  return value === "" ? null : Number.parseInt(value, 10);
}

const periodString = z
  .string()
  .trim()
  .regex(/^\d*$/, "Enter a non-negative whole number or leave empty.");

export function parsePeriod(value: string): number | null {
  return value === "" ? null : Number.parseInt(value, 10);
}

const clockString = z.string().trim().max(20, "At most 20 characters.");

export const eventStatusValues = eventStatusEnum.enumValues;

export const updateEventSchema = z
  .object({
    id: z.string().uuid({ error: "Invalid id." }),
    homeTeamId: z.string().uuid({ error: "Invalid home team." }),
    awayTeamId: z.string().uuid({ error: "Invalid away team." }),
    startTime: utcDatetimeString,
    status: z.enum(eventStatusValues),
    homeScore: scoreString,
    awayScore: scoreString,
    period: periodString,
    clock: clockString,
  })
  .refine((data) => data.homeTeamId !== data.awayTeamId, {
    message: "Home and away teams must be different.",
    path: ["awayTeamId"],
  })
  .refine((data) => data.status !== "final" || data.homeScore !== "", {
    message: "Required when status is final.",
    path: ["homeScore"],
  })
  .refine((data) => data.status !== "final" || data.awayScore !== "", {
    message: "Required when status is final.",
    path: ["awayScore"],
  });

export type UpdateEventInput = z.input<typeof updateEventSchema>;

const decimalString = z
  .string()
  .trim()
  .regex(/^(-?\d+(\.\d+)?)?$/, "Enter a number (e.g. -3.5) or leave empty.");

const integerString = z
  .string()
  .trim()
  .regex(/^(-?\d+)?$/, "Enter a whole number or leave empty.");

export function parseDecimal(value: string): number | null {
  return value === "" ? null : Number.parseFloat(value);
}

export function parseInteger(value: string): number | null {
  return value === "" ? null : Number.parseInt(value, 10);
}

export const updateOddsSchema = z.object({
  id: z.string().uuid({ error: "Invalid id." }),
  homeSpread: decimalString,
  awaySpread: decimalString,
  homeMoneyline: integerString,
  awayMoneyline: integerString,
  overUnder: decimalString,
});

export type UpdateOddsInput = z.input<typeof updateOddsSchema>;
