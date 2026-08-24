import type { BrowserContext } from "@playwright/test";
import { SIM_CLOCK_ADJUSTMENT_KIND, SIM_RESET_SCOPE } from "../../packages/schemas/src/index";

/** Unwraps a Playwright API response or throws with the URL and status — a failed sim call must not pass silently. */
export async function json<T>(
  res: Promise<{ ok(): boolean; json(): Promise<unknown>; status(): number; url(): string }>,
): Promise<T> {
  const r = await res;
  if (!r.ok()) throw new Error(`${r.url()} → ${r.status()}`);
  return (await r.json()) as T;
}

/**
 * Drops the active scenario and returns the clock to real time. Every sim
 * spec calls this in `afterAll` as well as before loading: the offset lives
 * on the DB singleton, not this process, so a later local run must never
 * inherit it.
 */
export async function resetSim(admin: BrowserContext): Promise<void> {
  await admin.request.post("/api/sim/reset", {
    data: { scope: SIM_RESET_SCOPE.ENVIRONMENT, dropScenario: true },
  });
}

/** Resets, loads a library scenario, then runs the named sync jobs in order. */
export async function loadScenario(
  admin: BrowserContext,
  slug: string,
  jobs: readonly string[],
): Promise<void> {
  await resetSim(admin);
  await json(admin.request.post(`/api/sim/scenarios/${slug}/load`));
  for (const job of jobs) await json(admin.request.post(`/api/admin/jobs/nfl/${job}`));
}

export async function setSimClock(admin: BrowserContext, instant: Date | number): Promise<void> {
  await json(
    admin.request.post("/api/sim/clock", {
      data: { kind: SIM_CLOCK_ADJUSTMENT_KIND.INSTANT, instant: new Date(instant).toISOString() },
    }),
  );
}
