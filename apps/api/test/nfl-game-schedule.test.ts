import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { games } from "@picksleagues/db";
import { FixedClock } from "@picksleagues/core";
import {
  GAME_STATUS,
  WEEK_TYPE,
  type NflGameScheduleResponse,
  type WeekType,
} from "@picksleagues/schemas";
import { syncNflSchedule } from "../src/services/nfl/sync-schedule";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import { StatsFakeProvider } from "./setup/fake-provider";
import { providerGame, providerWeek } from "./setup/provider-fixtures";
import { resetDb } from "./setup/reset-db";
import { makeFixedAppHarness, withCookie } from "./setup/fixed-app";

const SEASON_YEAR = 2026;
const seedClock = new FixedClock(new Date("2026-09-01T00:00:00.000Z"));
const nowClock = new FixedClock(new Date("2026-09-22T00:00:00.000Z"));

function weekKey(weekType: WeekType, weekNumber: number): string {
  return `${weekType}:${weekNumber}`;
}

const provider = new StatsFakeProvider();
const { db, auth, appAt } = makeFixedAppHarness();
const app = appAt(nowClock.now(), { provider: async () => provider });

/**
 * Seeds three weeks: week 1 HOM 27–20 AWY (final), week 2 HOM 31–14 at OTH
 * (final), week 3 HOM vs AWY (scheduled — the game whose sheet is open).
 * Returns the week-3 game id.
 */
async function seedSeason() {
  provider.structure = {
    seasonYear: SEASON_YEAR,
    weeks: [
      providerWeek(1, "2026-09-08T00:00:00.000Z", "2026-09-15T00:00:00.000Z"),
      providerWeek(2, "2026-09-15T00:00:00.000Z", "2026-09-22T00:00:00.000Z"),
      providerWeek(3, "2026-09-22T00:00:00.000Z", "2026-09-29T00:00:00.000Z"),
    ],
  };
  provider.gamesByWeek = new Map([
    [
      weekKey(WEEK_TYPE.REGULAR, 1),
      [
        providerGame({
          providerGameId: "g1",
          weekNumber: 1,
          kickoffAt: new Date("2026-09-13T17:00:00.000Z"),
          status: GAME_STATUS.FINAL,
          homeScore: 27,
          awayScore: 20,
        }),
      ],
    ],
    [
      weekKey(WEEK_TYPE.REGULAR, 2),
      [
        providerGame({
          providerGameId: "g2",
          weekNumber: 2,
          kickoffAt: new Date("2026-09-20T17:00:00.000Z"),
          status: GAME_STATUS.FINAL,
          homeTeamAbbr: "OTH",
          homeTeamName: "Other Team",
          homeTeamProviderId: "oth-id",
          awayTeamAbbr: "HOM",
          awayTeamName: "Home Team",
          awayTeamProviderId: "hom-id",
          homeScore: 14,
          awayScore: 31,
        }),
      ],
    ],
    [
      weekKey(WEEK_TYPE.REGULAR, 3),
      [
        providerGame({
          providerGameId: "g3",
          weekNumber: 3,
          kickoffAt: new Date("2026-09-27T17:00:00.000Z"),
        }),
      ],
    ],
  ]);
  await syncNflSchedule(db, seedClock, provider, { seasonYear: SEASON_YEAR });
  const [game] = await db
    .select({ id: games.id })
    .from(games)
    .where(eq(games.providerGameId, "g3"));
  return game!.id;
}

async function getSchedule(gameId: string, cookie?: string) {
  return app.request(`/api/games/${gameId}/nfl-schedule`, {
    headers: withCookie(cookie),
  });
}

beforeEach(async () => {
  await resetDb(db);
  provider.structure = { seasonYear: SEASON_YEAR, weeks: [] };
  provider.gamesByWeek = new Map();
});

afterAll(async () => {
  await db.$client.end();
});

