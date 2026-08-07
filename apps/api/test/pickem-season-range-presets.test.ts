import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "@picksleagues/core";
import {
  ELIMINATION_PUSH_TIE_RESOLUTION,
  LEAGUE_MODE,
  MEMBER_ROLE,
  PICK_TYPE,
  PICKEM_SEASON_RANGE_PRESET,
  WEEK_TYPE,
  type LeagueResponse,
  type PickemSeasonRangePreset,
  type PickemSeasonRangePresetsResponse,
} from "@picksleagues/schemas";
import { createApp } from "../src/app";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import { insertLeague, seedSeason } from "./setup/league-helpers";
import { makeLeagueTestHarness, WEEK1_KICKOFF, withCookie } from "./setup/league-app";
import { resetDb } from "./setup/reset-db";

/**
 * LG-9 / ADR-0020: the create form and the pre-start settings editor both need
 * to know, from the server, which season-range presets a season can still
 * start — the same `resolvePickemSeasonRange` → `nflWeekFirstKickoffAt` →
 * `isPreStart` derivation `createLeague`/`updateLeague` run for the one preset
 * a request names, run here for all three. These assert the two endpoints
 * agree with what a create/update against the same clock would actually do,
 * never a re-derivation of the rule from scratch.
 */
const { db, auth, app, appAfterKickoff } = makeLeagueTestHarness();

const ALL_PRESETS: PickemSeasonRangePreset[] = Object.values(PICKEM_SEASON_RANGE_PRESET);

const WEEK2_KICKOFF = new Date(WEEK1_KICKOFF.getTime() + 7 * 24 * 60 * 60 * 1000);
const WILD_CARD_KICKOFF = new Date(WEEK1_KICKOFF.getTime() + 130 * 24 * 60 * 60 * 1000);
const SUPER_BOWL_KICKOFF = new Date(WEEK1_KICKOFF.getTime() + 151 * 24 * 60 * 60 * 1000);
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// Mid-regular-season: week 1 has kicked off, week 2 is still ahead.
const MID_REGULAR_NOW = new Date(WEEK1_KICKOFF.getTime() + 1);
// After the miniature season's last regular kickoff (week 2), before Wild Card.
const AFTER_REGULAR_NOW = new Date(WEEK2_KICKOFF.getTime() + 1);
// After the Super Bowl kickoff — nothing in any preset's range is still ahead.
const AFTER_SUPER_BOWL_NOW = new Date(SUPER_BOWL_KICKOFF.getTime() + 1);

function appAt(instant: Date) {
  return createApp({ auth, db, clock: async () => new FixedClock(instant) });
}

const mid = appAt(MID_REGULAR_NOW);
const afterRegular = appAt(AFTER_REGULAR_NOW);
const afterSuperBowl = appAt(AFTER_SUPER_BOWL_NOW);

type App = typeof app;

function getCreatePresets(cookie: string | undefined, on: App = app) {
  return on.request("/api/pickem/season-range-presets", { headers: withCookie(cookie) });
}

function getLeaguePresets(cookie: string | undefined, leagueId: string, on: App = app) {
  return on.request(`/api/leagues/${leagueId}/pickem/season-range-presets`, {
    headers: withCookie(cookie),
  });
}

function postLeague(cookie: string, settings: unknown, on: App = app) {
  return on.request("/api/leagues", {
    method: "POST",
    headers: { "content-type": "application/json", ...withCookie(cookie) },
    body: JSON.stringify({
      mode: "pickem",
      name: "Season Range Presets Test",
      visibility: "private",
      settings,
    }),
  });
}

