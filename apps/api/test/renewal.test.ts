import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { leagueSeasons } from "@picksleagues/db";
import { FixedClock } from "@picksleagues/core";
import {
  JOIN_BLOCKED_REASON,
  LEAGUE_MODE,
  LEAGUE_STATUS,
  LEAGUE_VISIBILITY,
  MEMBER_ROLE,
  PICK_TYPE,
  SPORT,
  WEEK_TYPE,
  type LeagueResponse,
  type LeagueSettings,
} from "@picksleagues/schemas";
import { joinPublicLeague, renewLeagueSeason } from "../src/services/leagues";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import { DEFAULT_SURVIVOR_SETTINGS, insertLeague, seedSeason } from "./setup/league-helpers";
import { makeLeagueTestHarness } from "./setup/league-app";
import { resetDb } from "./setup/reset-db";

const { db, auth, app } = makeLeagueTestHarness();

// Distinct settings so "copied verbatim" is a real assertion, not a match
// against the default fixture.
const CUSTOM_SETTINGS: LeagueSettings = {
  startWeek: { type: WEEK_TYPE.REGULAR, number: 1 },
  endWeek: { type: WEEK_TYPE.REGULAR, number: 18 },
  pickType: PICK_TYPE.STRAIGHT_UP,
  picksPerWeek: 3,
};

const Y2026_KICKOFF = new Date("2026-09-13T17:00:00.000Z");
const Y2027_KICKOFF = new Date("2027-09-13T17:00:00.000Z");

function postRenew(cookie: string | undefined, leagueId: string) {
  return app.request(`/api/leagues/${leagueId}/seasons`, {
    method: "POST",
    headers: { ...(cookie ? { cookie } : {}) },
  });
}

function getLeague(cookie: string, leagueId: string) {
  return app.request(`/api/leagues/${leagueId}`, {
    method: "GET",
    headers: { cookie },
  });
}

function getMyLeagues(cookie: string) {
  return app.request("/api/leagues", { method: "GET", headers: { cookie } });
}

