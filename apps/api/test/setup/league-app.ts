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
 *
 * Also returns the picks/standings HTTP request helpers, each bound to the
 * harness's own `app` as its default `on` target — this is what lets callers
 * pass `appAtKickoff`/`appAfterKickoff` for the boundary cases while every
 * other call site stays terse.
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

  type App = typeof app;

  function getSlate(cookie: string | undefined, weekId: string, on: App = app) {
    return on.request(`/api/weeks/${weekId}/games`, { headers: withCookie(cookie) });
  }

  function getPicks(cookie: string | undefined, leagueId: string, weekId: string, on: App = app) {
    return on.request(`/api/leagues/${leagueId}/pickem/weeks/${weekId}/picks`, {
      headers: withCookie(cookie),
    });
  }

  function putPicks(
    cookie: string | undefined,
    leagueId: string,
    weekId: string,
    body: unknown,
    on: App = app,
  ) {
    return on.request(`/api/leagues/${leagueId}/pickem/weeks/${weekId}/picks`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...withCookie(cookie) },
      body: JSON.stringify(body),
    });
  }

  function getSurvivorPicks(
    cookie: string | undefined,
    leagueId: string,
    weekId: string,
    on: App = app,
  ) {
    return on.request(`/api/leagues/${leagueId}/survivor/weeks/${weekId}/picks`, {
      headers: withCookie(cookie),
    });
  }

  // Singular path: the write is the caller's one pick, the read is the league's.
  function putSurvivorPick(
    cookie: string | undefined,
    leagueId: string,
    weekId: string,
    body: unknown,
    on: App = app,
  ) {
    return on.request(`/api/leagues/${leagueId}/survivor/weeks/${weekId}/pick`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...withCookie(cookie) },
      body: JSON.stringify(body),
    });
  }

  function getSurvivorStandings(cookie: string | undefined, leagueId: string, on: App = app) {
    return on.request(`/api/leagues/${leagueId}/survivor/standings`, {
      headers: withCookie(cookie),
    });
  }

  function getStandings(cookie: string | undefined, leagueId: string, query = "", on: App = app) {
    return on.request(`/api/leagues/${leagueId}/pickem/standings${query}`, {
      headers: withCookie(cookie),
    });
  }

  function getPickSummary(cookie: string | undefined, leagueId: string, on: App = app) {
    return on.request(`/api/leagues/${leagueId}/pickem/pick-summary`, {
      headers: withCookie(cookie),
    });
  }

  return {
    db,
    auth,
    app,
    appAfterKickoff,
    appAtKickoff,
    getSlate,
    getPicks,
    putPicks,
    getSurvivorPicks,
    putSurvivorPick,
    getSurvivorStandings,
    getStandings,
    getPickSummary,
  };
}

export function withCookie(cookie: string | undefined): Record<string, string> {
  return cookie ? { cookie } : {};
}
