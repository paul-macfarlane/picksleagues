import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { leagueMembers, leagueSeasons, leagues, users } from "@picksleagues/db";
import {
  LEAGUE_MODE,
  LEAGUE_STATUS,
  MEMBER_ROLE,
  PICKEM_PICK_SIDE,
  PICK_TYPE,
  SPORT,
  WEEK_TYPE,
  type LeagueResponse,
  type LeagueStatus,
  type PickemSettings,
} from "@picksleagues/schemas";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import {
  DEFAULT_PICKEM_SETTINGS,
  DEFAULT_SURVIVOR_SETTINGS,
  insertLeague,
  insertPick,
  membersOf,
  seasonIdFor,
  seedSeason,
} from "./setup/league-helpers";
import { insertSurvivorPick, insertSurvivorState } from "./setup/survivor-league";
import { makeLeagueTestHarness, WEEK1_KICKOFF } from "./setup/league-app";
import { resetDb } from "./setup/reset-db";

const { db, auth, app, appAfterKickoff, appAtKickoff } = makeLeagueTestHarness();

// The Pick'em wire shape names no range at all (ADR-0031); the server
// resolves the regular-season range it stores.
const VALID_PICKEM_BODY = {
  mode: "pickem",
  name: "The Gridiron Gang",
  visibility: "private",
  settings: {
    pickType: "straight_up",
  },
};

