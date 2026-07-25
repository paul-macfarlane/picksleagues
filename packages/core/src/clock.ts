/**
 * All "now" reads in domain logic go through a Clock (arch D13, lint-enforced).
 * `now()` is synchronous: a Clock is resolved once per request/job, so every
 * time comparison within that unit of work sees one consistent instant, and
 * SQL receives that value as a bound parameter — never SQL `now()`.
 */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    // The one sanctioned raw time read in the codebase (arch D13).
    // eslint-disable-next-line no-restricted-syntax
    return new Date();
  }
}

/** Fixed clock for tests and simulator scenarios pinned to an exact instant. */
export class FixedClock implements Clock {
  readonly #instant: Date;

  constructor(instant: Date) {
    this.#instant = instant;
  }

  now(): Date {
    return new Date(this.#instant.getTime());
  }
}

/** System time shifted by a persisted offset — the non-prod simulated clock. */
export class OffsetClock implements Clock {
  readonly #base: Clock;
  readonly #offsetMs: number;

  constructor(base: Clock, offsetMs: number) {
    this.#base = base;
    this.#offsetMs = offsetMs;
  }

  now(): Date {
    return new Date(this.#base.now().getTime() + this.#offsetMs);
  }
}

/** Reads the simulated-clock offset persisted in `app_state` (injected from packages/db). */
export type SimOffsetReader = () => Promise<number>;

/**
 * Without the simulator there is no offset to read: system time, and the reader
 * is never invoked — so the offset code path is structurally unreachable in
 * production (arch D13), which `isSimEnabled` guarantees for `simEnabled`.
 * With it, the offset comes from the DB so all serverless instances agree.
 */
export async function resolveClock(
  simEnabled: boolean,
  readSimOffsetMs: SimOffsetReader,
): Promise<Clock> {
  if (!simEnabled) {
    return new SystemClock();
  }
  return new OffsetClock(new SystemClock(), await readSimOffsetMs());
}
