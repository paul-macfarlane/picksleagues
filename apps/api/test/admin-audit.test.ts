import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { adminAudit, createDb, leagues as leaguesTable } from "@picksleagues/db";
import { FixedClock } from "@picksleagues/core";
import {
  ADMIN_AUDIT_ACTION,
  ADMIN_AUDIT_TARGET_TABLE,
  SURVIVOR_PUSH_TIE_RESOLUTION,
  GAME_STATUS,
  LEAGUE_MODE,
  MEMBER_ROLE,
  PICKEM_PICK_SIDE,
  PICK_TYPE,
  WEEK_TYPE,
  type AdminAuditResponse,
} from "@picksleagues/schemas";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { settlePicksForGames, settleSweep } from "../src/services/pickem/settlement";
import { settleForSim } from "../src/services/sim/settle";
import { createAuthenticatedUser, grantAdmin } from "./setup/auth-helpers";
import { insertLeague, insertPick, seedSeason, setGame } from "./setup/league-helpers";
import { seedPickemLeague } from "./setup/pickem-league";
import { resetDb } from "./setup/reset-db";
import { getTestDatabaseUrl } from "./setup/test-database-url";
import { makeTestEnv } from "./setup/test-env";

/**
 * The admin audit trail (ADM-3; engineering rules §Data: "every
 * override/rebuild writes `admin_audit`") — both halves of it.
 *
 * The write half: one row per admin rebuild naming the league season it
 * recomputed, a prior value describing the derived state that rebuild was about
 * to wipe, and silence from every *other* caller of the same settlement path —
 * the nightly sweep, ingestion, and the simulator settle seasons on their own
 * schedule, and auditing them would bury the admin actions the trail exists to
 * show.
 *
 * The read half: `GET /admin/audit`, which must show who/what/when/prior value
 * newest-first, keep returning a row whose target has since been deleted, and
 * page the whole trail without dropping or repeating a row across a boundary.
 */

const NOW = new Date("2026-09-20T00:00:00.000Z");
// A second instant, so two admin actions can be ordered by *when* they happened
// rather than by the id tiebreak — the fixed clock stamps everything a single
// request does with the same `createdAt`.
const LATER = new Date("2026-09-20T00:05:00.000Z");
const KICKOFF = new Date("2026-09-13T17:00:00.000Z");

const db = createDb(getTestDatabaseUrl());
const auth = createAuth({ env: makeTestEnv(), db });
const clock = new FixedClock(NOW);

function buildAppAt(now: Date) {
  return createApp({ auth, db, env: makeTestEnv(), clock: async () => new FixedClock(now) });
}

function buildApp() {
  return createApp({ auth, db, env: makeTestEnv(), clock: async () => clock });
}

type App = ReturnType<typeof buildApp>;

async function adminCaller(overrides: { displayName?: string; username?: string } = {}) {
  const { user, cookie } = await createAuthenticatedUser(auth, overrides);
  await grantAdmin(db, user.id);
  return { app: buildApp(), cookie, userId: user.id };
}

function auditRows() {
  return db.select().from(adminAudit);
}

function rebuild(app: App, cookie: string, leagueId: string) {
  return app.request(`/api/admin/leagues/${leagueId}/rebuild`, {
    method: "POST",
    headers: { cookie },
  });
}