function postLeague(
  cookie: string | undefined,
  body: Record<string, unknown>,
  on: typeof app = app,
) {
  return on.request("/api/leagues", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function getMyLeagues(cookie: string | undefined, on: typeof app = app) {
  return on.request("/api/leagues", {
    method: "GET",
    headers: { ...(cookie ? { cookie } : {}) },
  });
}

function getLeague(cookie: string | undefined, leagueId: string) {
  return app.request(`/api/leagues/${leagueId}`, {
    method: "GET",
    headers: { ...(cookie ? { cookie } : {}) },
  });
}

async function seedDefaultSeason() {
  return seedSeason(db, {
    year: 2026,
    weeks: [
      { weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] },
      { weekNumber: 2, kickoffs: [] },
    ],
  });
}

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

describe("POST /api/leagues", () => {
  it("401s without a session", async () => {
    const res = await postLeague(undefined, VALID_PICKEM_BODY);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("400s a malformed JSON body — Hono's thrown HTTPException must not become a 500", async () => {
    await seedDefaultSeason();
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await app.request("/api/leagues", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "{not-json",
    });
    expect(res.status).toBe(400);
  });

  it("creates a league with settings and the creator as commissioner", async () => {
    await seedDefaultSeason();
    const { user, cookie } = await createAuthenticatedUser(auth);

    const res = await postLeague(cookie, VALID_PICKEM_BODY);
    expect(res.status).toBe(201);
    const body = (await res.json()) as LeagueResponse;

    expect(body).toMatchObject({
      name: "The Gridiron Gang",
      mode: "pickem",
      visibility: "private",
      status: "active",
      seasonYear: 2026,
      myRole: "commissioner",
      startsAt: WEEK1_KICKOFF.toISOString(),
    });
    // Defaults applied by the settings schema, not the client.
    expect(body.settings).toMatchObject({ picksPerWeek: 5 });
    expect(body.members).toHaveLength(1);
    expect(body.members[0]).toMatchObject({ userId: user.id, role: "commissioner" });

    const instanceRows = await db
      .select()
      .from(leagueSeasons)
      .where(eq(leagueSeasons.leagueId, body.id));
    // Creating a league mints exactly one season instance (ADR-0009) carrying
    // the parsed settings.
    expect(instanceRows).toHaveLength(1);
    expect(instanceRows[0]?.settings).toMatchObject({ picksPerWeek: 5 });
    expect(instanceRows[0]?.status).toBe("active");
    const memberRows = await db
      .select()
      .from(leagueMembers)
      .where(eq(leagueMembers.leagueId, body.id));
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0]).toMatchObject({ userId: user.id, role: "commissioner" });
  });

  it("derives startsAt as null when no week in the league's range has ingested games", async () => {
    // Weeks exist, kickoffs don't — resolution has nothing to advance past, so
    // the nominal start stands and no start boundary is derivable yet.
    await seedSeason(db, {
      year: 2026,
      weeks: [
        { weekNumber: 1, kickoffs: [] },
        { weekNumber: 2, kickoffs: [] },
      ],
    });
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postLeague(cookie, VALID_PICKEM_BODY);
    expect(res.status).toBe(201);
    expect(((await res.json()) as LeagueResponse).startsAt).toBeNull();
  });

  it("derives startsAt from override_kickoff_at when a kickoff was corrected (D15)", async () => {
    const overridden = new Date("2026-09-12T17:00:00.000Z");
    await seedSeason(db, {
      year: 2026,
      weeks: [
        { weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF, overrideKickoffAt: overridden }] },
      ],
    });
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postLeague(cookie, VALID_PICKEM_BODY);
    expect(res.status).toBe(201);
    expect(((await res.json()) as LeagueResponse).startsAt).toBe(overridden.toISOString());
  });

  it.each([
    {
      label: "no pick type",
      settings: {},
    },
    {
      label: "unknown pick type",
      settings: { ...VALID_PICKEM_BODY.settings, pickType: "parlay" },
    },
    {
      label: "picksPerWeek out of range",
      settings: { ...VALID_PICKEM_BODY.settings, picksPerWeek: 17 },
    },
  ])("400s on invalid settings: $label", async ({ settings }) => {
    await seedDefaultSeason();
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postLeague(cookie, { ...VALID_PICKEM_BODY, settings });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "validation" });
  });

  it.each([
    { label: "below the 2-member floor", maxMembers: 1 },
    { label: "above the 100-member ceiling", maxMembers: 101 },
  ])("400s on maxMembers $label", async ({ maxMembers }) => {
    await seedDefaultSeason();
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postLeague(cookie, { ...VALID_PICKEM_BODY, maxMembers });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "validation" });
  });

  it("creates a league with a custom maxMembers below the global ceiling", async () => {
    await seedDefaultSeason();
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postLeague(cookie, { ...VALID_PICKEM_BODY, maxMembers: 2 });
    expect(res.status).toBe(201);
    expect(((await res.json()) as LeagueResponse).maxMembers).toBe(2);
  });

  it("defaults maxMembers to 10 when omitted", async () => {
    await seedDefaultSeason();
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postLeague(cookie, VALID_PICKEM_BODY);
    expect(res.status).toBe(201);
    expect(((await res.json()) as LeagueResponse).maxMembers).toBe(10);
  });

  it("creates a survivor league from the two settings it still accepts", async () => {
    await seedDefaultSeason();
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postLeague(cookie, {
      mode: "survivor",
      name: "Survivors",
      visibility: "private",
      settings: { pickType: "straight_up" },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as LeagueResponse;
    // The range is the server's answer, not the request's (ADR-0024); nothing
    // else is chosen at all (ADR-0026/0033).
    expect(body.settings).toMatchObject({
      startWeek: { type: "regular", number: 1 },
      endWeek: { type: "regular", number: 18 },
    });
  });

  it("ignores week refs a client supplies on a survivor create", async () => {
    // ADR-0024: the range is decided server-side against the clock, so a client
    // naming its own gets the resolved one anyway rather than the range it
    // asked for — the same wire/stored divergence Pick'em rests on.
    await seedDefaultSeason();
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postLeague(cookie, {
      mode: "survivor",
      name: "Survivors",
      visibility: "private",
      settings: {
        startWeek: { type: "regular", number: 1 },
        endWeek: { type: "regular", number: 10 },
        pickType: "straight_up",
      },
    });
    expect(res.status).toBe(201);
    // Week 18, not the 10 the request named.
    expect(((await res.json()) as LeagueResponse).settings).toMatchObject({
      startWeek: { type: "regular", number: 1 },
      endWeek: { type: "regular", number: 18 },
    });
  });

  it("409s march-madness creation even with an NCAAMB season ingested — the mode is gated until epic 07 (LNCH-12)", async () => {
    // Season availability is deliberately not the gate: seeding NCAAMB proves
    // the refusal is mode_unavailable, not a disguised no_active_season.
    await seedSeason(db, { sport: SPORT.NCAAMB, year: 2027, weeks: [] });
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postLeague(cookie, {
      mode: "march_madness",
      name: "Bracket Bash",
      visibility: "public",
      settings: { maxBracketsPerMember: 5 },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "mode_unavailable" });
  });

  it("creates a pick'em league while only a provisional upcoming season exists (ADR-0009: provisional is pre-start, not unusable)", async () => {
    // A provisional row the offseason schedule sync fabricated ahead of real
    // ingestion — estimated weeks, zero games (never games — leagueStartAt
    // must keep deriving null until real kickoffs land).
    await seedSeason(db, {
      year: 2027,
      provisional: true,
      weeks: [
        { weekNumber: 1, kickoffs: [] },
        { weekNumber: 18, kickoffs: [] },
      ],
    });
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postLeague(cookie, VALID_PICKEM_BODY);
    expect(res.status).toBe(201);
    const body = (await res.json()) as LeagueResponse;
    // Binds to the provisional row (latest year desc) and is fully
    // creatable/joinable/editable pre-start — the ADR's whole point.
    expect(body).toMatchObject({
      mode: "pickem",
      status: "active",
      seasonYear: 2027,
      startsAt: null,
    });
  });

  it("409s the 11th active commissionership and rolls the creation back", async () => {
    const { seasonId } = await seedDefaultSeason();
    const { user, cookie } = await createAuthenticatedUser(auth);
    for (let i = 0; i < 10; i++) {
      await insertLeague(db, {
        seasonId,
        name: `League ${i}`,
        members: [{ userId: user.id, role: MEMBER_ROLE.COMMISSIONER }],
      });
    }

    const res = await postLeague(cookie, VALID_PICKEM_BODY);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "cap_exceeded" });
    const rows = await db.select().from(leagues).where(eq(leagues.name, "The Gridiron Gang"));
    expect(rows).toHaveLength(0);
  });

  // ADR-0009: the cap consults each league's CURRENT instance (greatest season
  // year), never "any instance is active/concluded" — these two cases would
  // both trip a naive exists-any implementation.
  async function addSeasonInstance(
    leagueId: string,
    seasonId: string,
    status: (typeof LEAGUE_STATUS)[keyof typeof LEAGUE_STATUS],
  ): Promise<void> {
    const seedAt = new Date("2026-01-01T00:00:00.000Z");
    await db.insert(leagueSeasons).values({
      leagueId,
      seasonId,
      settings: DEFAULT_PICKEM_SETTINGS,
      status,
      createdAt: seedAt,
      updatedAt: seedAt,
    });
  }

  it("does not count a league whose CURRENT instance is concluded, despite an older active one", async () => {
    const { seasonId: y2026 } = await seedDefaultSeason();
    const { seasonId: y2027 } = await seedSeason(db, { year: 2027, weeks: [] });
    const { user, cookie } = await createAuthenticatedUser(auth);
    for (let i = 0; i < 9; i++) {
      await insertLeague(db, {
        seasonId: y2026,
        name: `League ${i}`,
        members: [{ userId: user.id, role: MEMBER_ROLE.COMMISSIONER }],
      });
    }
    // Older 2026 instance active, current 2027 instance concluded → excluded.
    const multi = await insertLeague(db, {
      seasonId: y2026,
      name: "Renewed Then Concluded",
      status: LEAGUE_STATUS.ACTIVE,
      members: [{ userId: user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });
    await addSeasonInstance(multi.id, y2027, LEAGUE_STATUS.CONCLUDED);

    // 9 active + the new one = 10; the multi-season league is concluded-current.
    const res = await postLeague(cookie, VALID_PICKEM_BODY);
    expect(res.status).toBe(201);
  });

  it("counts a league whose CURRENT instance is active exactly once, despite an older concluded one", async () => {
    const { seasonId: y2026 } = await seedDefaultSeason();
    const { seasonId: y2027 } = await seedSeason(db, { year: 2027, weeks: [] });
    const { user, cookie } = await createAuthenticatedUser(auth);
    for (let i = 0; i < 9; i++) {
      await insertLeague(db, {
        seasonId: y2026,
        name: `League ${i}`,
        members: [{ userId: user.id, role: MEMBER_ROLE.COMMISSIONER }],
      });
    }
    // Older 2026 instance concluded, current 2027 instance active → counts once.
    const multi = await insertLeague(db, {
      seasonId: y2026,
      name: "Concluded Then Renewed",
      status: LEAGUE_STATUS.CONCLUDED,
      members: [{ userId: user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });
    await addSeasonInstance(multi.id, y2027, LEAGUE_STATUS.ACTIVE);

    // 9 active + active-current multi = 10; the 11th trips the cap.
    const res = await postLeague(cookie, VALID_PICKEM_BODY);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "cap_exceeded" });
  });

  it("enforces one instance per league per season (unique constraint)", async () => {
    const { seasonId } = await seedDefaultSeason();
    const league = await insertLeague(db, { seasonId, name: "Dup Season" });
    const seedAt = new Date("2026-01-01T00:00:00.000Z");

    await expect(
      db.insert(leagueSeasons).values({
        leagueId: league.id,
        seasonId,
        settings: DEFAULT_PICKEM_SETTINGS,
        status: LEAGUE_STATUS.ACTIVE,
        createdAt: seedAt,
        updatedAt: seedAt,
      }),
    ).rejects.toThrow();
  });

  it("409s a start week that has already begun — a league must be born pre-start", async () => {
    await seedDefaultSeason();
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postLeague(cookie, VALID_PICKEM_BODY, appAfterKickoff);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "start_week_passed" });
    expect(await db.select().from(leagues)).toHaveLength(0);
  });

  it("advances the start past a week already underway instead of refusing", async () => {
    const week2Kickoff = new Date(WEEK1_KICKOFF.getTime() + 7 * 24 * 60 * 60 * 1000);
    await seedSeason(db, {
      year: 2026,
      weeks: [
        { weekNumber: 1, kickoffs: [{ kickoffAt: WEEK1_KICKOFF }] },
        { weekNumber: 2, kickoffs: [{ kickoffAt: week2Kickoff }] },
      ],
    });
    const { cookie } = await createAuthenticatedUser(auth);

    // Week 1 has kicked off under this clock. Pinned to it the league would be
    // born started — joins closed before anyone was invited (ADR-0020) — so
    // the resolved start is the next week still ahead.
    const res = await postLeague(cookie, VALID_PICKEM_BODY, appAfterKickoff);
    expect(res.status).toBe(201);
    expect(((await res.json()) as LeagueResponse).startsAt).toBe(week2Kickoff.toISOString());
  });

  it("does not count plain memberships toward the cap", async () => {
    const { seasonId } = await seedDefaultSeason();
    const { user, cookie } = await createAuthenticatedUser(auth);
    for (let i = 0; i < 10; i++) {
      await insertLeague(db, {
        seasonId,
        name: `League ${i}`,
        members: [{ userId: user.id, role: MEMBER_ROLE.MEMBER }],
      });
    }

    const res = await postLeague(cookie, VALID_PICKEM_BODY);
    expect(res.status).toBe(201);
  });
});