function patchLeagueSettings(cookie: string, leagueId: string, settings: unknown) {
  return app.request(`/api/leagues/${leagueId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ settings }),
  });
}

/** The settings blob on the instance bound to one season — renewal mints a second. */
async function settingsForSeason(leagueId: string, seasonId: string): Promise<unknown> {
  const rows = await db.select().from(leagueSeasons).where(eq(leagueSeasons.leagueId, leagueId));
  const row = rows.find((instance) => instance.seasonId === seasonId);
  if (!row) throw new Error(`no league_seasons row for league ${leagueId} on season ${seasonId}`);
  return row.settings;
}

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

describe("POST /api/leagues/:leagueId/seasons", () => {
  it("mints the next instance with settings copied verbatim, making it current", async () => {
    const { seasonId: y2026 } = await seedSeason(db, {
      year: 2026,
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: Y2026_KICKOFF }] }],
    });
    // Newer season with no games yet — startsAt must derive null (offseason).
    await seedSeason(db, { year: 2027, weeks: [{ weekNumber: 1, kickoffs: [] }] });
    const { user, cookie } = await createAuthenticatedUser(auth);
    const league = await insertLeague(db, {
      seasonId: y2026,
      settings: CUSTOM_SETTINGS,
      members: [{ userId: user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });

    const res = await postRenew(cookie, league.id);
    expect(res.status).toBe(201);
    const body = (await res.json()) as LeagueResponse;
    expect(body).toMatchObject({
      seasonYear: 2027,
      status: "active",
      startsAt: null,
      // The current instance is now the latest season — nothing left to renew.
      renewable: false,
    });
    expect(body.settings).toMatchObject({ picksPerWeek: 3 });

    const instances = await db
      .select()
      .from(leagueSeasons)
      .where(eq(leagueSeasons.leagueId, league.id));
    expect(instances).toHaveLength(2);
    const newInstance = instances.find((i) => i.seasonId !== y2026);
    expect(newInstance?.settings).toMatchObject({ picksPerWeek: 3 });
    expect(newInstance?.status).toBe("active");
  });

  it("concludes the instance it supersedes, leaving only the new one active", async () => {
    const { seasonId: y2026 } = await seedSeason(db, {
      year: 2026,
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: Y2026_KICKOFF }] }],
    });
    await seedSeason(db, { year: 2027, weeks: [{ weekNumber: 1, kickoffs: [] }] });
    const { user, cookie } = await createAuthenticatedUser(auth);
    const league = await insertLeague(db, {
      seasonId: y2026,
      members: [{ userId: user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });

    expect((await postRenew(cookie, league.id)).status).toBe(201);

    // The superseded instance is over whatever its own weeks say (ADR-0030) —
    // week 1 here never went final, and the old season still leaves the nightly
    // sweep's working set.
    const byYear = new Map(
      (await db.select().from(leagueSeasons).where(eq(leagueSeasons.leagueId, league.id))).map(
        (row) => [row.seasonId === y2026 ? 2026 : 2027, row.status],
      ),
    );
    expect(byYear.get(2026)).toBe(LEAGUE_STATUS.CONCLUDED);
    expect(byYear.get(2027)).toBe(LEAGUE_STATUS.ACTIVE);
  });

  it("flips a league's `renewable` false after renewal", async () => {
    const { seasonId: y2026 } = await seedSeason(db, {
      year: 2026,
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: Y2026_KICKOFF }] }],
    });
    await seedSeason(db, { year: 2027, weeks: [{ weekNumber: 1, kickoffs: [] }] });
    const { user, cookie } = await createAuthenticatedUser(auth);
    const league = await insertLeague(db, {
      seasonId: y2026,
      members: [{ userId: user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });

    const before = (await (await getLeague(cookie, league.id)).json()) as LeagueResponse;
    expect(before.renewable).toBe(true);

    expect((await postRenew(cookie, league.id)).status).toBe(201);

    const after = (await (await getLeague(cookie, league.id)).json()) as LeagueResponse;
    expect(after.renewable).toBe(false);
    expect(after.seasonYear).toBe(2027);
  });

  it("403s a plain member", async () => {
    const { seasonId: y2026 } = await seedSeason(db, { year: 2026, weeks: [] });
    await seedSeason(db, { year: 2027, weeks: [] });
    const owner = await createAuthenticatedUser(auth, { username: "owner" });
    const { user, cookie } = await createAuthenticatedUser(auth);
    const league = await insertLeague(db, {
      seasonId: y2026,
      members: [
        { userId: owner.user.id, role: MEMBER_ROLE.COMMISSIONER },
        { userId: user.id, role: MEMBER_ROLE.MEMBER },
      ],
    });

    const res = await postRenew(cookie, league.id);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "not_commissioner" });
  });

  it("404s a non-member so private leagues stay hidden", async () => {
    const { seasonId: y2026 } = await seedSeason(db, { year: 2026, weeks: [] });
    await seedSeason(db, { year: 2027, weeks: [] });
    const owner = await createAuthenticatedUser(auth, { username: "owner" });
    const { cookie } = await createAuthenticatedUser(auth);
    const league = await insertLeague(db, {
      seasonId: y2026,
      members: [{ userId: owner.user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });

    const res = await postRenew(cookie, league.id);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "league_not_found" });
  });

  it("409s when the league is already on the latest season", async () => {
    const { seasonId: y2026 } = await seedSeason(db, { year: 2026, weeks: [] });
    const { user, cookie } = await createAuthenticatedUser(auth);
    const league = await insertLeague(db, {
      seasonId: y2026,
      members: [{ userId: user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });

    const res = await postRenew(cookie, league.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "no_newer_season" });
  });

  it("401s without a session", async () => {
    const res = await postRenew(undefined, "00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(401);
  });
});

/**
 * The interaction ADR-0024 §Consequences calls out: renewal copies settings
 * verbatim for every mode (ADR-0009), so a Survivor league created mid-season
 * renews still carrying the week its old season resolved to — and the form has
 * no control left to correct it with. Re-resolution on the next pre-start save
 * is the remedy, and these pin both halves.
 */
describe("Survivor's resolved range across a renewal", () => {
  // Stale by construction: a league created in week 5 of the old season.
  const MID_SEASON_SETTINGS: LeagueSettings = {
    ...DEFAULT_SURVIVOR_SETTINGS,
    startWeek: { type: WEEK_TYPE.REGULAR, number: 5 },
  };

  async function seedSurvivorLeagueOn2026() {
    const { seasonId: y2026 } = await seedSeason(db, {
      year: 2026,
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: Y2026_KICKOFF }] }],
    });
    const { seasonId: y2027 } = await seedSeason(db, {
      year: 2027,
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: Y2027_KICKOFF }] }],
    });
    const { user, cookie } = await createAuthenticatedUser(auth);
    const league = await insertLeague(db, {
      seasonId: y2026,
      mode: LEAGUE_MODE.SURVIVOR,
      settings: MID_SEASON_SETTINGS,
      members: [{ userId: user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });
    return { league, cookie, y2026, y2027 };
  }

  it("copies the range verbatim — renewal re-resolves nothing", async () => {
    const { league, cookie, y2027 } = await seedSurvivorLeagueOn2026();

    expect((await postRenew(cookie, league.id)).status).toBe(201);

    expect(await settingsForSeason(league.id, y2027)).toEqual(MID_SEASON_SETTINGS);
  });

  it("re-resolves the copied range on the next pre-start settings save", async () => {
    const { league, cookie, y2027 } = await seedSurvivorLeagueOn2026();
    expect((await postRenew(cookie, league.id)).status).toBe(201);

    // The commissioner's only remaining range control is the act of saving:
    // resolution runs on every settings write, so the stale week 5 becomes the
    // new season's first still-ahead week.
    const res = await patchLeagueSettings(cookie, league.id, {
      pickType: PICK_TYPE.STRAIGHT_UP,
    });
    expect(res.status).toBe(200);

    expect(await settingsForSeason(league.id, y2027)).toMatchObject({
      startWeek: { type: WEEK_TYPE.REGULAR, number: 1 },
      endWeek: { type: WEEK_TYPE.REGULAR, number: 18 },
    });
  });
});

describe("renewLeagueSeason (service — concurrency & lock)", () => {
  const clock = new FixedClock(new Date("2027-06-01T00:00:00.000Z"));

  it("adds exactly one instance under two concurrent renewals", async () => {
    const { seasonId: y2026 } = await seedSeason(db, { year: 2026, weeks: [] });
    await seedSeason(db, { year: 2027, weeks: [] });
    const { user } = await createAuthenticatedUser(auth);
    const league = await insertLeague(db, {
      seasonId: y2026,
      members: [{ userId: user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });

    const [a, b] = await Promise.all([
      renewLeagueSeason(db, clock, league.id, user.id),
      renewLeagueSeason(db, clock, league.id, user.id),
    ]);
    // Exactly one succeeds; the loser gets the typed refusal, never a 500.
    const oks = [a, b].filter((r) => r.ok);
    const refused = [a, b].filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ ok: false, reason: "no_newer_season" });

    const instances = await db
      .select()
      .from(leagueSeasons)
      .where(eq(leagueSeasons.leagueId, league.id));
    expect(instances).toHaveLength(2);
  });

  it("re-targets the join window to the NEW instance after renewal", async () => {
    // Old 2026 season already kicked off; new 2027 season kicks off in the
    // future relative to the clock. Before renewal the league (on 2026) is
    // started → joins closed; after renewal (now on 2027) it is pre-start
    // again → joins open. That the join opens proves the cutoff derives from
    // the current instance, not a stale one.
    const { seasonId: y2026 } = await seedSeason(db, {
      year: 2026,
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: Y2026_KICKOFF }] }],
    });
    await seedSeason(db, {
      year: 2027,
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: Y2027_KICKOFF }] }],
    });
    const { user } = await createAuthenticatedUser(auth);
    const joiner = await createAuthenticatedUser(auth, { username: "joiner" });
    const league = await insertLeague(db, {
      seasonId: y2026,
      visibility: LEAGUE_VISIBILITY.PUBLIC,
      members: [{ userId: user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });

    // Pre-renewal: the 2026 instance has started under this clock — join closed.
    const preJoin = await joinPublicLeague(db, clock, league.id, joiner.user.id);
    expect(preJoin).toMatchObject({ ok: false, reason: JOIN_BLOCKED_REASON.JOIN_CLOSED });

    expect((await renewLeagueSeason(db, clock, league.id, user.id)).ok).toBe(true);

    // Post-renewal: the current instance is 2027, which hasn't kicked off yet.
    const postJoin = await joinPublicLeague(db, clock, league.id, joiner.user.id);
    expect(postJoin.ok).toBe(true);
  });
});

describe("renewable signal on reads", () => {
  it("reports renewable true in GET league and my-leagues when a newer season exists", async () => {
    const { seasonId: y2026 } = await seedSeason(db, { year: 2026, weeks: [] });
    await seedSeason(db, { year: 2027, weeks: [] });
    const { user, cookie } = await createAuthenticatedUser(auth);
    const league = await insertLeague(db, {
      seasonId: y2026,
      members: [{ userId: user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });

    const one = (await (await getLeague(cookie, league.id)).json()) as LeagueResponse;
    expect(one.renewable).toBe(true);

    const list = (await (await getMyLeagues(cookie)).json()) as {
      leagues: Array<{ id: string; renewable: boolean }>;
    };
    expect(list.leagues.find((l) => l.id === league.id)?.renewable).toBe(true);
  });

  it("reports renewable false when the league is already on the latest season", async () => {
    const { seasonId: y2026 } = await seedSeason(db, { year: 2026, weeks: [] });
    const { user, cookie } = await createAuthenticatedUser(auth);
    const league = await insertLeague(db, {
      seasonId: y2026,
      members: [{ userId: user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });

    const one = (await (await getLeague(cookie, league.id)).json()) as LeagueResponse;
    expect(one.renewable).toBe(false);

    const list = (await (await getMyLeagues(cookie)).json()) as {
      leagues: Array<{ id: string; renewable: boolean }>;
    };
    expect(list.leagues.find((l) => l.id === league.id)?.renewable).toBe(false);
  });

  it("does not cross sports: a newer NCAAMB season doesn't make an NFL league renewable", async () => {
    const { seasonId: y2026 } = await seedSeason(db, { year: 2026, weeks: [] });
    // A newer season for a DIFFERENT sport must not flip an NFL league's flag.
    await seedSeason(db, { sport: SPORT.NCAAMB, year: 2030, weeks: [] });
    const { user, cookie } = await createAuthenticatedUser(auth);
    const league = await insertLeague(db, {
      seasonId: y2026,
      members: [{ userId: user.id, role: MEMBER_ROLE.COMMISSIONER }],
    });

    const one = (await (await getLeague(cookie, league.id)).json()) as LeagueResponse;
    expect(one.renewable).toBe(false);
  });
});