function patchLeague(cookie: string, leagueId: string, settings: unknown, on: App = app) {
  return on.request(`/api/leagues/${leagueId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...withCookie(cookie) },
    body: JSON.stringify({ settings }),
  });
}

/** A full season's shape in miniature: two regular weeks and two playoff rounds, optionally shifted a whole year ahead so a second season can stay untouched by the first's clock scenarios. */
async function seedFullSeason(year: number, offsetMs = 0) {
  return seedSeason(db, {
    year,
    weeks: [
      { weekNumber: 1, kickoffs: [{ kickoffAt: new Date(WEEK1_KICKOFF.getTime() + offsetMs) }] },
      { weekNumber: 2, kickoffs: [{ kickoffAt: new Date(WEEK2_KICKOFF.getTime() + offsetMs) }] },
      {
        weekType: WEEK_TYPE.POSTSEASON,
        weekNumber: 1,
        kickoffs: [{ kickoffAt: new Date(WILD_CARD_KICKOFF.getTime() + offsetMs) }],
      },
      {
        weekType: WEEK_TYPE.POSTSEASON,
        weekNumber: 4,
        kickoffs: [{ kickoffAt: new Date(SUPER_BOWL_KICKOFF.getTime() + offsetMs) }],
      },
    ],
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Real ESPN calendar shape: each postseason round owns a week-long window
// opening a few days after the previous round's games.
const DIVISIONAL_WINDOW_OPENS = new Date(WILD_CARD_KICKOFF.getTime() + 3 * DAY_MS);
const DIVISIONAL_WINDOW_CLOSES = new Date(WILD_CARD_KICKOFF.getTime() + 10 * DAY_MS);
const CONFERENCE_WINDOW_CLOSES = new Date(WILD_CARD_KICKOFF.getTime() + 17 * DAY_MS);
const SUPER_BOWL_WINDOW_CLOSES = new Date(WILD_CARD_KICKOFF.getTime() + 31 * DAY_MS);

/**
 * The DATA-9 shape (ADR-0021): Wild Card is seeded and has kicked off, and ESPN
 * seeds each later round only once the previous one is decided — so Divisional,
 * Conference, and the Super Bowl exist in the ingested season structure with
 * their real windows and no games at all.
 */
async function seedPostseasonSeededThroughWildCard() {
  return seedSeason(db, {
    year: 2026,
    weeks: [
      { weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] },
      { weekNumber: 2, kickoffs: [{ kickoffAt: WEEK2_KICKOFF }] },
      {
        weekType: WEEK_TYPE.POSTSEASON,
        weekNumber: 1,
        kickoffs: [{ kickoffAt: WILD_CARD_KICKOFF }],
      },
      {
        weekType: WEEK_TYPE.POSTSEASON,
        weekNumber: 2,
        startsAt: DIVISIONAL_WINDOW_OPENS,
        endsAt: DIVISIONAL_WINDOW_CLOSES,
        kickoffs: [],
      },
      {
        weekType: WEEK_TYPE.POSTSEASON,
        weekNumber: 3,
        startsAt: DIVISIONAL_WINDOW_CLOSES,
        endsAt: CONFERENCE_WINDOW_CLOSES,
        kickoffs: [],
      },
      {
        weekType: WEEK_TYPE.POSTSEASON,
        weekNumber: 4,
        startsAt: CONFERENCE_WINDOW_CLOSES,
        endsAt: SUPER_BOWL_WINDOW_CLOSES,
        kickoffs: [],
      },
    ],
  });
}

/**
 * Inside the Divisional window but before ESPN has seeded it — Wild Card has
 * kicked off *and* the next round's own window has already opened, which is
 * precisely the instant a `starts_at` comparison would skip past.
 */
const UNSEEDED_DIVISIONAL_NOW = new Date(DIVISIONAL_WINDOW_OPENS.getTime() + 1);
const unseededDivisional = appAt(UNSEEDED_DIVISIONAL_NOW);
const afterEveryPostseasonWindow = appAt(new Date(SUPER_BOWL_WINDOW_CLOSES.getTime() + 1));

function sorted(presets: readonly PickemSeasonRangePreset[]): PickemSeasonRangePreset[] {
  return [...presets].sort();
}

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

describe("GET /api/pickem/season-range-presets — create form availability (AC2)", () => {
  it.each([
    {
      name: "pre-season",
      on: app,
      seed: () => seedFullSeason(2026),
      expected: { seasonYear: 2026, startablePresets: ALL_PRESETS },
    },
    {
      name: "mid-regular-season (week 1 kicked off, week 2 still ahead)",
      on: mid,
      seed: () => seedFullSeason(2026),
      expected: { seasonYear: 2026, startablePresets: ALL_PRESETS },
    },
    {
      name: "after the last regular kickoff, before Wild Card",
      on: afterRegular,
      seed: () => seedFullSeason(2026),
      expected: {
        seasonYear: 2026,
        startablePresets: [
          PICKEM_SEASON_RANGE_PRESET.POSTSEASON,
          PICKEM_SEASON_RANGE_PRESET.FULL_SEASON,
        ],
      },
    },
    {
      name: "after the Super Bowl kickoff",
      on: afterSuperBowl,
      seed: () => seedFullSeason(2026),
      expected: { seasonYear: 2026, startablePresets: [] },
    },
    {
      name: "provisional season whose weeks hold no games",
      on: app,
      seed: () =>
        seedSeason(db, {
          year: 2027,
          provisional: true,
          weeks: [
            { weekNumber: 1, kickoffs: [] },
            { weekType: WEEK_TYPE.POSTSEASON, weekNumber: 4, kickoffs: [] },
          ],
        }),
      expected: { seasonYear: 2027, startablePresets: ALL_PRESETS },
    },
    {
      name: "no ingested NFL season at all",
      on: app,
      seed: null,
      expected: { seasonYear: null, startablePresets: [] },
    },
    {
      name: "Wild Card kicked off and no later round seeded yet (ADR-0021)",
      on: unseededDivisional,
      seed: seedPostseasonSeededThroughWildCard,
      expected: {
        seasonYear: 2026,
        startablePresets: [
          PICKEM_SEASON_RANGE_PRESET.POSTSEASON,
          PICKEM_SEASON_RANGE_PRESET.FULL_SEASON,
        ],
      },
    },
    {
      name: "every postseason window closed with no round ever seeded",
      on: afterEveryPostseasonWindow,
      seed: seedPostseasonSeededThroughWildCard,
      expected: { seasonYear: 2026, startablePresets: [] },
    },
  ])("$name", async ({ on, seed, expected }) => {
    if (seed) await seed();
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await getCreatePresets(cookie, on);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PickemSeasonRangePresetsResponse;
    expect(body.seasonYear).toBe(expected.seasonYear);
    expect(sorted(body.startablePresets)).toEqual(sorted(expected.startablePresets));
  });

  it("401s without a session", async () => {
    const res = await getCreatePresets(undefined);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });
});

describe("Create endpoint availability agrees with POST /api/leagues (AC1)", () => {
  it("every reported preset succeeds and every non-reported preset is refused start_week_passed, at the same clock", async () => {
    await seedFullSeason(2026);
    const { cookie } = await createAuthenticatedUser(auth);

    const presetsRes = await getCreatePresets(cookie, afterRegular);
    expect(presetsRes.status).toBe(200);
    const { startablePresets } = (await presetsRes.json()) as PickemSeasonRangePresetsResponse;
    // Both branches of the agreement (an accepted preset and a refused one)
    // must actually be exercised, or the loop below would prove nothing.
    expect(startablePresets.length).toBeGreaterThan(0);
    expect(startablePresets.length).toBeLessThan(ALL_PRESETS.length);

    for (const preset of ALL_PRESETS) {
      const res = await postLeague(
        cookie,
        { seasonRangePreset: preset, pickType: "straight_up" },
        afterRegular,
      );
      if (startablePresets.includes(preset)) {
        expect(res.status).toBe(201);
      } else {
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ error: "start_week_passed" });
      }
    }
  });
});

describe("GET /api/leagues/:leagueId/pickem/season-range-presets — the league's own bound season (AC3)", () => {
  it("differs from the create endpoint once a newer season is ingested", async () => {
    await seedFullSeason(2026);
    const { cookie } = await createAuthenticatedUser(auth);
    const created = await postLeague(cookie, {
      seasonRangePreset: PICKEM_SEASON_RANGE_PRESET.REGULAR_SEASON,
      pickType: "straight_up",
    });
    expect(created.status).toBe(201);
    const { id: leagueId } = (await created.json()) as LeagueResponse;

    // A later season, ingested after the league already bound to the first —
    // shifted a whole year ahead so it stays fully untouched by the clock
    // scenario below (ADR-0009: a league can sit on a non-latest instance).
    await seedFullSeason(2027, ONE_YEAR_MS);

    const leagueRes = await getLeaguePresets(cookie, leagueId, afterRegular);
    expect(leagueRes.status).toBe(200);
    const leagueBody = (await leagueRes.json()) as PickemSeasonRangePresetsResponse;
    expect(leagueBody.seasonYear).toBe(2026);
    expect(sorted(leagueBody.startablePresets)).toEqual(
      sorted([PICKEM_SEASON_RANGE_PRESET.POSTSEASON, PICKEM_SEASON_RANGE_PRESET.FULL_SEASON]),
    );

    const createRes = await getCreatePresets(cookie, afterRegular);
    expect(createRes.status).toBe(200);
    const createBody = (await createRes.json()) as PickemSeasonRangePresetsResponse;
    expect(createBody.seasonYear).toBe(2027);
    expect(sorted(createBody.startablePresets)).toEqual(sorted(ALL_PRESETS));
  });
});

describe("League-scoped endpoint agrees with PATCH /api/leagues/:leagueId (AC4)", () => {
  it("a reported preset PATCHes successfully; a non-reported preset is refused start_week_passed", async () => {
    await seedFullSeason(2026);
    const { cookie } = await createAuthenticatedUser(auth);
    // Created on Postseason, whose stored start (Wild Card) is still ahead of
    // the PATCH loop's clock below — `updateLeague` gates on the OLD stored
    // start before it even resolves the new preset, so starting from a preset
    // already past by that clock (e.g. Regular Season) would refuse every
    // attempt `league_started` before the agreement under test ever ran.
    const created = await postLeague(cookie, {
      seasonRangePreset: PICKEM_SEASON_RANGE_PRESET.POSTSEASON,
      pickType: "straight_up",
    });
    expect(created.status).toBe(201);
    const { id: leagueId } = (await created.json()) as LeagueResponse;

    const presetsRes = await getLeaguePresets(cookie, leagueId, afterRegular);
    expect(presetsRes.status).toBe(200);
    const { startablePresets } = (await presetsRes.json()) as PickemSeasonRangePresetsResponse;
    expect(startablePresets.length).toBeGreaterThan(0);
    expect(startablePresets.length).toBeLessThan(ALL_PRESETS.length);

    for (const preset of ALL_PRESETS) {
      const res = await patchLeague(
        cookie,
        leagueId,
        { seasonRangePreset: preset, pickType: "straight_up" },
        afterRegular,
      );
      if (startablePresets.includes(preset)) {
        expect(res.status).toBe(200);
      } else {
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ error: "start_week_passed" });
      }
    }
  });

  it("the stored preset of a pre-start league is always in the reported set — the invariant the editor's UX rests on", async () => {
    await seedFullSeason(2026);
    const { cookie } = await createAuthenticatedUser(auth);
    // Created after week 1 has kicked off, so the mid-week rule advances the
    // stored Regular Season start to week 2 — the case that would break the
    // invariant if resolution and availability ever disagreed.
    const created = await postLeague(
      cookie,
      { seasonRangePreset: PICKEM_SEASON_RANGE_PRESET.REGULAR_SEASON, pickType: "straight_up" },
      appAfterKickoff,
    );
    expect(created.status).toBe(201);
    const { id: leagueId } = (await created.json()) as LeagueResponse;

    const res = await getLeaguePresets(cookie, leagueId, appAfterKickoff);
    expect(res.status).toBe(200);
    const { startablePresets } = (await res.json()) as PickemSeasonRangePresetsResponse;
    expect(startablePresets).toContain(PICKEM_SEASON_RANGE_PRESET.REGULAR_SEASON);
  });
});

describe("League-scoped endpoint gating (AC5)", () => {
  it("401s without a session", async () => {
    const res = await getLeaguePresets(undefined, randomUUID());
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("404s a non-member and an unknown league — private leagues stay hidden either way", async () => {
    await seedFullSeason(2026);
    const { cookie } = await createAuthenticatedUser(auth);
    const created = await postLeague(cookie, {
      seasonRangePreset: PICKEM_SEASON_RANGE_PRESET.REGULAR_SEASON,
      pickType: "straight_up",
    });
    expect(created.status).toBe(201);
    const { id: leagueId } = (await created.json()) as LeagueResponse;

    const outsider = await createAuthenticatedUser(auth, { username: "outsider" });
    const nonMember = await getLeaguePresets(outsider.cookie, leagueId);
    expect(nonMember.status).toBe(404);
    expect(await nonMember.json()).toMatchObject({ error: "league_not_found" });

    const unknownLeague = await getLeaguePresets(cookie, randomUUID());
    expect(unknownLeague.status).toBe(404);
    expect(await unknownLeague.json()).toMatchObject({ error: "league_not_found" });
  });

  it("403s a member who isn't a commissioner — same gate the pick-summary read uses", async () => {
    const { seasonId } = await seedFullSeason(2026);
    const commissioner = await createAuthenticatedUser(auth, { username: "commish" });
    const member = await createAuthenticatedUser(auth, { username: "member" });
    const league = await insertLeague(db, {
      seasonId,
      members: [
        { userId: commissioner.user.id, role: MEMBER_ROLE.COMMISSIONER },
        { userId: member.user.id, role: MEMBER_ROLE.MEMBER },
      ],
    });

    const res = await getLeaguePresets(member.cookie, league.id);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "not_commissioner" });
  });

  it("400s wrong_league_mode for a non-Pick'em league", async () => {
    const { seasonId } = await seedFullSeason(2026);
    const commissioner = await createAuthenticatedUser(auth, { username: "elim_commish" });
    const league = await insertLeague(db, {
      seasonId,
      mode: LEAGUE_MODE.ELIMINATION,
      settings: {
        startWeek: { type: WEEK_TYPE.REGULAR, number: 1 },
        endWeek: { type: WEEK_TYPE.REGULAR, number: 18 },
        pickType: PICK_TYPE.STRAIGHT_UP,
        pushTieResolution: ELIMINATION_PUSH_TIE_RESOLUTION.ADVANCE,
      },
      members: [{ userId: commissioner.user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });

    const res = await getLeaguePresets(commissioner.cookie, league.id);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "wrong_league_mode" });
  });
});
