import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { leagueMembers, leagueSeasons, leagues, users } from "@picksleagues/db";
import {
  LEAGUE_MODE,
  LEAGUE_STATUS,
  MEMBER_ROLE,
  SPORT,
  SURVIVOR_EVERYONE_OUT,
  type LeagueResponse,
} from "@picksleagues/schemas";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import {
  DEFAULT_PICKEM_SETTINGS,
  DEFAULT_SURVIVOR_SETTINGS,
  insertLeague,
  membersOf,
  seasonIdFor,
  seedSeason,
} from "./setup/league-helpers";
import { insertSurvivorPick, insertSurvivorState } from "./setup/survivor-league";
import { makeLeagueTestHarness, WEEK1_KICKOFF } from "./setup/league-app";
import { resetDb } from "./setup/reset-db";

const { db, auth, app, appAfterKickoff } = makeLeagueTestHarness();

// The Pick'em wire shape names a season-range preset and no week refs
// (ADR-0020); the server resolves the range it stores.
const VALID_PICKEM_BODY = {
  mode: "pickem",
  name: "The Gridiron Gang",
  visibility: "private",
  settings: {
    seasonRangePreset: "regular_season",
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

  it("derives startsAt as null when no week in the preset's range has ingested games", async () => {
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
      label: "unknown season range preset",
      settings: { seasonRangePreset: "weeks_4_to_15", pickType: "straight_up" },
    },
    {
      label: "no season range preset",
      settings: { pickType: "straight_up" },
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
    // The range is the server's answer, not the request's (ADR-0024); the
    // push/tie default is the schema's.
    expect(body.settings).toMatchObject({
      startWeek: { type: "regular", number: 1 },
      endWeek: { type: "regular", number: 18 },
      pushTieResolution: "advance",
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

  it("409s march-madness creation while no NCAAMB season is ingested", async () => {
    await seedDefaultSeason();
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postLeague(cookie, {
      mode: "march_madness",
      name: "Bracket Bash",
      visibility: "public",
      settings: { scoringModel: "standard_doubling" },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "no_active_season" });
  });

  it("creates a march-madness league once an NCAAMB season exists", async () => {
    await seedSeason(db, { sport: SPORT.NCAAMB, year: 2027, weeks: [] });
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postLeague(cookie, {
      mode: "march_madness",
      name: "Bracket Bash",
      visibility: "public",
      settings: { scoringModel: "standard_doubling" },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as LeagueResponse;
    expect(body).toMatchObject({ mode: "march_madness", seasonYear: 2027, startsAt: null });
    expect(body.settings).toMatchObject({
      scoringModel: "standard_doubling",
      maxBracketsPerMember: 5,
    });
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
      // The glance is Survivor-shaped, so a Pick'em league carries none.
      survivorPickStatus: null,
    });
  });

  it("returns an empty list for a user with no leagues", async () => {
    const { cookie } = await createAuthenticatedUser(auth);
    const res = await getMyLeagues(cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ leagues: [] });
  });

  describe("survivorPickStatus", () => {
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

    async function readMyLeagues(cookie: string, on: typeof app = app) {
      const res = await getMyLeagues(cookie, on);
      expect(res.status).toBe(200);
      return (await res.json()) as { leagues: Array<Record<string, unknown>> };
    }

    it("asks for a pick while the week still holds an unstarted game", async () => {
      const { seasonId } = await seedGlanceSeason([WEEK1_KICKOFF]);
      const { user, cookie } = await createAuthenticatedUser(auth);
      await insertSurvivorLeagueFor(seasonId, user.id, "Survivor");

      const body = await readMyLeagues(cookie);
      expect(body.leagues[0]).toMatchObject({ survivorPickStatus: "pick_needed" });
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
      await insertSurvivorState(db, {
        leagueSeasonId: await seasonIdFor(db, league.id),
        leagueMemberId: members.get(beaten.user.id)!,
        eliminatedWeekId: weekIds.get("regular:1")!,
      });

      // The week is wide open, which is exactly what the season being decided
      // overrides (ADR-0027) — and the member they beat still reads as out.
      expect((await readMyLeagues(survivor.cookie)).leagues[0]).toMatchObject({
        survivorPickStatus: "won",
      });
      expect((await readMyLeagues(beaten.cookie)).leagues[0]).toMatchObject({
        survivorPickStatus: "eliminated",
      });
    });

    it("calls a co-winner a winner, not a member who is out", async () => {
      const { seasonId, weekIds } = await seedSeason(db, {
        weeks: [
          {
            weekNumber: 1,
            startsAt: GLANCE_WEEK_STARTS,
            endsAt: GLANCE_WEEK_ENDS,
            kickoffs: [{ kickoffAt: WEEK1_KICKOFF }],
          },
          { weekNumber: 2, kickoffs: [{ kickoffAt: LATE_KICKOFF }] },
        ],
      });
      const coWinner = await createAuthenticatedUser(auth);
      const beaten = await createAuthenticatedUser(auth);
      const league = await insertLeague(db, {
        seasonId,
        name: "Survivor",
        mode: LEAGUE_MODE.SURVIVOR,
        settings: { ...DEFAULT_SURVIVOR_SETTINGS, everyoneOut: SURVIVOR_EVERYONE_OUT.CO_WIN },
        members: [
          { userId: coWinner.user.id, role: MEMBER_ROLE.COMMISSIONER },
          { userId: beaten.user.id, role: MEMBER_ROLE.MEMBER },
        ],
      });
      const members = await membersOf(db, league.id);
      const leagueSeasonId = await seasonIdFor(db, league.id);
      // The ledger a co-win league leaves behind: nobody is alive, and the
      // member who went out last is the one who won it (ADR-0028).
      await insertSurvivorState(db, {
        leagueSeasonId,
        leagueMemberId: members.get(beaten.user.id)!,
        eliminatedWeekId: weekIds.get("regular:1")!,
      });
      await insertSurvivorState(db, {
        leagueSeasonId,
        leagueMemberId: members.get(coWinner.user.id)!,
        eliminatedWeekId: weekIds.get("regular:2")!,
      });

      // The winner is an eliminated member here, which is the whole point: an
      // elimination-first glance would tell them they are out of a season they
      // just won.
      expect((await readMyLeagues(coWinner.cookie)).leagues[0]).toMatchObject({
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
