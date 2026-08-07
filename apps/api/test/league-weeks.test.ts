import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  SURVIVOR_PUSH_TIE_RESOLUTION,
  LEAGUE_MODE,
  MEMBER_ROLE,
  PICK_TYPE,
  PICKEM_SEASON_RANGE_PRESET,
  WEEK_TYPE,
  type LeagueWeeksResponse,
  type PickemSettings,
} from "@picksleagues/schemas";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import { DEFAULT_PICKEM_SETTINGS, insertLeague, seedSeason } from "./setup/league-helpers";
import { makeLeagueTestHarness, WEEK1_KICKOFF, withCookie } from "./setup/league-app";
import { resetDb } from "./setup/reset-db";

const { db, auth, app, appAfterKickoff } = makeLeagueTestHarness();

type App = typeof app;

function getWeeks(cookie: string | undefined, leagueId: string, on: App = app) {
  return on.request(`/api/leagues/${leagueId}/weeks`, { headers: withCookie(cookie) });
}

/** Three regular weeks whose windows bracket the harness clocks. */
const THREE_WEEKS = [
  {
    weekNumber: 1,
    startsAt: new Date("2026-09-08T00:00:00.000Z"),
    endsAt: new Date("2026-09-15T00:00:00.000Z"),
    kickoffs: [{ kickoffAt: WEEK1_KICKOFF }],
  },
  {
    weekNumber: 2,
    startsAt: new Date("2026-09-15T00:00:00.000Z"),
    endsAt: new Date("2026-09-22T00:00:00.000Z"),
    kickoffs: [{ kickoffAt: new Date("2026-09-20T17:00:00.000Z") }],
  },
  {
    weekNumber: 3,
    startsAt: new Date("2026-09-22T00:00:00.000Z"),
    endsAt: new Date("2026-09-29T00:00:00.000Z"),
    kickoffs: [],
  },
];

async function seedLeague(settings: PickemSettings = DEFAULT_PICKEM_SETTINGS) {
  const { seasonId, weekIds } = await seedSeason(db, { weeks: THREE_WEEKS });
  const member = await createAuthenticatedUser(auth);
  const league = await insertLeague(db, {
    seasonId,
    settings,
    members: [{ userId: member.user.id, role: MEMBER_ROLE.COMMISSIONER }],
  });
  return { league, member, weekIds };
}

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

describe("GET /api/leagues/:leagueId/weeks", () => {
  it("401s without a session", async () => {
    const { league } = await seedLeague();
    expect((await getWeeks(undefined, league.id)).status).toBe(401);
  });

  it("404s for a non-member — private leagues stay hidden", async () => {
    const { league } = await seedLeague();
    const outsider = await createAuthenticatedUser(auth);

    const response = await getWeeks(outsider.cookie, league.id);

    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBe("league_not_found");
  });

  it("returns the season's weeks in order with their game counts", async () => {
    const { league, member } = await seedLeague();

    const response = await getWeeks(member.cookie, league.id);
    const body = (await response.json()) as LeagueWeeksResponse;

    expect(response.status).toBe(200);
    expect(body.weeks.map((week) => week.weekNumber)).toEqual([1, 2, 3]);
    expect(body.weeks.map((week) => week.gameCount)).toEqual([1, 1, 0]);
    expect(body.weeks[0]?.weekType).toBe(WEEK_TYPE.REGULAR);
  });

  it("clips the list to the league's configured start and end week", async () => {
    const { league, member } = await seedLeague({
      ...DEFAULT_PICKEM_SETTINGS,
      startWeek: { type: WEEK_TYPE.REGULAR, number: 2 },
      endWeek: { type: WEEK_TYPE.REGULAR, number: 2 },
    });

    const body = (await (await getWeeks(member.cookie, league.id)).json()) as LeagueWeeksResponse;

    expect(body.weeks.map((week) => week.weekNumber)).toEqual([2]);
  });

  it("400s for a league that isn't Pick'em", async () => {
    const { seasonId } = await seedSeason(db, { weeks: THREE_WEEKS });
    const member = await createAuthenticatedUser(auth);
    const league = await insertLeague(db, {
      seasonId,
      mode: LEAGUE_MODE.SURVIVOR,
      settings: {
        startWeek: { type: WEEK_TYPE.REGULAR, number: 1 },
        endWeek: { type: WEEK_TYPE.REGULAR, number: 3 },
        pickType: PICK_TYPE.STRAIGHT_UP,
        pushTieResolution: SURVIVOR_PUSH_TIE_RESOLUTION.ADVANCE,
      },
      members: [{ userId: member.user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });

    const response = await getWeeks(member.cookie, league.id);

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("wrong_league_mode");
  });

  describe("currentWeekId", () => {
    it("is the next week to start when the clock is before the season", async () => {
      // The harness `app` clock sits at 2026-09-01, before week 1 opens.
      const { league, member } = await seedLeague();

      const body = (await (await getWeeks(member.cookie, league.id)).json()) as LeagueWeeksResponse;

      expect(body.currentWeekId).toBe(body.weeks[0]?.id);
    });

    it("is the week in progress when the clock falls inside its window", async () => {
      // `appAfterKickoff` sits just past week 1's kickoff, inside week 1.
      const { league, member } = await seedLeague();

      const body = (await (
        await getWeeks(member.cookie, league.id, appAfterKickoff)
      ).json()) as LeagueWeeksResponse;

      expect(body.currentWeekId).toBe(body.weeks[0]?.id);
    });

    it("is null for a league whose configured range has no ingested weeks", async () => {
      const { league, member } = await seedLeague({
        ...DEFAULT_PICKEM_SETTINGS,
        seasonRangePreset: PICKEM_SEASON_RANGE_PRESET.POSTSEASON,
        startWeek: { type: WEEK_TYPE.POSTSEASON, number: 1 },
        endWeek: { type: WEEK_TYPE.POSTSEASON, number: 4 },
      });

      const body = (await (await getWeeks(member.cookie, league.id)).json()) as LeagueWeeksResponse;

      expect(body.weeks).toEqual([]);
      expect(body.currentWeekId).toBeNull();
    });
  });
});
