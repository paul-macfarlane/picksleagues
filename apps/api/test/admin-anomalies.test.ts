import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "@picksleagues/core";
import { GAME_STATUS, type AdminGamesResponse } from "@picksleagues/schemas";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import { seedSeason, setGame } from "./setup/league-helpers";
import { resetDb } from "./setup/reset-db";
import { makeFixedAppHarness } from "./setup/fixed-app";

/**
 * Detection of `unlocked ∧ outcome-knowable` games (ADM-3) — the state the
 * override guard refuses to *create* (`services/admin-overrides.ts`) but cannot
 * prevent, because two routes reach it with no admin at fault: a provider bug,
 * and a legitimately allowed later-kickoff override followed by score ingestion
 * writing the final against the **provider** kickoff. Ingestion must never fail
 * on account of a correction, so it cannot consult the guard.
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

function setOverride(app: App, cookie: string, gameId: string, body: Record<string, unknown>) {
  return app.request(`/api/admin/games/${gameId}/override`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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
    overrideKnowable,
  ] = ids as [string, string, string, string, string, string, string];

  // A provider bug: it reports a final score on a game whose kickoff it still
  // places in the future. No admin has touched this row.
  await setGame(db, providerBug, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 });
  await setGame(db, lockedFinal, { status: GAME_STATUS.FINAL, homeScore: 17, awayScore: 13 });
  await setGame(db, atBoundary, { status: GAME_STATUS.FINAL, homeScore: 21, awayScore: 20 });
  await setGame(db, justPastBoundary, { status: GAME_STATUS.FINAL, homeScore: 21, awayScore: 20 });
  // The mirror of the provider bug, on the override side of the coalesce: only
  // reachable by seeding, since the guard refuses to create it through the API,
  // and pinned so the query can never be "fixed" into reading provider columns.
  await setGame(db, overrideKnowable, {
    overrideStatus: GAME_STATUS.FINAL,
    overrideHomeScore: 31,
    overrideAwayScore: 28,
  });

  return {
    scheduledPast,
    providerBug,
    lockedFinal,
    upcoming,
    atBoundary,
    justPastBoundary,
    overrideKnowable,
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
      new Set([seeded.providerBug, seeded.justPastBoundary, seeded.overrideKnowable]),
    );
  });

  it("treats a game kicking off at exactly now as locked, not anomalous", async () => {
    const { app, cookie } = await adminCaller(buildApp());
    const seeded = await seedGames();

    const ids = await anomalousIds(app, cookie);

    // `isLocked` is `kickoff <= now`, so the predicate is strictly `>`. A `>=`
    // would agree with the guard on every other case in this file and disagree
    // only here.
    expect(ids).not.toContain(seeded.atBoundary);
    expect(ids).toContain(seeded.justPastBoundary);
  });

  it("surfaces what a later-kickoff override and score ingestion produce between them", async () => {
    const { app, cookie } = await adminCaller(buildApp());
    const seeded = await seedGames();

    // Allowed, and correctly so: at this moment the game is scheduled and
    // unscored, so nothing about its outcome is knowable.
    const moved = await setOverride(app, cookie, seeded.scheduledPast, {
      kickoffAt: FUTURE.toISOString(),
    });
    expect(moved.status).toBe(200);
    expect(await anomalousIds(app, cookie)).not.toContain(seeded.scheduledPast);

    // What `sync-scores` then does: provider columns only, gated on the
    // provider kickoff, with no knowledge of the correction.
    await setGame(db, seeded.scheduledPast, {
      status: GAME_STATUS.FINAL,
      homeScore: 27,
      awayScore: 20,
    });

    const res = await getAnomalies(app, cookie);
    const body = (await res.json()) as AdminGamesResponse;
    const row = body.games.find((game) => game.id === seeded.scheduledPast);
    // The row is an admin game: the operator repairs from its resolved values
    // and follows its `weekId` to the slate holding the override editor.
    expect(row).toMatchObject({
      effectiveKickoffAt: FUTURE.toISOString(),
      effectiveStatus: GAME_STATUS.FINAL,
      effectiveHomeScore: 27,
      effectiveAwayScore: 20,
    });
    expect(row?.weekId).toEqual(expect.any(String));
  });

  it("clears once the kickoff is moved back into the past, and stays editable until it is", async () => {
    const { app, cookie } = await adminCaller(buildApp());
    const seeded = await seedGames();

    // The guard's carve-out is what makes the games browser the repair path: an
    // edit that leaves an already-violating row violating is still accepted,
    // rather than the form refusing every save on a broken game.
    const correction = await setOverride(app, cookie, seeded.providerBug, { homeScore: 28 });
    expect(correction.status).toBe(200);
    expect(await anomalousIds(app, cookie)).toContain(seeded.providerBug);

    const repair = await setOverride(app, cookie, seeded.providerBug, {
      kickoffAt: PAST.toISOString(),
    });

    expect(repair.status).toBe(200);
    expect(await anomalousIds(app, cookie)).not.toContain(seeded.providerBug);
  });
});
