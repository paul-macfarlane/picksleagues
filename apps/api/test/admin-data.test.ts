import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, games, oddsSnapshots, sportSeasons, teams, weeks } from "@picksleagues/db";
import {
  FixedClock,
  type GameDataProvider,
  type ProviderGame,
  type ProviderSeasonStructure,
  type ProviderTeam,
} from "@picksleagues/core";
import {
  GAME_STATUS,
  SPORT,
  WEEK_TYPE,
  type AdminGameOddsResponse,
  type AdminGamesResponse,
  type AdminSeasonsResponse,
  type AdminTeamsResponse,
} from "@picksleagues/schemas";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import { resetDb } from "./setup/reset-db";
import { getTestDatabaseUrl } from "./setup/test-database-url";
import { makeTestEnv } from "./setup/test-env";

// The browsers are pure reads — nothing here consults the clock, so a fixed
// instant only exists to satisfy createApp's dep.
const FIXED_NOW = new Date("2026-09-12T00:00:00.000Z");
const SEEDED_AT = new Date("2026-09-01T00:00:00.000Z");

/** Never called — no route under test touches the provider. */
class FakeProvider implements GameDataProvider {
  async fetchNflSeasonStructure(): Promise<ProviderSeasonStructure> {
    return { seasonYear: 2026, weeks: [] };
  }
  async fetchNflWeekGames(): Promise<ProviderGame[]> {
    return [];
  }
  async fetchNflTeams(): Promise<ProviderTeam[]> {
    return [];
  }
}

const db = createDb(getTestDatabaseUrl());
const auth = createAuth({ env: makeTestEnv(), db });

function buildApp(adminUserIds: string[] = []) {
  const env = makeTestEnv({ ADMIN_USER_IDS: adminUserIds });
  return createApp({
    auth,
    db,
    env,
    clock: async () => new FixedClock(FIXED_NOW),
    provider: async () => new FakeProvider(),
  });
}

function get(app: ReturnType<typeof buildApp>, path: string, cookie?: string) {
  return app.request(path, { headers: { ...(cookie ? { cookie } : {}) } });
}

/** Signs in a user, seeds them into the admin role, and returns an admin-ready app. */
async function adminCaller() {
  const { user, cookie } = await createAuthenticatedUser(auth);
  return { app: buildApp([user.id]), cookie, userId: user.id };
}

/**
 * One NFL season with an overridden game, plus a second season and an NCAAMB
 * row so sport filtering and season ordering are observable. `overriddenBy`
 * comes from the caller because the FK points at a real user row.
 *
 * The override is deliberately shaped so provider order and resolved order
 * DISAGREE: game B kicks off first per the provider but last once its
 * `override_kickoff_at` applies.
 */
