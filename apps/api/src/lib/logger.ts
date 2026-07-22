/**
 * Minimal structured logging: one JSON line per event, level-tagged, to
 * stdout (info) or stderr (error) so log platforms (Vercel, local console)
 * can filter/parse without a logging library.
 *
 * Deliberately no timestamp field — the platform already stamps every log
 * line, and adding our own would mean threading the Clock (arch D13) into
 * every call site just to serialize wall-clock time nobody derives logic
 * from.
 */

const LOG_LEVEL = {
  INFO: "info",
  ERROR: "error",
} as const;

type LogLevel = (typeof LOG_LEVEL)[keyof typeof LOG_LEVEL];

/** Errors don't serialize to JSON as anything useful by default — pull out message/stack. */
function serializeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const serialized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    serialized[key] = value instanceof Error ? { message: value.message, stack: value.stack } : value;
  }
  return serialized;
}

function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, event, ...serializeFields(fields) });
  if (level === LOG_LEVEL.ERROR) {
    console.error(line);
  } else {
    console.log(line);
  }
}

export function logInfo(event: string, fields?: Record<string, unknown>): void {
  log(LOG_LEVEL.INFO, event, fields);
}

export function logError(event: string, fields?: Record<string, unknown>): void {
  log(LOG_LEVEL.ERROR, event, fields);
}
