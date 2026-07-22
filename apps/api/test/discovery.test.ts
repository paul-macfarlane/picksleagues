import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@picksleagues/db";
import { FixedClock, type Env } from "@picksleagues/core";
import { LEAGUE_STATUS, LEAGUE_VISIBILITY, type DiscoveryResponse } from "@picksleagues/schemas";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import { insertLeague, seedSeason } from "./setup/league-helpers";
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

const WEEK1_KICKOFF = new Date("2026-09-13T17:00:00.000Z");
// Two apps over the same DB: one with the clock before the seeded kickoff,
// one after — discovery excludes a league once its start has passed, and the
// cutoff is derived per-request from the clock (arch §Locking Model).
const PRE_START_NOW = new Date("2026-09-01T00:00:00.000Z");
const POST_START_NOW = new Date("2026-09-13T17:00:00.001Z");

const db = createDb(getTestDatabaseUrl());
const auth = createAuth({ env: testEnv, db });
const app = createApp({ auth, db, clock: async () => new FixedClock(PRE_START_NOW) });
const appAfterKickoff = createApp({
  auth,
  db,
  clock: async () => new FixedClock(POST_START_NOW),
});

type App = typeof app;

function withCookie(cookie: string | undefined): Record<string, string> {
  return cookie ? { cookie } : {};
}

function getDiscovery(cookie: string | undefined, q?: string, on: App = app) {
  const query = q !== undefined ? `?q=${q}` : "";
  return on.request(`/api/discovery${query}`, { method: "GET", headers: withCookie(cookie) });
}

async function seedActiveSeason() {
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

describe("GET /api/discovery", () => {
  it("401s without a session", async () => {
    expect((await getDiscovery(undefined)).status).toBe(401);
  });

  it("lists public, active, pre-cutoff leagues with memberCount/seasonYear/startsAt", async () => {
    const { seasonId } = await seedActiveSeason();
    const commissioner = await createAuthenticatedUser(auth, { username: "commish" });
    const member = await createAuthenticatedUser(auth, { username: "plain" });
    const league = await insertLeague(db, {
      seasonId,
      name: "Public League",
      visibility: LEAGUE_VISIBILITY.PUBLIC,
      members: [
        { userId: commissioner.user.id, role: "commissioner" },
        { userId: member.user.id, role: "member" },
      ],
    });
    const viewer = await createAuthenticatedUser(auth, { username: "viewer" });

    const res = await getDiscovery(viewer.cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DiscoveryResponse;
    expect(body.leagues).toHaveLength(1);
    expect(body.leagues[0]).toMatchObject({
      id: league.id,
      name: "Public League",
      mode: "pickem",
      memberCount: 2,
      seasonYear: 2026,
      startsAt: WEEK1_KICKOFF.toISOString(),
    });
    expect(body.leagues[0]).not.toHaveProperty("visibility");
    expect(body.leagues[0]).not.toHaveProperty("settings");
    expect(body.leagues[0]).not.toHaveProperty("members");
  });

  it("excludes private leagues", async () => {
    const { seasonId } = await seedActiveSeason();
    await insertLeague(db, {
      seasonId,
      name: "Private League",
      visibility: LEAGUE_VISIBILITY.PRIVATE,
    });
    const viewer = await createAuthenticatedUser(auth, { username: "viewer" });

    const res = await getDiscovery(viewer.cookie);
    const body = (await res.json()) as DiscoveryResponse;
    expect(body.leagues).toHaveLength(0);
  });

  it("excludes concluded leagues", async () => {
    const { seasonId } = await seedActiveSeason();
    await insertLeague(db, {
      seasonId,
      name: "Concluded League",
      visibility: LEAGUE_VISIBILITY.PUBLIC,
      status: LEAGUE_STATUS.CONCLUDED,
    });
    const viewer = await createAuthenticatedUser(auth, { username: "viewer" });

    const res = await getDiscovery(viewer.cookie);
    const body = (await res.json()) as DiscoveryResponse;
    expect(body.leagues).toHaveLength(0);
  });

  it("excludes a league whose start week has kicked off", async () => {
    const { seasonId } = await seedActiveSeason();
    await insertLeague(db, {
      seasonId,
      name: "Started League",
      visibility: LEAGUE_VISIBILITY.PUBLIC,
    });
    const viewer = await createAuthenticatedUser(auth, { username: "viewer" });

    const res = await getDiscovery(viewer.cookie, undefined, appAfterKickoff);
    const body = (await res.json()) as DiscoveryResponse;
    expect(body.leagues).toHaveLength(0);
  });

  it("includes a public league whose start week has no ingested games (pre-start)", async () => {
    const { seasonId } = await seedSeason(db, {
      year: 2026,
      weeks: [{ weekNumber: 1, kickoffs: [] }],
    });
    const league = await insertLeague(db, {
      seasonId,
      name: "No Games Yet",
      visibility: LEAGUE_VISIBILITY.PUBLIC,
    });
    const viewer = await createAuthenticatedUser(auth, { username: "viewer" });

    const res = await getDiscovery(viewer.cookie, undefined, appAfterKickoff);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DiscoveryResponse;
    expect(body.leagues).toHaveLength(1);
    expect(body.leagues[0]).toMatchObject({ id: league.id, startsAt: null });
  });

  describe("?q= name search", () => {
    it("matches case-insensitively by substring", async () => {
      const { seasonId } = await seedActiveSeason();
      const league = await insertLeague(db, {
        seasonId,
        name: "Sunday Ballers",
        visibility: LEAGUE_VISIBILITY.PUBLIC,
      });
      await insertLeague(db, {
        seasonId,
        name: "Monday Night Crew",
        visibility: LEAGUE_VISIBILITY.PUBLIC,
      });
      const viewer = await createAuthenticatedUser(auth, { username: "viewer" });

      const res = await getDiscovery(viewer.cookie, "ballers");
      const body = (await res.json()) as DiscoveryResponse;
      expect(body.leagues).toHaveLength(1);
      expect(body.leagues[0]?.id).toBe(league.id);
    });

    it("returns empty for no match", async () => {
      const { seasonId } = await seedActiveSeason();
      await insertLeague(db, {
        seasonId,
        name: "Sunday Ballers",
        visibility: LEAGUE_VISIBILITY.PUBLIC,
      });
      const viewer = await createAuthenticatedUser(auth, { username: "viewer" });

      const res = await getDiscovery(viewer.cookie, "nonexistent");
      const body = (await res.json()) as DiscoveryResponse;
      expect(body.leagues).toHaveLength(0);
    });

    it("treats a literal % in the query as a literal character, not a wildcard", async () => {
      const { seasonId } = await seedActiveSeason();
      const literalMatch = await insertLeague(db, {
        seasonId,
        name: "100% Legit",
        visibility: LEAGUE_VISIBILITY.PUBLIC,
      });
      await insertLeague(db, {
        seasonId,
        name: "Fully Legit",
        visibility: LEAGUE_VISIBILITY.PUBLIC,
      });
      const viewer = await createAuthenticatedUser(auth, { username: "viewer" });

      // Decodes to "% Legit" — a substring of "100% Legit" only if the `%` is
      // matched literally rather than treated as ILIKE's own wildcard.
      const res = await getDiscovery(viewer.cookie, encodeURIComponent("% Legit"));
      const body = (await res.json()) as DiscoveryResponse;
      expect(body.leagues).toHaveLength(1);
      expect(body.leagues[0]?.id).toBe(literalMatch.id);
    });
  });
});
