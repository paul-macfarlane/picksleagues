import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { leagueMembers, leagueSeasons, leagues } from "@picksleagues/db";
import { LEAGUE_STATUS, MEMBER_ROLE, SPORT, type LeagueResponse } from "@picksleagues/schemas";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import { DEFAULT_PICKEM_SETTINGS, insertLeague, seedSeason } from "./setup/league-helpers";
import { makeLeagueTestHarness, WEEK1_KICKOFF } from "./setup/league-app";
import { resetDb } from "./setup/reset-db";

const { db, auth, app, appAfterKickoff } = makeLeagueTestHarness();

const VALID_PICKEM_BODY = {
  mode: "pickem",
  name: "The Gridiron Gang",
  visibility: "private",
  settings: {
    startWeek: { type: "regular", number: 1 },
    endWeek: { type: "regular", number: 18 },
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

function getMyLeagues(cookie: string | undefined) {
  return app.request("/api/leagues", {
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
    expect(body.settings).toMatchObject({ picksPerWeek: 5, pushTieResolution: "half_point" });
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

  it("derives startsAt as null when the start week has no ingested games", async () => {
    await seedDefaultSeason();
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postLeague(cookie, {
      ...VALID_PICKEM_BODY,
      settings: { ...VALID_PICKEM_BODY.settings, startWeek: { type: "regular", number: 2 } },
    });
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
      label: "end week before start week",
      settings: {
        startWeek: { type: "regular", number: 5 },
        endWeek: { type: "regular", number: 4 },
        pickType: "straight_up",
      },
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

  it("400s on an elimination league with a postseason week", async () => {
    await seedDefaultSeason();
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postLeague(cookie, {
      mode: "elimination",
      name: "Survivors",
      visibility: "private",
      settings: {
        startWeek: { type: "regular", number: 1 },
        endWeek: { type: "postseason", number: 1 },
        pickType: "straight_up",
      },
    });
    expect(res.status).toBe(400);
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

  it("allows a passed calendar date when the start week has no ingested games yet", async () => {
    await seedDefaultSeason();
    const { cookie } = await createAuthenticatedUser(auth);

    // Week 2 has no games, so no start boundary exists yet — pre-start.
    const res = await postLeague(
      cookie,
      {
        ...VALID_PICKEM_BODY,
        settings: { ...VALID_PICKEM_BODY.settings, startWeek: { type: "regular", number: 2 } },
      },
      appAfterKickoff,
    );
    expect(res.status).toBe(201);
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
    });
  });

  it("returns an empty list for a user with no leagues", async () => {
    const { cookie } = await createAuthenticatedUser(auth);
    const res = await getMyLeagues(cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ leagues: [] });
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
