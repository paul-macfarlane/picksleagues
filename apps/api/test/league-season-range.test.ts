import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "@picksleagues/core";
import { leagueSeasons } from "@picksleagues/db";
import {
  PickemSettingsSchema,
  SurvivorSettingsSchema,
  WEEK_TYPE,
  type LeagueResponse,
  type PickemSettings,
  type SurvivorSettings,
} from "@picksleagues/schemas";
import { createApp } from "../src/app";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import { seedSeason } from "./setup/league-helpers";
import {
  makeLeagueTestHarness,
  POST_START_NOW,
  PRE_START_NOW,
  WEEK1_KICKOFF,
  withCookie,
} from "./setup/league-app";
import { resetDb } from "./setup/reset-db";

/**
 * Both NFL modes' requests name no range at all (ADR-0024, ADR-0031): the
 * server resolves the mode's one legal range — the regular season — against
 * the bound season and the injected clock, once, when settings are written.
 * These assert the *stored* range — the fact every downstream derivation
 * reads — rather than what the request asked for.
 */
const { db, auth, app, appAfterKickoff } = makeLeagueTestHarness();

const WEEK2_KICKOFF = new Date(WEEK1_KICKOFF.getTime() + 7 * 24 * 60 * 60 * 1000);
const WILD_CARD_KICKOFF = new Date(WEEK1_KICKOFF.getTime() + 130 * 24 * 60 * 60 * 1000);
const SUPER_BOWL_KICKOFF = new Date(WEEK1_KICKOFF.getTime() + 151 * 24 * 60 * 60 * 1000);

const regular = (number: number) => ({ type: WEEK_TYPE.REGULAR, number });
const postseason = (number: number) => ({ type: WEEK_TYPE.POSTSEASON, number });

type App = typeof app;

function postLeague(cookie: string, settings: unknown, on: App = app) {
  return on.request("/api/leagues", {
    method: "POST",
    headers: { "content-type": "application/json", ...withCookie(cookie) },
    body: JSON.stringify({
      mode: "pickem",
      name: "Range Test",
      visibility: "private",
      settings,
    }),
  });
}

function postSurvivorLeague(cookie: string, settings: unknown, on: App = app) {
  return on.request("/api/leagues", {
    method: "POST",
    headers: { "content-type": "application/json", ...withCookie(cookie) },
    body: JSON.stringify({
      mode: "survivor",
      name: "Survivor Range Test",
      // Public so the join cutoff can be exercised without minting an invite —
      // "never born already started" is only observable as someone joining.
      visibility: "public",
      settings,
    }),
  });
}

function joinLeague(cookie: string, leagueId: string, on: App = app) {
  return on.request(`/api/leagues/${leagueId}/join`, {
    method: "POST",
    headers: withCookie(cookie),
  });
}