function setOverride(app: App, cookie: string, gameId: string, body: Record<string, unknown>) {
  return app.request(`/api/admin/games/${gameId}/override`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getAudit(app: App, cookie: string, query = "") {
  return app.request(`/api/admin/audit${query}`, { headers: { cookie } });
}

async function readAudit(app: App, cookie: string, query = ""): Promise<AdminAuditResponse> {
  const res = await getAudit(app, cookie, query);
  expect(res.status).toBe(200);
  return (await res.json()) as AdminAuditResponse;
}

/**
 * N rows sharing one `createdAt`, inserted directly: the paging assertions are
 * about the list query, and driving 30 real overrides through settlement would
 * pay for that several times over. One instant across all of them is the point
 * — it leaves the `id` tiebreak as the only thing ordering the page, which is
 * exactly the ordering a page boundary depends on.
 */
async function insertAuditRows(adminUserId: string, targetId: string, howMany: number) {
  await db.insert(adminAudit).values(
    Array.from({ length: howMany }, (_unused, index) => ({
      adminUserId,
      action: ADMIN_AUDIT_ACTION.GAME_OVERRIDE,
      targetTable: ADMIN_AUDIT_TARGET_TABLE.GAMES,
      targetId,
      priorValue: { seq: index },
      createdAt: NOW,
    })),
  );
}

/**
 * One week of two games and two members, with both members' picks on the first
 * game already settled. The second game is left unpicked so a test can add
 * picks to it and change what the *next* rebuild finds standing.
 */
async function seedSettledLeague() {
  const seeded = await seedPickemLeague(db, auth, {
    weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: KICKOFF }, { kickoffAt: KICKOFF }] }],
    members: [{ username: "home_picker" }, { username: "away_picker" }],
  });
  const weekId = seeded.weekIds.get("regular:1")!;
  const weekGameIds = seeded.gameIds.get("regular:1")!;
  const firstGameId = weekGameIds[0]!;
  const secondGameId = weekGameIds[1]!;
  const homePicker = seeded.members.get(seeded.users[0]!.user.id)!;
  const awayPicker = seeded.members.get(seeded.users[1]!.user.id)!;

  for (const [leagueMemberId, side] of [
    [homePicker, PICKEM_PICK_SIDE.HOME],
    [awayPicker, PICKEM_PICK_SIDE.AWAY],
  ] as const) {
    await insertPick(db, {
      leagueSeasonId: seeded.leagueSeasonId,
      leagueMemberId,
      weekId,
      gameId: firstGameId,
      side,
    });
  }
  await setGame(db, firstGameId, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 });
  await settlePicksForGames(db, clock, [firstGameId]);

  return { ...seeded, weekId, firstGameId, secondGameId, homePicker, awayPicker };
}

/** Picks the second game for both members and finalizes it — one more graded game per member. */
async function pickSecondGame(seeded: Awaited<ReturnType<typeof seedSettledLeague>>) {
  for (const [leagueMemberId, side] of [
    [seeded.homePicker, PICKEM_PICK_SIDE.HOME],
    [seeded.awayPicker, PICKEM_PICK_SIDE.AWAY],
  ] as const) {
    await insertPick(db, {
      leagueSeasonId: seeded.leagueSeasonId,
      leagueMemberId,
      weekId: seeded.weekId,
      gameId: seeded.secondGameId,
      side,
    });
  }
  await setGame(db, seeded.secondGameId, {
    status: GAME_STATUS.FINAL,
    homeScore: 17,
    awayScore: 20,
  });
}

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

