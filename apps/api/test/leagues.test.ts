import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, leagueMembers, leagues, leagueSettings } from "@picksleagues/db";
import { FixedClock, type Env } from "@picksleagues/core";
import { LEAGUE_STATUS, MEMBER_ROLE, SPORT, type LeagueResponse } from "@picksleagues/schemas";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import { DEFAULT_PICKEM_SETTINGS, insertLeague, seedSeason } from "./setup/league-helpers";
import { resetDb } from "./setup/reset-db";
import { getTestDatabaseUrl } from "./setup/test-database-url";

const testEnv: Env = {
  APP_ENV: "local",
  DATABASE_URL: getTestDatabaseUrl(),
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "google-id",
  GOOGLE_CLIENT_SECRET: "google-secret",
  DISCORD_CLIENT_ID: "discord-id",
  DISCORD_CLIENT_SECRET: "discord-secret",
  JOB_SECRET: "b".repeat(32),
  ADMIN_USER_IDS: [],
};

// Pre-start relative to the seeded week-1 kickoffs below (2026-09-13).
const FIXED_NOW = new Date("2026-09-01T00:00:00.000Z");
const WEEK1_KICKOFF = new Date("2026-09-13T17:00:00.000Z");

const db = createDb(getTestDatabaseUrl());
const auth = createAuth({ env: testEnv, db });
const app = createApp({ auth, db, clock: async () => new FixedClock(FIXED_NOW) });

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

function postLeague(cookie: string | undefined, body: Record<string, unknown>) {
  return app.request("/api/leagues", {
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

    const [settingsRow] = await db
      .select()
      .from(leagueSettings)
      .where(eq(leagueSettings.leagueId, body.id));
    expect(settingsRow?.settings).toMatchObject({ picksPerWeek: 5 });
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

  it("does not count concluded leagues toward the cap", async () => {
    const { seasonId } = await seedDefaultSeason();
    const { user, cookie } = await createAuthenticatedUser(auth);
    for (let i = 0; i < 9; i++) {
      await insertLeague(db, {
        seasonId,
        name: `League ${i}`,
        members: [{ userId: user.id, role: MEMBER_ROLE.COMMISSIONER }],
      });
    }
    await insertLeague(db, {
      seasonId,
      name: "Done League",
      status: LEAGUE_STATUS.CONCLUDED,
      members: [{ userId: user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });

    const res = await postLeague(cookie, VALID_PICKEM_BODY);
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