async function seed(overriddenBy: string) {
  const [season2026] = await db
    .insert(sportSeasons)
    .values({
      sport: SPORT.NFL,
      year: 2026,
      provisional: false,
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    })
    .returning();
  const [season2025] = await db
    .insert(sportSeasons)
    .values({
      sport: SPORT.NFL,
      year: 2025,
      provisional: true,
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    })
    .returning();
  if (!season2026 || !season2025) throw new Error("season insert returned no row");
  await db.insert(sportSeasons).values({
    sport: SPORT.NCAAMB,
    year: 2027,
    provisional: false,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
  });

  const [week1, week2] = await db
    .insert(weeks)
    .values([
      {
        seasonId: season2026.id,
        weekType: WEEK_TYPE.REGULAR,
        weekNumber: 1,
        label: "Week 1",
        startsAt: new Date("2026-09-08T00:00:00.000Z"),
        endsAt: new Date("2026-09-15T00:00:00.000Z"),
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      },
      {
        seasonId: season2026.id,
        weekType: WEEK_TYPE.REGULAR,
        weekNumber: 2,
        label: "Week 2",
        startsAt: new Date("2026-09-15T00:00:00.000Z"),
        endsAt: new Date("2026-09-22T00:00:00.000Z"),
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      },
    ])
    .returning();
  if (!week1 || !week2) throw new Error("week insert returned no row");

  const [buf, mia, ne, nyj] = await db
    .insert(teams)
    .values([
      {
        sport: SPORT.NFL,
        providerTeamId: "2",
        abbreviation: "BUF",
        name: "Bills",
        location: "Buffalo",
        logoLightUrl: "https://example.test/buf.png",
        logoDarkUrl: null,
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      },
      {
        sport: SPORT.NFL,
        providerTeamId: "15",
        abbreviation: "MIA",
        name: "Dolphins",
        location: "Miami",
        logoLightUrl: null,
        logoDarkUrl: null,
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      },
      // Bootstrap row: no provider id yet, no enriched metadata — the exact
      // state an operator browses this list to spot.
      {
        sport: SPORT.NFL,
        providerTeamId: null,
        abbreviation: "NE",
        name: "Patriots",
        location: null,
        logoLightUrl: null,
        logoDarkUrl: null,
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      },
      {
        sport: SPORT.NFL,
        providerTeamId: "20",
        abbreviation: "NYJ",
        name: "Jets",
        location: "New York",
        logoLightUrl: null,
        logoDarkUrl: null,
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      },
      {
        sport: SPORT.NCAAMB,
        providerTeamId: "150",
        abbreviation: "DUKE",
        name: "Blue Devils",
        location: "Durham",
        logoLightUrl: null,
        logoDarkUrl: null,
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      },
    ])
    .returning();
  if (!buf || !mia || !ne || !nyj) throw new Error("team insert returned no row");

  const [gameA, gameB] = await db
    .insert(games)
    .values([
      {
        weekId: week1.id,
        providerGameId: "evt-a",
        homeTeamId: buf.id,
        awayTeamId: nyj.id,
        kickoffAt: new Date("2026-09-14T20:00:00.000Z"),
        status: GAME_STATUS.SCHEDULED,
        homeScore: null,
        awayScore: null,
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      },
      {
        weekId: week1.id,
        providerGameId: "evt-b",
        homeTeamId: ne.id,
        awayTeamId: mia.id,
        kickoffAt: new Date("2026-09-13T17:00:00.000Z"),
        status: GAME_STATUS.IN_PROGRESS,
        homeScore: 21,
        awayScore: 21,
        overrideKickoffAt: new Date("2026-09-14T23:00:00.000Z"),
        overrideStatus: GAME_STATUS.FINAL,
        overrideHomeScore: 24,
        overrideAwayScore: 21,
        overrideSpread: 7.5,
        overriddenBy,
        overriddenAt: new Date("2026-09-14T23:30:00.000Z"),
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      },
    ])
    .returning();
  if (!gameA || !gameB) throw new Error("game insert returned no row");

  // Two snapshots on A (the later one is what "current spread" means) and none
  // on B, whose spread therefore comes entirely from its override.
  await db.insert(oddsSnapshots).values([
    {
      gameId: gameA.id,
      spread: -3.5,
      capturedAt: new Date("2026-09-10T12:00:00.000Z"),
      createdAt: SEEDED_AT,
    },
    {
      gameId: gameA.id,
      spread: -2.5,
      capturedAt: new Date("2026-09-12T12:00:00.000Z"),
      createdAt: SEEDED_AT,
    },
  ]);

  return { season2026, season2025, week1, week2, gameA, gameB };
}

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

describe("admin reference-data browsers", () => {
  const paths = [
    "/api/admin/teams?sport=nfl",
    "/api/admin/seasons?sport=nfl",
    "/api/admin/games?weekId=00000000-0000-4000-8000-000000000000",
    "/api/admin/games/00000000-0000-4000-8000-000000000000/odds",
  ];

  it.each(paths)("401s with no session cookie: %s", async (path) => {
    const res = await get(buildApp(), path);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });

  it.each(paths)("403s for a signed-in non-admin caller: %s", async (path) => {
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await get(buildApp(), path, cookie);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "not_admin" });
  });
});

describe("GET /api/admin/teams", () => {
  it("400s without the required sport param", async () => {
    const { app, cookie } = await adminCaller();

    const res = await get(app, "/api/admin/teams", cookie);

    expect(res.status).toBe(400);
  });

  it("returns one sport's teams by abbreviation, preserving unlinked rows", async () => {
    const { app, cookie, userId } = await adminCaller();
    await seed(userId);

    const res = await get(app, "/api/admin/teams?sport=nfl", cookie);

    expect(res.status).toBe(200);
    const { teams: rows } = (await res.json()) as AdminTeamsResponse;
    expect(rows.map((team) => team.abbreviation)).toEqual(["BUF", "MIA", "NE", "NYJ"]);
    expect(rows[0]).toMatchObject({
      sport: "nfl",
      providerTeamId: "2",
      name: "Bills",
      location: "Buffalo",
      logoLightUrl: "https://example.test/buf.png",
      logoDarkUrl: null,
    });
    expect(rows[2]).toMatchObject({ abbreviation: "NE", providerTeamId: null, location: null });
  });
});