describe("POST /api/admin/leagues/{leagueId}/rebuild — audit trail", () => {
  it("records who rebuilt which league season, and what stood there before", async () => {
    const { app, cookie, userId } = await adminCaller();
    const { league, leagueSeasonId } = await seedSettledLeague();

    const res = await rebuild(app, cookie, league.id);

    expect(res.status).toBe(200);
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      adminUserId: userId,
      action: ADMIN_AUDIT_ACTION.LEAGUE_REBUILD,
      targetTable: ADMIN_AUDIT_TARGET_TABLE.LEAGUE_SEASONS,
      targetId: leagueSeasonId,
      createdAt: NOW,
    });
    // The derived state the rebuild wiped: one result per pick, a weekly board
    // and a season board per member, both last written at the settle above.
    expect(rows[0]!.priorValue).toEqual({
      resultCount: 2,
      standingsRowCount: 4,
      lastSettledAt: NOW.toISOString(),
      lastStandingsUpdatedAt: NOW.toISOString(),
    });
  });

  it("captures each rebuild's own prior state, so the second row shows the first's output", async () => {
    const { app, cookie } = await adminCaller();
    const seeded = await seedSettledLeague();
    // Only the first game was graded when the fixture settled; these picks are
    // what the first rebuild adds, and therefore what the second one replaces.
    await pickSecondGame(seeded);

    await rebuild(app, cookie, seeded.league.id);
    await rebuild(app, cookie, seeded.league.id);

    const rows = await auditRows();
    expect(rows).toHaveLength(2);
    // Both rows share the fixed clock's `createdAt`, so they're identified by
    // the state each recorded rather than by ordering.
    expect(rows.map((row) => row.priorValue.resultCount).sort()).toEqual([2, 4]);
    expect(new Set(rows.map((row) => row.targetId))).toEqual(new Set([seeded.leagueSeasonId]));
  });

  it("writes no row for a league whose mode settlement doesn't grade", async () => {
    const { app, cookie, userId } = await adminCaller();
    const { seasonId } = await seedSeason(db, {
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: KICKOFF }] }],
    });
    const league = await insertLeague(db, {
      seasonId,
      mode: LEAGUE_MODE.SURVIVOR,
      settings: {
        startWeek: { type: WEEK_TYPE.REGULAR, number: 1 },
        endWeek: { type: WEEK_TYPE.REGULAR, number: 18 },
        pickType: PICK_TYPE.STRAIGHT_UP,
        pushTieResolution: SURVIVOR_PUSH_TIE_RESOLUTION.ADVANCE,
      },
      members: [{ userId, role: MEMBER_ROLE.COMMISSIONER }],
    });

    const res = await rebuild(app, cookie, league.id);

    // Nothing was recomputed, so there is no prior value to record honestly.
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ details: { leagueSeasons: 0 } });
    expect(await auditRows()).toHaveLength(0);
  });

  it("stays silent when the sweep, ingestion, or the simulator settles the same season", async () => {
    const { app, cookie } = await adminCaller();
    const { league, leagueSeasonId, firstGameId } = await seedSettledLeague();
    await rebuild(app, cookie, league.id);
    expect(await auditRows()).toHaveLength(1);

    const sweep = await settleSweep(db, clock);
    const ingestion = await settlePicksForGames(db, clock, [firstGameId]);
    const sim = await settleForSim(db, clock, {});

    // Each caller really did settle this season — a caller that silently
    // settled nothing would pass the row-count assertion for the wrong reason.
    expect(sweep).toMatchObject({ leagueSeasons: 1 });
    expect(ingestion).toMatchObject({ leagueSeasons: 1 });
    expect(sim).toMatchObject({ ok: true, response: { leagues: [{ leagueSeasonId }] } });
    expect(await auditRows()).toHaveLength(1);
  });
});

