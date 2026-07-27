import { createDb } from "@picksleagues/db";
import { FixedClock } from "@picksleagues/core";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { getTestDatabaseUrl } from "./test-database-url";
import { makeTestEnv } from "./test-env";

export const WEEK1_KICKOFF = new Date("2026-09-13T17:00:00.000Z");
// Two apps over the same DB: one with the clock before the seeded kickoff,
// one after — the various league/invite/member cutoffs are derived
// per-request from the clock (arch §Locking Model), so the same league is
// open through one app and closed through the other.
export const PRE_START_NOW = new Date("2026-09-01T00:00:00.000Z");
// now == kickoff exactly: "no joins once the league's first week has started"
// means the boundary instant itself is already closed (strict <, arch D11).
export const POST_START_NOW = new Date(WEEK1_KICKOFF.getTime() + 1);

/**
 * Builds the DB/auth/app trio shared by league-surface integration tests
 * (discovery, invites/join, members, leagues). Caller owns lifecycle — in
 * particular, each test file must still call `await db.$client.end()` in its
 * own `afterAll`; this harness intentionally does not hide that.
 */
export function makeLeagueTestHarness() {
  const db = createDb(getTestDatabaseUrl());
  const auth = createAuth({ env: makeTestEnv(), db });
  const app = createApp({ auth, db, clock: async () => new FixedClock(PRE_START_NOW) });
  const appAfterKickoff = createApp({
    auth,
    db,
    clock: async () => new FixedClock(POST_START_NOW),
  });
  const appAtKickoff = createApp({
    auth,
    db,
    clock: async () => new FixedClock(WEEK1_KICKOFF),
  });

  return { db, auth, app, appAfterKickoff, appAtKickoff };
}

export function withCookie(cookie: string | undefined): Record<string, string> {
  return cookie ? { cookie } : {};
}
