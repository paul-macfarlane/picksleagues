import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  LEAGUE_MODE,
  LEAGUE_STATUS,
  LEAGUE_VISIBILITY,
  PICK_TYPE,
  type DiscoveryResponse,
} from "@picksleagues/schemas";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import {
  DEFAULT_PICKEM_SETTINGS,
  DEFAULT_SURVIVOR_SETTINGS,
  insertLeague,
  seedSeason,
} from "./setup/league-helpers";
import { makeLeagueTestHarness, WEEK1_KICKOFF, withCookie } from "./setup/league-app";
import { resetDb } from "./setup/reset-db";

const { db, auth, app, appAfterKickoff } = makeLeagueTestHarness();

type App = typeof app;

function getDiscovery(cookie: string | undefined, q?: string, on: App = app) {
  const query = q !== undefined ? `?q=${q}` : "";
  return on.request(`/api/discovery${query}`, { method: "GET", headers: withCookie(cookie) });
}

function getDiscoveryWith(cookie: string, params: Record<string, string | number>, on: App = app) {
  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]): [string, string] => [key, String(value)]),
  );
  return on.request(`/api/discovery?${query}`, { method: "GET", headers: withCookie(cookie) });
}

async function discoveryBody(res: Response): Promise<DiscoveryResponse> {
  expect(res.status).toBe(200);
  return (await res.json()) as DiscoveryResponse;
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

  describe("pre-join settings summary (FB-35)", () => {
    it("carries the Pick'em pick type and picks per week, never the raw settings blob", async () => {
      const { seasonId } = await seedActiveSeason();
      await insertLeague(db, {
        seasonId,
        name: "ATS League",
        visibility: LEAGUE_VISIBILITY.PUBLIC,
        settings: {
          ...DEFAULT_PICKEM_SETTINGS,
          pickType: PICK_TYPE.AGAINST_THE_SPREAD,
          picksPerWeek: 7,
        },
      });
      const viewer = await createAuthenticatedUser(auth, { username: "viewer" });

      const body = await discoveryBody(await getDiscovery(viewer.cookie));
      expect(body.leagues[0]?.pickemSettings).toEqual({
        pickType: PICK_TYPE.AGAINST_THE_SPREAD,
        picksPerWeek: 7,
      });
      // The summary is chosen, not forwarded: this DTO reaches non-members, so
      // the stored blob (which carries the resolved week range) stays off it.
      expect(body.leagues[0]).not.toHaveProperty("settings");
    });

    it("is null for a Survivor league, which has no member-facing setting to show", async () => {
      const { seasonId } = await seedActiveSeason();
      await insertLeague(db, {
        seasonId,
        name: "Survivor League",
        mode: LEAGUE_MODE.SURVIVOR,
        visibility: LEAGUE_VISIBILITY.PUBLIC,
        settings: DEFAULT_SURVIVOR_SETTINGS,
      });
      const viewer = await createAuthenticatedUser(auth, { username: "viewer" });

      const body = await discoveryBody(await getDiscovery(viewer.cookie));
      expect(body.leagues[0]?.pickemSettings).toBeNull();
    });
  });

  describe("?mode= filter (FB-36)", () => {
    it("returns only leagues of the named mode, and all modes without it", async () => {
      const { seasonId } = await seedActiveSeason();
      const pickem = await insertLeague(db, {
        seasonId,
        name: "Pickem League",
        visibility: LEAGUE_VISIBILITY.PUBLIC,
      });
      const survivor = await insertLeague(db, {
        seasonId,
        name: "Survivor League",
        mode: LEAGUE_MODE.SURVIVOR,
        visibility: LEAGUE_VISIBILITY.PUBLIC,
        settings: DEFAULT_SURVIVOR_SETTINGS,
      });
      const viewer = await createAuthenticatedUser(auth, { username: "viewer" });

      const filtered = await discoveryBody(
        await getDiscoveryWith(viewer.cookie, { mode: LEAGUE_MODE.SURVIVOR }),
      );
      expect(filtered.leagues.map((l) => l.id)).toEqual([survivor.id]);
      expect(filtered.total).toBe(1);

      const unfiltered = await discoveryBody(await getDiscovery(viewer.cookie));
      expect(unfiltered.leagues.map((l) => l.id).sort()).toEqual([pickem.id, survivor.id].sort());
    });

    it("400s on a mode that isn't a league mode", async () => {
      const viewer = await createAuthenticatedUser(auth, { username: "viewer" });
      expect((await getDiscoveryWith(viewer.cookie, { mode: "cricket" })).status).toBe(400);
    });
  });

  describe("ordering and paging (FB-37, FB-39)", () => {
    // Distinct capacities, so "fullest first" has one correct answer rather
    // than depending on which tiebreak fires.
    async function seedLeaguesWithSpace(spaces: number[]) {
      const { seasonId } = await seedActiveSeason();
      const ids: string[] = [];
      for (const [index, space] of spaces.entries()) {
        const filler = await createAuthenticatedUser(auth, { username: `filler${index}` });
        const league = await insertLeague(db, {
          seasonId,
          name: `League with ${space} free`,
          visibility: LEAGUE_VISIBILITY.PUBLIC,
          // One seeded member, so remaining space is `maxMembers - 1`.
          maxMembers: space + 1,
          members: [{ userId: filler.user.id, role: "commissioner" }],
        });
        ids.push(league.id);
      }
      return ids;
    }

    it("orders by remaining space, fullest first", async () => {
      const [roomy, tight, middling] = await seedLeaguesWithSpace([9, 1, 4]);
      const viewer = await createAuthenticatedUser(auth, { username: "viewer" });

      const body = await discoveryBody(await getDiscovery(viewer.cookie));
      expect(body.leagues.map((l) => l.id)).toEqual([tight, middling, roomy]);
      expect(body.leagues.map((l) => l.maxMembers - l.memberCount)).toEqual([1, 4, 9]);
    });

    it("serves 10 per page and reports the totals", async () => {
      // Spaces 1..12, so page order is fully determined and page 2 holds the
      // two roomiest.
      const ids = await seedLeaguesWithSpace([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      const viewer = await createAuthenticatedUser(auth, { username: "viewer" });

      const first = await discoveryBody(await getDiscovery(viewer.cookie));
      expect(first).toMatchObject({ page: 1, pageSize: 10, total: 12, totalPages: 2 });
      expect(first.leagues.map((l) => l.id)).toEqual(ids.slice(0, 10));

      const second = await discoveryBody(await getDiscoveryWith(viewer.cookie, { page: 2 }));
      expect(second).toMatchObject({ page: 2, total: 12, totalPages: 2 });
      expect(second.leagues.map((l) => l.id)).toEqual(ids.slice(10));
    });

    it("clamps a page past the end to the last page rather than serving nothing", async () => {
      const ids = await seedLeaguesWithSpace([1, 2]);
      const viewer = await createAuthenticatedUser(auth, { username: "viewer" });

      const body = await discoveryBody(await getDiscoveryWith(viewer.cookie, { page: 99 }));
      expect(body.page).toBe(1);
      expect(body.leagues.map((l) => l.id)).toEqual(ids);
    });

    it("pages the filtered set, so a page can never come up short", async () => {
      const { seasonId } = await seedActiveSeason();
      // Eleven public leagues, one of them already full — the full one is
      // filtered out *before* the cut, so page 1 still holds ten.
      for (let index = 0; index < 10; index += 1) {
        await insertLeague(db, {
          seasonId,
          name: `Open ${index}`,
          visibility: LEAGUE_VISIBILITY.PUBLIC,
          maxMembers: 10,
        });
      }
      const capped = await createAuthenticatedUser(auth, { username: "capped" });
      const cappedMember = await createAuthenticatedUser(auth, { username: "capped2" });
      await insertLeague(db, {
        seasonId,
        name: "Full",
        visibility: LEAGUE_VISIBILITY.PUBLIC,
        // The floor is 2 (`leagues_max_members_range`), so "full" is two of two.
        maxMembers: 2,
        members: [
          { userId: capped.user.id, role: "commissioner" },
          { userId: cappedMember.user.id, role: "member" },
        ],
      });
      const viewer = await createAuthenticatedUser(auth, { username: "viewer" });

      const body = await discoveryBody(await getDiscovery(viewer.cookie));
      expect(body.leagues).toHaveLength(10);
      expect(body.total).toBe(10);
      expect(body.totalPages).toBe(1);
      expect(body.leagues.map((l) => l.name)).not.toContain("Full");
    });

    it("400s on a page below 1", async () => {
      const viewer = await createAuthenticatedUser(auth, { username: "viewer" });
      expect((await getDiscoveryWith(viewer.cookie, { page: 0 })).status).toBe(400);
    });
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