describe("GET /api/admin/audit", () => {
  it("401s with no session cookie", async () => {
    const res = await getAudit(buildApp(), "");

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("403s for a signed-in non-admin caller", async () => {
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await getAudit(buildApp(), cookie);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "not_admin" });
  });

  it("lists both kinds of admin action newest-first, with actor, target label and prior value", async () => {
    const { app, cookie } = await adminCaller({
      displayName: "Ada Admin",
      username: "ada_admin",
    });
    const seeded = await seedSettledLeague();

    const overrideRes = await setOverride(app, cookie, seeded.secondGameId, {
      homeScore: 31,
      awayScore: 17,
    });
    expect(overrideRes.status).toBe(200);
    // Five minutes later, so the two rows are ordered by when they happened.
    const rebuildRes = await rebuild(buildAppAt(LATER), cookie, seeded.league.id);
    expect(rebuildRes.status).toBe(200);

    const body = await readAudit(app, cookie);

    expect(body).toMatchObject({ total: 2, limit: 25, offset: 0 });
    expect(body.entries).toHaveLength(2);
    const [newest, oldest] = body.entries;
    expect(newest).toMatchObject({
      admin: { displayName: "Ada Admin", username: "ada_admin" },
      action: "league_rebuild",
      targetTable: "league_seasons",
      targetId: seeded.leagueSeasonId,
      // The league's own name plus its season year — a bare UUID answers
      // "what happened" for nobody.
      targetLabel: "Test League 2026",
      createdAt: LATER.toISOString(),
    });
    expect(oldest).toMatchObject({
      action: "game_override",
      targetTable: "games",
      targetId: seeded.secondGameId,
      targetLabel: "AWY @ HOM",
      createdAt: NOW.toISOString(),
    });
    // Round-tripped verbatim: the game had no override before this one, and the
    // trail's whole job is saying what stood there.
    expect(oldest?.priorValue).toMatchObject({
      overrideHomeScore: null,
      overrideAwayScore: null,
      overrideStatus: null,
      overrideKickoffAt: null,
    });
    expect(newest?.priorValue).toMatchObject({ resultCount: 2, standingsRowCount: 4 });
  });

  it("still returns a row whose target has been deleted, with no label", async () => {
    const { app, cookie } = await adminCaller();
    const seeded = await seedSettledLeague();
    await rebuild(app, cookie, seeded.league.id);

    // The league season cascades away with its league; the audit row does not
    // (the restrict FK is on the actor, not the target). A label resolved by
    // joining would drop exactly this row.
    await db.delete(leaguesTable).where(eq(leaguesTable.id, seeded.league.id));

    const body = await readAudit(app, cookie);

    expect(body.total).toBe(1);
    expect(body.entries[0]).toMatchObject({
      action: "league_rebuild",
      targetId: seeded.leagueSeasonId,
      targetLabel: null,
    });
  });

  it("pages the whole trail without dropping or repeating a row", async () => {
    const { app, cookie, userId } = await adminCaller();
    const { gameIds } = await seedSeason(db, {
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: KICKOFF }] }],
    });
    await insertAuditRows(userId, gameIds.get("regular:1")![0]!, 30);

    const firstPage = await readAudit(app, cookie);
    expect(firstPage).toMatchObject({ total: 30, limit: 25, offset: 0 });
    expect(firstPage.entries).toHaveLength(25);

    const everything = await readAudit(app, cookie, "?limit=100");
    const allIds = everything.entries.map((entry) => entry.id);
    expect(allIds).toHaveLength(30);

    const pageOne = await readAudit(app, cookie, "?limit=10&offset=0");
    const pageTwo = await readAudit(app, cookie, "?limit=10&offset=10");
    expect(pageTwo).toMatchObject({ total: 30, limit: 10, offset: 10 });
    // No gap and no overlap across the boundary: page two picks up exactly
    // where page one stopped in the full ordering.
    expect(pageOne.entries.map((entry) => entry.id)).toEqual(allIds.slice(0, 10));
    expect(pageTwo.entries.map((entry) => entry.id)).toEqual(allIds.slice(10, 20));
  });

  it("serves an offset past the end as an empty page, not an error", async () => {
    const { app, cookie, userId } = await adminCaller();
    const { gameIds } = await seedSeason(db, {
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: KICKOFF }] }],
    });
    await insertAuditRows(userId, gameIds.get("regular:1")![0]!, 30);

    const body = await readAudit(app, cookie, "?offset=100");

    // The view needs `total` to get back — refusing here would strand a pager
    // that overshot.
    expect(body).toMatchObject({ entries: [], total: 30, limit: 25, offset: 100 });
  });

  it.each(["?limit=0", "?limit=101", "?offset=-1"])("400s on %s", async (query) => {
    const { app, cookie } = await adminCaller();

    const res = await getAudit(app, cookie, query);

    expect(res.status).toBe(400);
  });
});