describe("GET /api/games/{gameId}/nfl-schedule", () => {
  it("401s with no session", async () => {
    const res = await getSchedule("00000000-0000-4000-8000-000000000000");
    expect(res.status).toBe(401);
  });

  it("404s for an unknown game", async () => {
    const { cookie } = await createAuthenticatedUser(auth);
    const res = await getSchedule("00000000-0000-4000-8000-000000000000", cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "game_not_found" });
  });

  it("serves both teams' available schedules in kickoff order, graded per side", async () => {
    const gameId = await seedSeason();
    const { cookie } = await createAuthenticatedUser(auth);
    const res = await getSchedule(gameId, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as NflGameScheduleResponse;
    expect(body.home).toMatchObject({
      seasonYear: SEASON_YEAR,
      entries: [
        { weekLabel: "Week 1", status: "final", result: "W" },
        { weekLabel: "Week 2", status: "final", result: "W" },
        { weekLabel: "Week 3", status: "scheduled", result: null },
      ],
    });
    // AWY shares the upcoming week-3 fixture and sees week 1 as a road loss.
    expect(body.away).toMatchObject({
      seasonYear: SEASON_YEAR,
      entries: [
        { weekLabel: "Week 1", status: "final", result: "L" },
        { weekLabel: "Week 3", status: "scheduled", result: null },
      ],
    });
    expect(body.updatedAt).not.toBeNull();
  });

  it("a corrected score flips the logged result", async () => {
    const gameId = await seedSeason();
    await db
      .update(games)
      .set({ homeScore: 17, awayScore: 20 })
      .where(eq(games.providerGameId, "g1"));
    const { cookie } = await createAuthenticatedUser(auth);
    const body = (await (await getSchedule(gameId, cookie)).json()) as NflGameScheduleResponse;
    const week1 = body.home!.entries.find((entry) => entry.weekLabel === "Week 1");
    expect(week1).toMatchObject({ teamScore: 17, opponentScore: 20, result: "L" });
    expect(body.away!.entries[0]).toMatchObject({ result: "W" });
  });

  it("keeps a cancelled fixture visible without a final result", async () => {
    const gameId = await seedSeason();
    await db
      .update(games)
      .set({ status: GAME_STATUS.CANCELLED })
      .where(eq(games.providerGameId, "g1"));
    const { cookie } = await createAuthenticatedUser(auth);
    const body = (await (await getSchedule(gameId, cookie)).json()) as NflGameScheduleResponse;
    expect(body.home!.entries[0]).toMatchObject({ status: "cancelled", result: null });
    expect(body.home!.entries.map((entry) => entry.weekLabel)).toEqual([
      "Week 1",
      "Week 2",
      "Week 3",
    ]);
    expect(body.away!.entries.map((entry) => entry.weekLabel)).toEqual(["Week 1", "Week 3"]);
  });

  it("serves the current season schedule before the first game starts (ADR-0040)", async () => {
    // Prior season: one final between the same two teams.
    provider.structure = {
      seasonYear: SEASON_YEAR - 1,
      weeks: [providerWeek(1, "2025-09-09T00:00:00.000Z", "2025-09-16T00:00:00.000Z")],
    };
    provider.gamesByWeek = new Map([
      [
        weekKey(WEEK_TYPE.REGULAR, 1),
        [
          providerGame({
            providerGameId: "p1",
            weekNumber: 1,
            kickoffAt: new Date("2025-09-14T17:00:00.000Z"),
            status: GAME_STATUS.FINAL,
            homeScore: 24,
            awayScore: 10,
          }),
        ],
      ],
    ]);
    await syncNflSchedule(db, seedClock, provider, { seasonYear: SEASON_YEAR - 1 });
    // Current season: one scheduled game, nothing started.
    provider.structure = {
      seasonYear: SEASON_YEAR,
      weeks: [providerWeek(1, "2026-09-08T00:00:00.000Z", "2026-09-15T00:00:00.000Z")],
    };
    provider.gamesByWeek = new Map([
      [
        weekKey(WEEK_TYPE.REGULAR, 1),
        [
          providerGame({
            providerGameId: "g1",
            weekNumber: 1,
            kickoffAt: new Date("2026-09-13T17:00:00.000Z"),
          }),
        ],
      ],
    ]);
    await syncNflSchedule(db, seedClock, provider, { seasonYear: SEASON_YEAR });
    const [game] = await db
      .select({ id: games.id })
      .from(games)
      .where(eq(games.providerGameId, "g1"));

    const { cookie } = await createAuthenticatedUser(auth);
    const body = (await (await getSchedule(game!.id, cookie)).json()) as NflGameScheduleResponse;
    expect(body.home).toMatchObject({
      seasonYear: SEASON_YEAR,
      entries: [{ status: "scheduled", result: null }],
    });
    expect(body.away).toMatchObject({
      seasonYear: SEASON_YEAR,
      entries: [{ status: "scheduled", result: null }],
    });
  });
});