describe("GET /api/admin/seasons", () => {
  it("returns seasons newest-first with chronological weeks and game counts", async () => {
    const { app, cookie, userId } = await adminCaller();
    await seed(userId);

    const res = await get(app, "/api/admin/seasons?sport=nfl", cookie);

    expect(res.status).toBe(200);
    const { seasons } = (await res.json()) as AdminSeasonsResponse;
    expect(seasons.map((season) => season.year)).toEqual([2026, 2025]);
    const [current, previous] = seasons;
    expect(current).toMatchObject({ sport: "nfl", provisional: false });
    expect(previous).toMatchObject({ year: 2025, provisional: true, weeks: [] });

    expect(current?.weeks.map((week) => week.label)).toEqual(["Week 1", "Week 2"]);
    expect(current?.weeks[0]).toMatchObject({
      weekType: "regular",
      weekNumber: 1,
      startsAt: "2026-09-08T00:00:00.000Z",
      endsAt: "2026-09-15T00:00:00.000Z",
      gameCount: 2,
    });
    // The sync-failure signal the browser exists for: a synced week with no games.
    expect(current?.weeks[1]?.gameCount).toBe(0);
  });
});

describe("GET /api/admin/games", () => {
  it("400s on a non-uuid week id", async () => {
    const { app, cookie } = await adminCaller();

    const res = await get(app, "/api/admin/games?weekId=not-a-uuid", cookie);

    expect(res.status).toBe(400);
  });

  it("returns [] for a week with no games", async () => {
    const { app, cookie, userId } = await adminCaller();
    const seeded = await seed(userId);

    const res = await get(app, `/api/admin/games?weekId=${seeded.week2.id}`, cookie);

    expect(res.status).toBe(200);
    expect((await res.json()) as AdminGamesResponse).toEqual({ games: [] });
  });

  it("orders by resolved kickoff, not the provider's", async () => {
    const { app, cookie, userId } = await adminCaller();
    const seeded = await seed(userId);

    const res = await get(app, `/api/admin/games?weekId=${seeded.week1.id}`, cookie);

    const { games: rows } = (await res.json()) as AdminGamesResponse;
    // Provider kickoffs would order these B, A — the override flips it.
    expect(rows.map((game) => game.providerGameId)).toEqual(["evt-a", "evt-b"]);
  });

  it("serializes provider fields untouched alongside the override-resolved ones", async () => {
    const { app, cookie, userId } = await adminCaller();
    const seeded = await seed(userId);

    const res = await get(app, `/api/admin/games?weekId=${seeded.week1.id}`, cookie);

    const { games: rows } = (await res.json()) as AdminGamesResponse;
    const overridden = rows.find((game) => game.providerGameId === "evt-b");
    expect(overridden).toMatchObject({
      // Provider block survives the correction verbatim (arch D15).
      kickoffAt: "2026-09-13T17:00:00.000Z",
      status: "in_progress",
      homeScore: 21,
      awayScore: 21,
      // Override block as stored.
      overrideKickoffAt: "2026-09-14T23:00:00.000Z",
      overrideStatus: "final",
      overrideHomeScore: 24,
      overrideAwayScore: 21,
      overrideSpread: 7.5,
      overriddenBy: userId,
      overriddenAt: "2026-09-14T23:30:00.000Z",
      // Resolved = override ?? provider.
      effectiveKickoffAt: "2026-09-14T23:00:00.000Z",
      effectiveStatus: "final",
      effectiveHomeScore: 24,
      effectiveAwayScore: 21,
      effectiveSpread: 7.5,
      // No snapshot exists — the effective spread came from the override alone.
      latestSpread: null,
      latestSpreadCapturedAt: null,
      homeTeam: { abbreviation: "NE", name: "Patriots" },
      awayTeam: { abbreviation: "MIA", name: "Dolphins" },
    });
  });

  it("falls back to provider values and the latest snapshot when nothing is overridden", async () => {
    const { app, cookie, userId } = await adminCaller();
    const seeded = await seed(userId);

    const res = await get(app, `/api/admin/games?weekId=${seeded.week1.id}`, cookie);

    const { games: rows } = (await res.json()) as AdminGamesResponse;
    const clean = rows.find((game) => game.providerGameId === "evt-a");
    expect(clean).toMatchObject({
      overrideKickoffAt: null,
      overrideStatus: null,
      overrideHomeScore: null,
      overrideAwayScore: null,
      overrideSpread: null,
      overriddenBy: null,
      overriddenAt: null,
      effectiveKickoffAt: "2026-09-14T20:00:00.000Z",
      effectiveStatus: "scheduled",
      effectiveHomeScore: null,
      effectiveAwayScore: null,
      // Newest snapshot wins, and with no override it is also the effective spread.
      latestSpread: -2.5,
      latestSpreadCapturedAt: "2026-09-12T12:00:00.000Z",
      effectiveSpread: -2.5,
      homeTeam: { abbreviation: "BUF", name: "Bills" },
      awayTeam: { abbreviation: "NYJ", name: "Jets" },
    });
  });
});

