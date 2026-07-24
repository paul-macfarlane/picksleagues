import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { LEAGUE_STATUS, LEAGUE_VISIBILITY, type DiscoveryResponse } from "@picksleagues/schemas";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import { insertLeague, seedSeason } from "./setup/league-helpers";
import { makeLeagueTestHarness, WEEK1_KICKOFF, withCookie } from "./setup/league-app";
import { resetDb } from "./setup/reset-db";

const { db, auth, app, appAfterKickoff } = makeLeagueTestHarness();

type App = typeof app;

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

  it("excludes leagues the caller already belongs to", async () => {
    const { seasonId } = await seedActiveSeason();
    const viewer = await createAuthenticatedUser(auth, { username: "viewer" });
    const league = await insertLeague(db, {
      seasonId,
      name: "Already Joined",
      visibility: LEAGUE_VISIBILITY.PUBLIC,
      members: [{ userId: viewer.user.id, role: "member" }],
    });
    // A different public league the viewer hasn't joined stays visible.
    const other = await insertLeague(db, {
      seasonId,
      name: "Not Joined Yet",
      visibility: LEAGUE_VISIBILITY.PUBLIC,
    });

    const res = await getDiscovery(viewer.cookie);
    const body = (await res.json()) as DiscoveryResponse;
    expect(body.leagues.map((l) => l.id)).toEqual([other.id]);
    expect(body.leagues.map((l) => l.id)).not.toContain(league.id);
  });

  it("excludes a league at its member cap", async () => {
    const { seasonId } = await seedActiveSeason();
    const commissioner = await createAuthenticatedUser(auth, { username: "commish" });
    const member = await createAuthenticatedUser(auth, { username: "plain" });
    const full = await insertLeague(db, {
      seasonId,
      name: "Full League",
      visibility: LEAGUE_VISIBILITY.PUBLIC,
      maxMembers: 2,
      members: [
        { userId: commissioner.user.id, role: "commissioner" },
        { userId: member.user.id, role: "member" },
      ],
    });
    const viewer = await createAuthenticatedUser(auth, { username: "viewer" });

    const res = await getDiscovery(viewer.cookie);
    const body = (await res.json()) as DiscoveryResponse;
    expect(body.leagues.map((l) => l.id)).not.toContain(full.id);
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
