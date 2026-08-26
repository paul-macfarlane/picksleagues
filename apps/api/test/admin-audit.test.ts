import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminAudit } from "@picksleagues/db";
import { FixedClock } from "@picksleagues/core";
import {
  ADMIN_AUDIT_ACTION,
  ADMIN_AUDIT_TARGET_TABLE,
  GAME_STATUS,
  LEAGUE_MODE,
  MEMBER_ROLE,
  PICKEM_PICK_SIDE,
} from "@picksleagues/schemas";
import { settlePicksForGames, settleSweep } from "../src/services/settlement";
import { settleForSim } from "../src/services/sim/settle";
import { insertLeague, insertPick, seedSeason, setGame } from "./setup/league-helpers";
import { seedPickemLeague } from "./setup/pickem-league";
import { resetDb } from "./setup/reset-db";
import { makeFixedAppHarness } from "./setup/fixed-app";

/**
 * The admin audit trail (engineering rules §Data: an admin rebuild writes
 * `admin_audit` in the recompute's transaction). One row per admin rebuild
 * naming the league season it recomputed, a prior value describing the derived
 * state that rebuild was about to wipe, and silence from every *other* caller
 * of the same settlement path — the nightly sweep, ingestion, and the simulator
 * settle seasons on their own schedule, and auditing them would bury the admin
 * actions the trail exists to show. Asserted against the table: nothing serves
 * the trail on the wire (ADR-0046).
 */

const NOW = new Date("2026-09-20T00:00:00.000Z");
const KICKOFF = new Date("2026-09-13T17:00:00.000Z");

const { db, auth, appAt, adminCaller } = makeFixedAppHarness();
const clock = new FixedClock(NOW);

function buildApp() {
  return appAt(clock.now());
}

type App = ReturnType<typeof buildApp>;

function auditRows() {
  return db.select().from(adminAudit);
}

function rebuild(app: App, cookie: string, leagueId: string) {
  return app.request(`/api/admin/leagues/${leagueId}/rebuild`, {
    method: "POST",
    headers: { cookie },
  });
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
    const { app, cookie, userId } = await adminCaller(buildApp());
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
    const { app, cookie } = await adminCaller(buildApp());
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
    const { app, cookie, userId } = await adminCaller(buildApp());
    const { seasonId } = await seedSeason(db, {
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: KICKOFF }] }],
    });
    // March Madness is the mode with no settlement module (MM-6); Pick'em and
    // Survivor both grade and both audit their own rebuild.
    const league = await insertLeague(db, {
      seasonId,
      mode: LEAGUE_MODE.MARCH_MADNESS,
      settings: {
        maxBracketsPerMember: 5,
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
    const { app, cookie } = await adminCaller(buildApp());
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