describe("GET /api/admin/games/{gameId}/odds", () => {
  it("404s for an unknown game", async () => {
    const { app, cookie } = await adminCaller();

    const res = await get(
      app,
      "/api/admin/games/00000000-0000-4000-8000-000000000000/odds",
      cookie,
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "game_not_found" });
  });

  it("returns snapshots newest-first", async () => {
    const { app, cookie, userId } = await adminCaller();
    const seeded = await seed(userId);

    const res = await get(app, `/api/admin/games/${seeded.gameA.id}/odds`, cookie);

    expect(res.status).toBe(200);
    const { snapshots } = (await res.json()) as AdminGameOddsResponse;
    expect(snapshots.map((snapshot) => snapshot.spread)).toEqual([-2.5, -3.5]);
    expect(snapshots[0]?.capturedAt).toBe("2026-09-12T12:00:00.000Z");
  });

  it("distinguishes a game with no snapshots from a missing game", async () => {
    const { app, cookie, userId } = await adminCaller();
    const seeded = await seed(userId);

    const res = await get(app, `/api/admin/games/${seeded.gameB.id}/odds`, cookie);

    expect(res.status).toBe(200);
    expect((await res.json()) as AdminGameOddsResponse).toEqual({ snapshots: [] });
  });
});

describe("snapshots captured at the same instant", () => {
  /**
   * A sync run stamps every row it inserts with one `clock.now()`, so equal
   * `captured_at` values are ordinary — and under the simulator's fixed clock
   * they are the norm. Both snapshot reads must still be deterministic.
   */
  async function seedTiedSnapshots(userId: string) {
    const seeded = await seed(userId);
    const tiedAt = new Date("2026-09-13T12:00:00.000Z");
    const rows = await db
      .insert(oddsSnapshots)
      .values([
        { gameId: seeded.gameA.id, spread: 1.5, capturedAt: tiedAt, createdAt: SEEDED_AT },
        { gameId: seeded.gameA.id, spread: 2.5, capturedAt: tiedAt, createdAt: SEEDED_AT },
      ])
      .returning();
    const winner = [...rows].sort((a, b) => (a.id < b.id ? 1 : -1))[0];
    if (!winner) throw new Error("snapshot insert returned no row");
    return { seeded, winner };
  }

  it("resolves the latest spread deterministically", async () => {
    const { app, cookie, userId } = await adminCaller();
    const { seeded, winner } = await seedTiedSnapshots(userId);

    const res = await get(app, `/api/admin/games?weekId=${seeded.week1.id}`, cookie);

    const { games: rows } = (await res.json()) as AdminGamesResponse;
    const gameA = rows.find((game) => game.providerGameId === "evt-a");
    expect(gameA?.latestSpread).toBe(winner.spread);
    expect(gameA?.effectiveSpread).toBe(winner.spread);
  });

  it("orders the snapshot history deterministically", async () => {
    const { app, cookie, userId } = await adminCaller();
    const { seeded, winner } = await seedTiedSnapshots(userId);

    const res = await get(app, `/api/admin/games/${seeded.gameA.id}/odds`, cookie);

    const { snapshots } = (await res.json()) as AdminGameOddsResponse;
    expect(snapshots[0]?.id).toBe(winner.id);
  });
});