describe("GET /api/leagues", () => {
  it("401s without a session", async () => {
    const res = await getMyLeagues(undefined);
    expect(res.status).toBe(401);
  });

  it("lists only the caller's leagues with member counts and roles", async () => {
    const { seasonId } = await seedDefaultSeason();
    const { user, cookie } = await createAuthenticatedUser(auth);
    const other = await createAuthenticatedUser(auth, { username: "someone_else" });

    await insertLeague(db, {
      seasonId,
      name: "Mine",
      members: [
        { userId: user.id, role: MEMBER_ROLE.COMMISSIONER },
        { userId: other.user.id, role: MEMBER_ROLE.MEMBER },
      ],
    });
    await insertLeague(db, {
      seasonId,
      name: "Theirs",
      members: [{ userId: other.user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });

    const res = await getMyLeagues(cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { leagues: unknown[] };
    expect(body.leagues).toHaveLength(1);
    expect(body.leagues[0]).toMatchObject({
      name: "Mine",
      memberCount: 2,
      myRole: "commissioner",
      startsAt: WEEK1_KICKOFF.toISOString(),
      // Each glance answers for its own mode, so this Pick'em league carries no
      // Survivor one. The Pick'em state is deliberately not asserted here: this
      // fixture's current week is a degenerate zero-length week 2, so any value
      // would be an artifact of the fixture rather than the claim this test's
      // name makes. The states are pinned in the §pickemPickStatus block.
      survivorPickStatus: null,
    });
  });

  it("returns an empty list for a user with no leagues", async () => {
    const { cookie } = await createAuthenticatedUser(auth);
    const res = await getMyLeagues(cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ leagues: [] });
  });

  // Bounds chosen so the current week resolves the same way under both harness
  // clocks: pre-start it is the next week to begin, post-kickoff the one in
  // progress. A second unstarted game sits three hours behind the first, which
  // is what separates "the week has started" from "the week has closed".
  const GLANCE_WEEK_STARTS = new Date("2026-09-10T00:00:00.000Z");
  const GLANCE_WEEK_ENDS = new Date("2026-09-17T00:00:00.000Z");
  const LATE_KICKOFF = new Date(WEEK1_KICKOFF.getTime() + 3 * 60 * 60 * 1000);

  async function seedGlanceSeason(kickoffs: Date[]) {
    return seedSeason(db, {
      weeks: [
        {
          weekNumber: 1,
          startsAt: GLANCE_WEEK_STARTS,
          endsAt: GLANCE_WEEK_ENDS,
          kickoffs: kickoffs.map((kickoffAt) => ({ kickoffAt })),
        },
      ],
    });
  }

  async function readMyLeagues(cookie: string, on: typeof app = app) {
    const res = await getMyLeagues(cookie, on);
    expect(res.status).toBe(200);
    return (await res.json()) as { leagues: Array<Record<string, unknown>> };
  }

  // FB-28: the dashboard card describes a started league by where it is, and
  // it can only do that if the server names the week — the card has no week
  // list to derive one from, and a second derivation could disagree with the
  // pick screen it links to.
  describe("currentWeekLabel", () => {
    it("names the week the league is on", async () => {
      const { seasonId } = await seedGlanceSeason([WEEK1_KICKOFF]);
      const { user, cookie } = await createAuthenticatedUser(auth);
      await insertLeague(db, {
        seasonId,
        name: "Mine",
        members: [{ userId: user.id, role: MEMBER_ROLE.COMMISSIONER }],
      });

      // Both harness clocks sit inside week 1's bounds, before and after its
      // kickoff — the label is the week, not the kickoff.
      expect((await readMyLeagues(cookie)).leagues[0]).toMatchObject({
        currentWeekLabel: "Week 1",
      });
      expect((await readMyLeagues(cookie, appAfterKickoff)).leagues[0]).toMatchObject({
        currentWeekLabel: "Week 1",
      });
    });

    it("is null when the season holds no weeks to name", async () => {
      const { seasonId } = await seedSeason(db, { year: 2026, weeks: [] });
      const { user, cookie } = await createAuthenticatedUser(auth);
      await insertLeague(db, {
        seasonId,
        name: "Unscheduled",
        members: [{ userId: user.id, role: MEMBER_ROLE.COMMISSIONER }],
      });

      expect((await readMyLeagues(cookie)).leagues[0]).toMatchObject({
        currentWeekLabel: null,
        startsAt: null,
      });
    });
  });

  describe("survivorPickStatus", () => {
    async function insertSurvivorLeagueFor(seasonId: string, userId: string, name: string) {
      const league = await insertLeague(db, {
        seasonId,
        name,
        mode: LEAGUE_MODE.SURVIVOR,
        settings: DEFAULT_SURVIVOR_SETTINGS,
        members: [{ userId, role: MEMBER_ROLE.COMMISSIONER }],
      });
      const members = await membersOf(db, league.id);
      return {
        league,
        leagueSeasonId: await seasonIdFor(db, league.id),
        membershipId: members.get(userId)!,
      };
    }

    it("asks for a pick while the week still holds an unstarted game", async () => {
      const { seasonId } = await seedGlanceSeason([WEEK1_KICKOFF]);
      const { user, cookie } = await createAuthenticatedUser(auth);
      await insertSurvivorLeagueFor(seasonId, user.id, "Survivor");

      const body = await readMyLeagues(cookie);
      expect(body.leagues[0]).toMatchObject({
        survivorPickStatus: "pick_needed",
        // The glances are per mode, so a Survivor league carries no Pick'em one.
        pickemPickStatus: null,
      });
    });

    it("still asks for a pick after the first kickoff, while a later game is open", async () => {
      const { seasonId } = await seedGlanceSeason([WEEK1_KICKOFF, LATE_KICKOFF]);
      const { user, cookie } = await createAuthenticatedUser(auth);
      await insertSurvivorLeagueFor(seasonId, user.id, "Survivor");

      const body = await readMyLeagues(cookie, appAfterKickoff);
      expect(body.leagues[0]).toMatchObject({ survivorPickStatus: "pick_needed" });
    });

    it("reports the pick is in once the member has one for the current week", async () => {
      const { seasonId, weekIds, gameIds, teamIds } = await seedGlanceSeason([WEEK1_KICKOFF]);
      const { user, cookie } = await createAuthenticatedUser(auth);
      const { leagueSeasonId, membershipId } = await insertSurvivorLeagueFor(
        seasonId,
        user.id,
        "Survivor",
      );
      await insertSurvivorPick(db, {
        leagueSeasonId,
        leagueMemberId: membershipId,
        weekId: weekIds.get("regular:1")!,
        gameId: gameIds.get("regular:1")![0]!,
        teamId: teamIds.home,
      });

      const body = await readMyLeagues(cookie);
      expect(body.leagues[0]).toMatchObject({ survivorPickStatus: "pick_in" });
    });

    it("closes the week once every game in it has kicked off with no pick standing", async () => {
      const { seasonId } = await seedGlanceSeason([WEEK1_KICKOFF]);
      const { user, cookie } = await createAuthenticatedUser(auth);
      await insertSurvivorLeagueFor(seasonId, user.id, "Survivor");

      const body = await readMyLeagues(cookie, appAfterKickoff);
      expect(body.leagues[0]).toMatchObject({ survivorPickStatus: "locked" });
    });

    it("still asks for a pick in a week whose schedule has not been ingested", async () => {
      // A week holding no games has closed against nobody — settlement refuses
      // to grade one (ADR-0025), so a miss there would name an elimination that
      // cannot happen. The mode's own rule, and the opposite of Pick'em's answer
      // to the same week.
      const { seasonId } = await seedGlanceSeason([]);
      const { user, cookie } = await createAuthenticatedUser(auth);
      await insertSurvivorLeagueFor(seasonId, user.id, "Survivor");

      const body = await readMyLeagues(cookie, appAfterKickoff);
      expect(body.leagues[0]).toMatchObject({ survivorPickStatus: "pick_needed" });
    });

    it("reports elimination ahead of a pick that is already in", async () => {
      const { seasonId, weekIds, gameIds, teamIds } = await seedGlanceSeason([WEEK1_KICKOFF]);
      const { user, cookie } = await createAuthenticatedUser(auth);
      const { leagueSeasonId, membershipId } = await insertSurvivorLeagueFor(
        seasonId,
        user.id,
        "Survivor",
      );
      const weekId = weekIds.get("regular:1")!;
      await insertSurvivorPick(db, {
        leagueSeasonId,
        leagueMemberId: membershipId,
        weekId,
        gameId: gameIds.get("regular:1")![0]!,
        teamId: teamIds.home,
      });
      await insertSurvivorState(db, {
        leagueSeasonId,
        leagueMemberId: membershipId,
        eliminatedWeekId: weekId,
      });

      const body = await readMyLeagues(cookie);
      expect(body.leagues[0]).toMatchObject({ survivorPickStatus: "eliminated" });
    });

    it("calls a member who is the last one standing a winner, not a member who owes a pick", async () => {
      const { seasonId, weekIds } = await seedGlanceSeason([WEEK1_KICKOFF]);
      const survivor = await createAuthenticatedUser(auth);
      const beaten = await createAuthenticatedUser(auth);
      const league = await insertLeague(db, {
        seasonId,
        name: "Survivor",
        mode: LEAGUE_MODE.SURVIVOR,
        settings: DEFAULT_SURVIVOR_SETTINGS,
        members: [
          { userId: survivor.user.id, role: MEMBER_ROLE.COMMISSIONER },
          { userId: beaten.user.id, role: MEMBER_ROLE.MEMBER },
        ],
      });
      const members = await membersOf(db, league.id);
      const leagueSeasonId = await seasonIdFor(db, league.id);
      await insertSurvivorState(db, {
        leagueSeasonId,
        leagueMemberId: members.get(beaten.user.id)!,
        eliminatedWeekId: weekIds.get("regular:1")!,
      });
      // Both halves of what settlement leaves behind when a season ends
      // (ADR-0030): the ledger naming who went out, and the stored ending the
      // glance reads. Seeded rather than settled because the subject here is the
      // glance, not the replay that produced its inputs.
      await db
        .update(leagueSeasons)
        .set({ status: LEAGUE_STATUS.CONCLUDED })
        .where(eq(leagueSeasons.id, leagueSeasonId));

      // The week is wide open, which is exactly what the season being decided
      // overrides (ADR-0027) — and the member they beat still reads as out.
      expect((await readMyLeagues(survivor.cookie)).leagues[0]).toMatchObject({
        survivorPickStatus: "won",
      });
      expect((await readMyLeagues(beaten.cookie)).leagues[0]).toMatchObject({
        survivorPickStatus: "eliminated",
      });
    });

    it("resolves each Survivor league on its own in one payload", async () => {
      const { seasonId, weekIds, gameIds, teamIds } = await seedGlanceSeason([WEEK1_KICKOFF]);
      const { user, cookie } = await createAuthenticatedUser(auth);
      const picked = await insertSurvivorLeagueFor(seasonId, user.id, "Picked");
      await insertSurvivorLeagueFor(seasonId, user.id, "Unpicked");
      await insertSurvivorPick(db, {
        leagueSeasonId: picked.leagueSeasonId,
        leagueMemberId: picked.membershipId,
        weekId: weekIds.get("regular:1")!,
        gameId: gameIds.get("regular:1")![0]!,
        teamId: teamIds.home,
      });

      const body = await readMyLeagues(cookie);
      expect(body.leagues).toHaveLength(2);
      // Keyed by name rather than compared positionally: the claim is that each
      // league resolves its own status, and these two are created in the same
      // tick, so any order between them is a legal answer to a question this
      // test isn't asking.
      expect(
        new Map(body.leagues.map((league) => [league.name, league.survivorPickStatus])),
      ).toEqual(
        new Map([
          ["Picked", "pick_in"],
          ["Unpicked", "pick_needed"],
        ]),
      );
    });
  });

  describe("pickemPickStatus", () => {
    async function insertPickemLeagueFor(
      seasonId: string,
      userId: string,
      name: string,
      { status, settings }: { status?: LeagueStatus; settings?: PickemSettings } = {},
    ) {
      const league = await insertLeague(db, {
        seasonId,
        name,
        status,
        settings,
        members: [{ userId, role: MEMBER_ROLE.COMMISSIONER }],
      });
      const members = await membersOf(db, league.id);
      return {
        league,
        leagueSeasonId: await seasonIdFor(db, league.id),
        membershipId: members.get(userId)!,
      };
    }

    it("asks for picks while the week still holds an unstarted game", async () => {
      const { seasonId } = await seedGlanceSeason([WEEK1_KICKOFF]);
      const { user, cookie } = await createAuthenticatedUser(auth);
      await insertPickemLeagueFor(seasonId, user.id, "Pickem");

      const body = await readMyLeagues(cookie);
      expect(body.leagues[0]).toMatchObject({
        pickemPickStatus: "picks_needed",
        survivorPickStatus: null,
      });
    });

    it("still asks for picks after the first kickoff, while a later game is open", async () => {
      // A member arriving mid-week submits a smaller set of what is left
      // (ADR-0018), so the week owes them picks until nothing pickable remains.
      const { seasonId } = await seedGlanceSeason([WEEK1_KICKOFF, LATE_KICKOFF]);
      const { user, cookie } = await createAuthenticatedUser(auth);
      await insertPickemLeagueFor(seasonId, user.id, "Pickem");

      const body = await readMyLeagues(cookie, appAfterKickoff);
      expect(body.leagues[0]).toMatchObject({ pickemPickStatus: "picks_needed" });
    });

    it("reports the picks are in once the member holds any for the current week", async () => {
      // A week is one atomic submission (ADR-0018), so a single stored pick is
      // the whole of "submitted" — there is no partial state to report.
      const { seasonId, weekIds, gameIds } = await seedGlanceSeason([WEEK1_KICKOFF, LATE_KICKOFF]);
      const { user, cookie } = await createAuthenticatedUser(auth);
      const { leagueSeasonId, membershipId } = await insertPickemLeagueFor(
        seasonId,
        user.id,
        "Pickem",
      );
      await insertPick(db, {
        leagueSeasonId,
        leagueMemberId: membershipId,
        weekId: weekIds.get("regular:1")!,
        gameId: gameIds.get("regular:1")![0]!,
        side: PICKEM_PICK_SIDE.HOME,
      });

      const body = await readMyLeagues(cookie);
      expect(body.leagues[0]).toMatchObject({ pickemPickStatus: "picks_in" });
    });

    it("closes the week once every game in it has kicked off with no picks standing", async () => {
      const { seasonId } = await seedGlanceSeason([WEEK1_KICKOFF]);
      const { user, cookie } = await createAuthenticatedUser(auth);
      await insertPickemLeagueFor(seasonId, user.id, "Pickem");

      const body = await readMyLeagues(cookie, appAfterKickoff);
      expect(body.leagues[0]).toMatchObject({ pickemPickStatus: "locked" });
    });

    it("closes the week at the kickoff instant itself, not a moment after", async () => {
      // The half-open rule (arch D11), asked of the glance rather than trusted
      // to arrive intact through the shared slate helpers.
      const { seasonId } = await seedGlanceSeason([WEEK1_KICKOFF]);
      const { user, cookie } = await createAuthenticatedUser(auth);
      await insertPickemLeagueFor(seasonId, user.id, "Pickem");

      const body = await readMyLeagues(cookie, appAtKickoff);
      expect(body.leagues[0]).toMatchObject({ pickemPickStatus: "locked" });
    });

    it("reports nothing for a week whose schedule has not been ingested", async () => {
      // Neither state is true of a week with no games: "Picks needed" prompts
      // into a screen with nothing to pick, and "Week closed" is a confident
      // false claim about a week that was never scheduled. Deliberately unlike
      // Survivor, which still asks (ADR-0025 — an ungraded week must not
      // announce a miss); Pick'em has no miss penalty to protect a member from.
      const { seasonId } = await seedGlanceSeason([]);
      const { user, cookie } = await createAuthenticatedUser(auth);
      await insertPickemLeagueFor(seasonId, user.id, "Pickem");

      const body = await readMyLeagues(cookie);
      expect(body.leagues[0]).toMatchObject({ pickemPickStatus: null });
    });

    it("still asks for picks in an ATS week whose lines have not landed yet", async () => {
      // Games are unstarted and unpriced: the week is waiting on the odds sync,
      // which is what its pick screen says too — not a week that has closed. The
      // one state where the glance deliberately diverges from
      // `requiredPickemPickCount`, which counts an unpriced game out of the set.
      const { seasonId } = await seedGlanceSeason([WEEK1_KICKOFF]);
      const { user, cookie } = await createAuthenticatedUser(auth);
      await insertPickemLeagueFor(seasonId, user.id, "Pickem", {
        settings: { ...DEFAULT_PICKEM_SETTINGS, pickType: PICK_TYPE.AGAINST_THE_SPREAD },
      });

      const body = await readMyLeagues(cookie);
      expect(body.leagues[0]).toMatchObject({ pickemPickStatus: "picks_needed" });
    });

    it("reports nothing for a league whose season holds no week it plays at all", async () => {
      // One step further than the case above: not a gameless week, but no week
      // in range for the frame to resolve — a league whose stored range starts
      // past everything ingested (a provisional-season shape).
      const { seasonId } = await seedGlanceSeason([WEEK1_KICKOFF]);
      const { user, cookie } = await createAuthenticatedUser(auth);
      await insertPickemLeagueFor(seasonId, user.id, "Pickem", {
        settings: {
          ...DEFAULT_PICKEM_SETTINGS,
          startWeek: { type: WEEK_TYPE.REGULAR, number: 10 },
          endWeek: { type: WEEK_TYPE.REGULAR, number: 18 },
        },
      });

      const body = await readMyLeagues(cookie);
      expect(body.leagues[0]).toMatchObject({ pickemPickStatus: null });
    });

    it("reports a concluded season ahead of the week it would otherwise fall back to", async () => {
      // The week is wide open, which is exactly what settlement's stored ending
      // overrides (ADR-0030): the league is over, so nothing about that week is
      // a prompt.
      const { seasonId } = await seedGlanceSeason([WEEK1_KICKOFF]);
      const { user, cookie } = await createAuthenticatedUser(auth);
      await insertPickemLeagueFor(seasonId, user.id, "Pickem", {
        status: LEAGUE_STATUS.CONCLUDED,
      });

      const body = await readMyLeagues(cookie);
      expect(body.leagues[0]).toMatchObject({ pickemPickStatus: "season_complete" });
    });

    it("resolves each league on its own, whatever mode it is, in one payload", async () => {
      const { seasonId, weekIds, gameIds, teamIds } = await seedGlanceSeason([WEEK1_KICKOFF]);
      const { user, cookie } = await createAuthenticatedUser(auth);
      const picked = await insertPickemLeagueFor(seasonId, user.id, "Picked");
      await insertPickemLeagueFor(seasonId, user.id, "Unpicked");
      const survivor = await insertLeague(db, {
        seasonId,
        name: "Survivor",
        mode: LEAGUE_MODE.SURVIVOR,
        settings: DEFAULT_SURVIVOR_SETTINGS,
        members: [{ userId: user.id, role: MEMBER_ROLE.COMMISSIONER }],
      });
      await insertPick(db, {
        leagueSeasonId: picked.leagueSeasonId,
        leagueMemberId: picked.membershipId,
        weekId: weekIds.get("regular:1")!,
        gameId: gameIds.get("regular:1")![0]!,
        side: PICKEM_PICK_SIDE.HOME,
      });
      await insertSurvivorPick(db, {
        leagueSeasonId: await seasonIdFor(db, survivor.id),
        leagueMemberId: (await membersOf(db, survivor.id)).get(user.id)!,
        weekId: weekIds.get("regular:1")!,
        gameId: gameIds.get("regular:1")![0]!,
        teamId: teamIds.home,
      });

      const body = await readMyLeagues(cookie);
      // Keyed by name rather than compared positionally: the claim is that each
      // league resolves its own status, and these are created in the same tick,
      // so any order between them is a legal answer to a question this test
      // isn't asking.
      expect(
        new Map(
          body.leagues.map((league) => [
            league.name,
            [league.pickemPickStatus, league.survivorPickStatus],
          ]),
        ),
      ).toEqual(
        new Map([
          ["Picked", ["picks_in", null]],
          ["Unpicked", ["picks_needed", null]],
          // Each mode's glance answers for its own leagues only, so the Survivor
          // league's pick lands in the Survivor field and nowhere else.
          ["Survivor", [null, "pick_in"]],
        ]),
      );
    });
  });
});

describe("GET /api/leagues/:leagueId", () => {
  it("returns the league with settings and members to a member", async () => {
    const { seasonId } = await seedDefaultSeason();
    const { user, cookie } = await createAuthenticatedUser(auth);
    const other = await createAuthenticatedUser(auth, { username: "someone_else" });
    const league = await insertLeague(db, {
      seasonId,
      name: "Mine",
      members: [
        { userId: user.id, role: MEMBER_ROLE.MEMBER },
        { userId: other.user.id, role: MEMBER_ROLE.COMMISSIONER },
      ],
    });

    const res = await getLeague(cookie, league.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as LeagueResponse;
    expect(body).toMatchObject({ name: "Mine", myRole: "member" });
    expect(body.settings).toMatchObject(DEFAULT_PICKEM_SETTINGS);
    expect(body.members).toHaveLength(2);
  });

  // The member list carries the *resolved* avatar (ADR-0022) — league-mates see
  // the override, never the provider photo it replaced, and never the raw
  // override field itself.
  it("shows a league-mate a member's avatar override in place of their provider image", async () => {
    const { seasonId } = await seedDefaultSeason();
    const { user, cookie } = await createAuthenticatedUser(auth);
    const other = await createAuthenticatedUser(auth, { username: "override_haver" });
    await db
      .update(users)
      .set({
        image: "https://provider.example.invalid/from-oauth.png",
        imageOverride: "https://cdn.example.invalid/member-set.png",
      })
      .where(eq(users.id, other.user.id));
    const league = await insertLeague(db, {
      seasonId,
      name: "Mine",
      members: [
        { userId: user.id, role: MEMBER_ROLE.COMMISSIONER },
        { userId: other.user.id, role: MEMBER_ROLE.MEMBER },
      ],
    });

    const res = await getLeague(cookie, league.id);

    expect(res.status).toBe(200);
    const body = (await res.json()) as LeagueResponse;
    expect(body.members.find((member) => member.userId === other.user.id)?.image).toBe(
      "https://cdn.example.invalid/member-set.png",
    );
  });

  it("404s a non-member so private leagues stay hidden", async () => {
    const { seasonId } = await seedDefaultSeason();
    const owner = await createAuthenticatedUser(auth, { username: "owner" });
    const { cookie } = await createAuthenticatedUser(auth);
    const league = await insertLeague(db, {
      seasonId,
      members: [{ userId: owner.user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });

    const res = await getLeague(cookie, league.id);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "league_not_found" });
  });

  it("404s an unknown league id", async () => {
    const { cookie } = await createAuthenticatedUser(auth);
    const res = await getLeague(cookie, "00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  it("400s a malformed league id", async () => {
    const { cookie } = await createAuthenticatedUser(auth);
    const res = await getLeague(cookie, "not-a-uuid");
    expect(res.status).toBe(400);
  });
});