function patchLeague(cookie: string, leagueId: string, settings: unknown, on: App = app) {
  return on.request(`/api/leagues/${leagueId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...withCookie(cookie) },
    body: JSON.stringify({ settings }),
  });
}

/**
 * Reads the row back through the stored schema — which also pins that a write
 * path can never leave an unresolved shape in the JSONB, since the stored
 * schema requires the week refs the wire shape doesn't carry.
 */
async function storedSettingsBlob(leagueId: string): Promise<unknown> {
  const [row] = await db.select().from(leagueSeasons).where(eq(leagueSeasons.leagueId, leagueId));
  if (!row) throw new Error(`no league_seasons row for league ${leagueId}`);
  return row.settings;
}

async function storedSettings(leagueId: string): Promise<PickemSettings> {
  return PickemSettingsSchema.parse(await storedSettingsBlob(leagueId));
}

async function storedSurvivorSettings(leagueId: string): Promise<SurvivorSettings> {
  return SurvivorSettingsSchema.parse(await storedSettingsBlob(leagueId));
}

/** A full season's shape in miniature: two regular weeks and two playoff rounds. */
async function seedFullSeason() {
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
        weekNumber: 4,
        kickoffs: [{ kickoffAt: SUPER_BOWL_KICKOFF }],
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
 * kicked off *and* the next round's own window has already opened. That second
 * fact is the point: this is precisely the instant a `starts_at` comparison
 * would call Divisional "underway" and skip past it.
 */
const UNSEEDED_DIVISIONAL_NOW = new Date(DIVISIONAL_WINDOW_OPENS.getTime() + 1);

function appAt(instant: Date) {
  return createApp({ auth, db, clock: async () => new FixedClock(instant) });
}

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

describe("POST /api/leagues — Pick'em's range is resolved, never chosen", () => {
  it("stores the regular season while every week is still ahead", async () => {
    await seedFullSeason();
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postLeague(cookie, { pickType: "straight_up" });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as LeagueResponse;

    expect(await storedSettings(id)).toMatchObject({
      startWeek: regular(1),
      endWeek: regular(18),
    });
  });

  it("is never born already started — the resolved start is still ahead of the clock", async () => {
    await seedFullSeason();
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postLeague(cookie, { pickType: "straight_up" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as LeagueResponse;

    expect(body.startsAt).not.toBeNull();
    expect(new Date(body.startsAt!).getTime()).toBeGreaterThan(PRE_START_NOW.getTime());
  });

  it("advances the start to the next week whose first kickoff is still ahead", async () => {
    await seedFullSeason();
    const { cookie } = await createAuthenticatedUser(auth);

    // One millisecond past week 1's kickoff: the week has begun, so the league
    // resolves to week 2 rather than being pinned to a week already underway.
    const res = await postLeague(cookie, { pickType: "straight_up" }, appAfterKickoff);
    expect(res.status).toBe(201);
    const { id, startsAt } = (await res.json()) as LeagueResponse;

    expect(await storedSettings(id)).toMatchObject({
      startWeek: regular(2),
      endWeek: regular(18),
    });
    expect(startsAt).toBe(WEEK2_KICKOFF.toISOString());
  });

  it("advances past a week whose kickoff was corrected forward, using the effective kickoff", async () => {
    // Week 1's real kickoff is in the past, but a correction (arch D15) moved
    // it ahead of the clock — so week 1 has NOT begun and the league starts
    // there. Resolution reads the same effective kickoff the lock derivation
    // does; disagreeing would mean a league whose start week is already locked.
    const corrected = new Date(WEEK1_KICKOFF.getTime() + 2 * 24 * 60 * 60 * 1000);
    await seedSeason(db, {
      year: 2026,
      weeks: [
        {
          weekNumber: 1,
          kickoffs: [{ kickoffAt: WEEK1_KICKOFF, overrideKickoffAt: corrected }],
        },
        { weekNumber: 2, kickoffs: [{ kickoffAt: WEEK2_KICKOFF }] },
      ],
    });
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postLeague(cookie, { pickType: "straight_up" }, appAfterKickoff);
    expect(res.status).toBe(201);
    const { id, startsAt } = (await res.json()) as LeagueResponse;

    expect(await storedSettings(id)).toMatchObject({ startWeek: regular(1) });
    expect(startsAt).toBe(corrected.toISOString());
  });

  it("falls back to regular week 1 on a provisional season whose weeks hold no games", async () => {
    // The offseason path (ADR-0009): leagues are creatable most of the year
    // against a season with no schedule yet, so there is no kickoff to compare
    // and nothing to advance past.
    await seedSeason(db, {
      year: 2027,
      provisional: true,
      weeks: [{ weekNumber: 1, kickoffs: [] }],
    });
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postLeague(cookie, { pickType: "straight_up" });
    expect(res.status).toBe(201);
    const { id, startsAt } = (await res.json()) as LeagueResponse;

    expect(await storedSettings(id)).toMatchObject({
      startWeek: regular(1),
      endWeek: regular(18),
    });
    expect(startsAt).toBeNull();
  });

  it("ignores week refs and the retired preset a client supplies", async () => {
    // The wire/stored divergence ADR-0031 keeps from ADR-0020: the resolved
    // range is decided server-side against the clock, so a client naming its
    // own refs — or a stale client still sending the preset ADR-0031 retired —
    // gets the resolved regular season anyway, never the range it asked for.
    await seedFullSeason();
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postLeague(cookie, {
      seasonRangePreset: "postseason",
      startWeek: postseason(4),
      endWeek: postseason(4),
      pickType: "straight_up",
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as LeagueResponse;

    const stored = await storedSettings(id);
    expect(stored).toMatchObject({
      startWeek: regular(1),
      endWeek: regular(18),
    });
    expect("seasonRangePreset" in stored).toBe(false);
  });

  it("advances into a games-less week by its own window rather than skipping it (ADR-0021's rule)", async () => {
    // Week 1 has kicked off and week 2 exists with its real calendar window
    // but no games yet. The week is still ahead until its own `ends_at`, so
    // resolution lands on it instead of treating it as invisible.
    await seedSeason(db, {
      year: 2026,
      weeks: [
        { weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] },
        {
          weekNumber: 2,
          startsAt: new Date(WEEK1_KICKOFF.getTime() + 3 * DAY_MS),
          endsAt: new Date(WEEK1_KICKOFF.getTime() + 10 * DAY_MS),
          kickoffs: [],
        },
      ],
    });
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postLeague(cookie, { pickType: "straight_up" }, appAfterKickoff);
    expect(res.status).toBe(201);
    const { id, startsAt } = (await res.json()) as LeagueResponse;

    expect(await storedSettings(id)).toMatchObject({ startWeek: regular(2) });
    // No games in the start week yet, so there is no derivable start — the
    // league is pre-start and adopts the week's real first kickoff once the
    // schedule lands (ADR-0008).
    expect(startsAt).toBeNull();
  });

  it("refuses creation during the playoffs — range confinement is unchanged", async () => {
    // The regular season is over but playoff rounds are still ahead. The
    // search is confined to the regular-season range on purpose: finding
    // nothing there, resolution falls back to the nominal start and meets the
    // existing refusal, rather than resolving a start past its own end.
    await seedPostseasonSeededThroughWildCard();
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postLeague(
      cookie,
      { pickType: "straight_up" },
      appAt(UNSEEDED_DIVISIONAL_NOW),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "start_week_passed" });
  });

  it("refuses a season whose regular-season range has already run", async () => {
    // Created once the last ingested regular week has kicked off: nothing is
    // left to advance to inside the range, so resolution falls back to a
    // nominal start in the past and the existing refusal catches it.
    await seedSeason(db, {
      year: 2026,
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] }],
    });
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postLeague(cookie, { pickType: "straight_up" }, appAfterKickoff);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "start_week_passed" });
  });
});

describe("PATCH /api/leagues/:leagueId — the pre-start editor re-resolves", () => {
  it("keeps the resolved range through a settings edit that carries none", async () => {
    // The wire shape has nothing to say about the range, so a save must leave
    // the stored refs intact rather than dropping them — the edit re-resolves
    // against the same clock and lands on the same weeks. (Re-resolution can
    // also *advance* the start — a stored start week that emptied and passed —
    // and pickem-picks.test.ts's settings-reset suite pins that a save which
    // does so clears the instance's picks.)
    await seedFullSeason();
    const { cookie } = await createAuthenticatedUser(auth);
    const created = await postLeague(cookie, { pickType: "straight_up" });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as LeagueResponse;

    const res = await patchLeague(cookie, id, {
      pickType: "against_the_spread",
      picksPerWeek: 3,
    });
    expect(res.status).toBe(200);
    expect(await storedSettings(id)).toMatchObject({
      startWeek: regular(1),
      endWeek: regular(18),
      pickType: "against_the_spread",
      picksPerWeek: 3,
    });
  });
});

/**
 * ADR-0024: Survivor's request carries no range, so these assert the same
 * mid-week rule Pick'em's resolution gets, reached without anything on the
 * wire to reach it by.
 */
describe("POST /api/leagues — Survivor's range is resolved, never chosen", () => {
  const SURVIVOR_SETTINGS = { pushTieResolution: "advance" };

  it("stores the regular season while every week is still ahead", async () => {
    await seedFullSeason();
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postSurvivorLeague(cookie, SURVIVOR_SETTINGS);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as LeagueResponse;

    expect(await storedSurvivorSettings(id)).toMatchObject({
      startWeek: regular(1),
      endWeek: regular(18),
      pushTieResolution: "advance",
    });
  });

  it("advances the start to the next week whose first kickoff is still ahead", async () => {
    await seedFullSeason();
    const { cookie } = await createAuthenticatedUser(auth);

    // One millisecond past week 1's kickoff. The end never moves: Survivor's
    // nominal end is regular week 18 whatever the clock says.
    const res = await postSurvivorLeague(cookie, SURVIVOR_SETTINGS, appAfterKickoff);
    expect(res.status).toBe(201);
    const { id, startsAt } = (await res.json()) as LeagueResponse;

    expect(await storedSurvivorSettings(id)).toMatchObject({
      startWeek: regular(2),
      endWeek: regular(18),
    });
    expect(startsAt).toBe(WEEK2_KICKOFF.toISOString());
  });

  it("falls back to regular week 1 on a provisional season whose weeks hold no games", async () => {
    await seedSeason(db, {
      year: 2027,
      provisional: true,
      weeks: [{ weekNumber: 1, kickoffs: [] }],
    });
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postSurvivorLeague(cookie, SURVIVOR_SETTINGS);
    expect(res.status).toBe(201);
    const { id, startsAt } = (await res.json()) as LeagueResponse;

    expect(await storedSurvivorSettings(id)).toMatchObject({
      startWeek: regular(1),
      endWeek: regular(18),
    });
    expect(startsAt).toBeNull();
  });

  it("is never born already started — a league created mid-season is still joinable", async () => {
    // The whole reason resolution isn't just "pin week 1" (ADR-0024): pinned,
    // this league's join cutoff would already have passed at creation and the
    // members it was created for could never get in.
    await seedFullSeason();
    const { cookie } = await createAuthenticatedUser(auth);
    const joiner = await createAuthenticatedUser(auth, { username: "joiner" });

    const created = await postSurvivorLeague(cookie, SURVIVOR_SETTINGS, appAfterKickoff);
    expect(created.status).toBe(201);
    const { id, startsAt } = (await created.json()) as LeagueResponse;
    expect(new Date(startsAt!).getTime()).toBeGreaterThan(POST_START_NOW.getTime());

    const joined = await joinLeague(joiner.cookie, id, appAfterKickoff);
    expect(joined.status).toBe(201);
  });

  it("refuses a season whose regular-season range has already run", async () => {
    // Created once the last ingested regular week has kicked off: nothing left
    // to advance to, so resolution falls back to a nominal start in the past
    // and `createLeague`'s existing refusal catches it (ADR-0024 §Decision).
    await seedSeason(db, {
      year: 2026,
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] }],
    });
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postSurvivorLeague(cookie, SURVIVOR_SETTINGS, appAfterKickoff);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "start_week_passed" });
  });

  it("keeps the resolved range through a settings edit that carries none", async () => {
    // The wire shape has nothing to say about the range, so a save must leave
    // the stored refs intact rather than dropping them — the edit re-resolves
    // against the same clock and lands on the same weeks. (Re-resolution
    // *moving* the range needs a season whose weeks changed underneath the
    // league, which is renewal — renewal.test.ts pins that half.)
    await seedFullSeason();
    const { cookie } = await createAuthenticatedUser(auth);
    const created = await postSurvivorLeague(cookie, SURVIVOR_SETTINGS);
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as LeagueResponse;

    const res = await patchLeague(cookie, id, { pushTieResolution: "eliminate" });
    expect(res.status).toBe(200);
    expect(await storedSurvivorSettings(id)).toMatchObject({
      startWeek: regular(1),
      endWeek: regular(18),
      pushTieResolution: "eliminate",
    });
  });
});
