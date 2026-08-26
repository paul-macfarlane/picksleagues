import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "@picksleagues/core";
import { GAME_STATUS, type AdminGamesResponse } from "@picksleagues/schemas";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import { seedSeason, setGame } from "./setup/league-helpers";
import { resetDb } from "./setup/reset-db";
import { makeFixedAppHarness } from "./setup/fixed-app";

/**
 * Detection of `unlocked ∧ outcome-knowable` games (ADM-3) — the state a
 * provider bug produces when it reports a score against a kickoff it still
 * places in the future. Ingestion must never fail on account of what it was
 * handed, so this is detection rather than admission control.
 *
 * Its own file rather than an addition to `admin-audit.test.ts`: that file is
 * about who did what and when, this one is about game state arranged around a
 * fixed instant, and the two share no fixture.
 */

const NOW = new Date("2026-09-20T00:00:00.000Z");
const PAST = new Date("2026-09-19T00:00:00.000Z");
const FUTURE = new Date("2026-09-21T00:00:00.000Z");
// One millisecond past the lock boundary — the smallest gap that must flip the
// answer, since `isLocked` is `kickoff <= now`.
const JUST_AFTER_NOW = new Date(NOW.getTime() + 1);

const { db, auth, appAt, adminCaller } = makeFixedAppHarness();
const clock = new FixedClock(NOW);

function buildApp() {
  return appAt(clock.now());
}

type App = ReturnType<typeof buildApp>;

function getAnomalies(app: App, cookie: string) {
  return app.request("/api/admin/games/anomalies", { headers: { cookie } });
}

async function anomalousIds(app: App, cookie: string): Promise<string[]> {
  const res = await getAnomalies(app, cookie);
  expect(res.status).toBe(200);
  const body = (await res.json()) as AdminGamesResponse;
  return body.games.map((game) => game.id);
}

/**
 * One week holding every combination the predicate has to separate, so a single
 * read of the endpoint is the whole assertion.
 */
async function seedGames() {
  const { gameIds } = await seedSeason(db, {
    weeks: [
      {
        weekNumber: 1,
        kickoffs: [
          { kickoffAt: PAST },
          { kickoffAt: FUTURE },
          { kickoffAt: PAST },
          { kickoffAt: FUTURE },
          { kickoffAt: NOW },
          { kickoffAt: JUST_AFTER_NOW },
          { kickoffAt: FUTURE },
        ],
      },
    ],
  });
  const ids = gameIds.get("regular:1")!;
  const [
    scheduledPast,
    providerBug,
    lockedFinal,
    upcoming,
    atBoundary,
    justPastBoundary,
    scoredPostponed,
  ] = ids as [string, string, string, string, string, string, string];

  // A provider bug: it reports a final score on a game whose kickoff it still
  // places in the future. No admin has touched this row.
  await setGame(db, providerBug, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 });
  await setGame(db, lockedFinal, { status: GAME_STATUS.FINAL, homeScore: 17, awayScore: 13 });
  await setGame(db, atBoundary, { status: GAME_STATUS.FINAL, homeScore: 21, awayScore: 20 });
  await setGame(db, justPastBoundary, { status: GAME_STATUS.FINAL, homeScore: 21, awayScore: 20 });
  // A score without a started status: knowable without ever having started,
  // which is why the query's score disjunct is not redundant with its status one.
  await setGame(db, scoredPostponed, { status: GAME_STATUS.POSTPONED, homeScore: 7, awayScore: 3 });

  return {
    scheduledPast,
    providerBug,
    lockedFinal,
    upcoming,
    atBoundary,
    justPastBoundary,
    scoredPostponed,
  };
}

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

describe("GET /api/admin/games/anomalies", () => {
  it("401s with no session cookie", async () => {
    const res = await getAnomalies(buildApp(), "");

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("403s for a signed-in non-admin caller", async () => {
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await getAnomalies(buildApp(), cookie);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "not_admin" });
  });

  it("lists exactly the games left unlocked while their outcome is knowable", async () => {
    const { app, cookie } = await adminCaller(buildApp());
    const seeded = await seedGames();

    const ids = await anomalousIds(app, cookie);

    // An ordinary locked final, an ordinary upcoming game, and an unscored
    // scheduled one are all consistent states — surfacing them would make the
    // card noise an operator learns to ignore.
    expect(new Set(ids)).toEqual(
      new Set([seeded.providerBug, seeded.justPastBoundary, seeded.scoredPostponed]),
    );
  });

  it("treats a game kicking off at exactly now as locked, not anomalous", async () => {
    const { app, cookie } = await adminCaller(buildApp());
    const seeded = await seedGames();

    const ids = await anomalousIds(app, cookie);

    // `isLocked` is `kickoff <= now`, so the predicate is strictly `>`. A `>=`
    // would agree on every other case in this file and disagree only here.
    expect(ids).not.toContain(seeded.atBoundary);
    expect(ids).toContain(seeded.justPastBoundary);
  });

  it("serves the row as an admin game, and clears once the kickoff is corrected into the past", async () => {
    const { app, cookie } = await adminCaller(buildApp());
    const seeded = await seedGames();

    const res = await getAnomalies(app, cookie);
    const body = (await res.json()) as AdminGamesResponse;
    const row = body.games.find((game) => game.id === seeded.providerBug);
    // The operator repairs from the row's values and follows its `weekId` to
    // the slate holding the game.
    expect(row).toMatchObject({
      kickoffAt: FUTURE.toISOString(),
      status: GAME_STATUS.FINAL,
      homeScore: 24,
      awayScore: 10,
    });
    expect(row?.weekId).toEqual(expect.any(String));

    // The repair path is the next sync or a hand SQL edit on the provider
    // column (ADR-0046) — either way the kickoff lands in the past.
    await setGame(db, seeded.providerBug, { kickoffAt: PAST });

    expect(await anomalousIds(app, cookie)).not.toContain(seeded.providerBug);
  });
});
