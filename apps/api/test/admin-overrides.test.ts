import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminAudit, createDb, games } from "@picksleagues/db";
import {
  FixedClock,
  type GameDataProvider,
  type ProviderGame,
  type ProviderSeasonStructure,
  type ProviderTeam,
} from "@picksleagues/core";
import {
  ADMIN_AUDIT_ACTION,
  GAME_STATUS,
  PICK_OUTCOME,
  PICKEM_PICK_SIDE,
  type AdminGame,
  type AdminGamesResponse,
  type GameOverrideRequest,
  type WeekType,
} from "@picksleagues/schemas";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { syncNflSchedule } from "../src/services/nfl/sync-schedule";
import { settlePicksForGames } from "../src/services/pickem/settlement";
import { createAuthenticatedUser, grantAdmin } from "./setup/auth-helpers";
import {
  insertPick,
  pickResultsFor,
  seedSeason,
  setGame,
  standingsFor,
} from "./setup/league-helpers";
import { seedPickemLeague } from "./setup/pickem-league";
import { providerGame, providerWeek } from "./setup/provider-fixtures";
import { resetDb } from "./setup/reset-db";
import { getTestDatabaseUrl } from "./setup/test-database-url";
import { makeTestEnv } from "./setup/test-env";

/**
 * `PUT /admin/games/{id}/override` (ADM-2, arch §Manual Sports Data Overrides,
 * D15). The properties under test are the ones the architecture makes promises
 * about: precedence through the read serializer, a re-sync that can't clobber a
 * correction, an audit row written with the write it describes, settlement
 * recompute for affected leagues, and the one refusal — a kickoff edit that
 * would re-open picks on a game that already started (arch D11).
 */

const NOW = new Date("2026-09-20T00:00:00.000Z");
const PAST_KICKOFF = new Date("2026-09-13T17:00:00.000Z");
const FUTURE_KICKOFF = new Date("2026-09-27T17:00:00.000Z");
const LATER_FUTURE_KICKOFF = new Date("2026-09-28T17:00:00.000Z");

const db = createDb(getTestDatabaseUrl());
const auth = createAuth({ env: makeTestEnv(), db });
const clock = new FixedClock(NOW);

/** Mutable in-memory provider — only the re-sync test drives it. */
class FakeProvider implements GameDataProvider {
  structure: ProviderSeasonStructure = { seasonYear: 2026, weeks: [] };
  gamesByWeek = new Map<string, ProviderGame[]>();

  async fetchNflSeasonStructure(): Promise<ProviderSeasonStructure> {
    return this.structure;
  }
  async fetchNflWeekGames(
    _seasonYear: number,
    weekType: WeekType,
    weekNumber: number,
  ): Promise<ProviderGame[]> {
    return this.gamesByWeek.get(`${weekType}:${weekNumber}`) ?? [];
  }
  async fetchNflTeams(): Promise<ProviderTeam[]> {
    return [];
  }
}

const provider = new FakeProvider();

function buildApp() {
  return createApp({
    auth,
    db,
    env: makeTestEnv(),
    clock: async () => clock,
    provider: async () => provider,
  });
}

type App = ReturnType<typeof buildApp>;

function putOverride(
  app: App,
  cookie: string | undefined,
  gameId: string,
  body: GameOverrideRequest,
) {
  return app.request(`/api/admin/games/${gameId}/override`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

/** The serializer path, not the row — precedence must hold where clients read it. */
async function readGame(
  app: App,
  cookie: string,
  weekId: string,
  gameId: string,
): Promise<AdminGame> {
  const res = await app.request(`/api/admin/games?weekId=${weekId}`, { headers: { cookie } });
  const { games: rows } = (await res.json()) as AdminGamesResponse;
  const game = rows.find((row) => row.id === gameId);
  if (!game) throw new Error(`game ${gameId} missing from the week listing`);
  return game;
}

async function adminCaller() {
  const { user, cookie } = await createAuthenticatedUser(auth);
  await grantAdmin(db, user.id);
  return { app: buildApp(), cookie, userId: user.id };
}

function auditRows() {
  return db.select().from(adminAudit);
}

/**
 * Two weeks straddling `NOW`: week 1 has already kicked off (so its games are
 * locked), week 2 has not. Every lock-transition case needs one of each.
 */
async function seedGames() {
  const { weekIds, gameIds } = await seedSeason(db, {
    weeks: [
      { weekNumber: 1, kickoffs: [{ kickoffAt: PAST_KICKOFF, spread: -3.5 }] },
      { weekNumber: 2, kickoffs: [{ kickoffAt: FUTURE_KICKOFF }] },
    ],
  });
  return {
    pastWeekId: weekIds.get("regular:1")!,
    pastGameId: gameIds.get("regular:1")![0]!,
    futureWeekId: weekIds.get("regular:2")!,
    futureGameId: gameIds.get("regular:2")![0]!,
  };
}

beforeEach(async () => {
  await resetDb(db);
  provider.structure = { seasonYear: 2026, weeks: [] };
  provider.gamesByWeek = new Map();
});

afterAll(async () => {
  await db.$client.end();
});

describe("PUT /api/admin/games/{gameId}/override — access", () => {
  const UNKNOWN_GAME_ID = "00000000-0000-4000-8000-000000000000";

  it("401s with no session cookie", async () => {
    const res = await putOverride(buildApp(), undefined, UNKNOWN_GAME_ID, { homeScore: 24 });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("403s for a signed-in non-admin caller", async () => {
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await putOverride(buildApp(), cookie, UNKNOWN_GAME_ID, { homeScore: 24 });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "not_admin" });
  });

  it("404s for an unknown game", async () => {
    const { app, cookie } = await adminCaller();

    const res = await putOverride(app, cookie, UNKNOWN_GAME_ID, { homeScore: 24 });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "game_not_found" });
    expect(await auditRows()).toHaveLength(0);
  });

  it("400s on an empty body", async () => {
    const { app, cookie } = await adminCaller();
    const { futureGameId } = await seedGames();

    const res = await putOverride(app, cookie, futureGameId, {});

    expect(res.status).toBe(400);
  });

  it("400s on a score outside its range", async () => {
    const { app, cookie } = await adminCaller();
    const { futureGameId } = await seedGames();

    const res = await putOverride(app, cookie, futureGameId, { homeScore: 500 });

    expect(res.status).toBe(400);
  });

  it("400s on a status outside GAME_STATUS", async () => {
    const { app, cookie } = await adminCaller();
    const { futureGameId } = await seedGames();

    const res = await app.request(`/api/admin/games/${futureGameId}/override`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ status: "delayed" }),
    });

    expect(res.status).toBe(400);
  });
});

describe("PUT /api/admin/games/{gameId}/override — precedence", () => {
  it("sets every field and resolves override ?? provider on the read path", async () => {
    const { app, cookie, userId } = await adminCaller();
    const { futureWeekId, futureGameId } = await seedGames();

    const res = await putOverride(app, cookie, futureGameId, {
      kickoffAt: LATER_FUTURE_KICKOFF.toISOString(),
      status: GAME_STATUS.FINAL,
      homeScore: 24,
      awayScore: 17,
      spread: 7.5,
    });

    expect(res.status).toBe(200);
    const read = await readGame(app, cookie, futureWeekId, futureGameId);
    expect(await res.json()).toEqual(read);
    expect(read).toMatchObject({
      // Provider block survives the correction verbatim (arch D15).
      kickoffAt: FUTURE_KICKOFF.toISOString(),
      status: GAME_STATUS.SCHEDULED,
      homeScore: null,
      awayScore: null,
      latestSpread: null,
      // Override block as written, attributed to the caller.
      overrideKickoffAt: LATER_FUTURE_KICKOFF.toISOString(),
      overrideStatus: GAME_STATUS.FINAL,
      overrideHomeScore: 24,
      overrideAwayScore: 17,
      overrideSpread: 7.5,
      overriddenBy: userId,
      overriddenAt: NOW.toISOString(),
      // Resolved = override ?? provider.
      effectiveKickoffAt: LATER_FUTURE_KICKOFF.toISOString(),
      effectiveStatus: GAME_STATUS.FINAL,
      effectiveHomeScore: 24,
      effectiveAwayScore: 17,
      effectiveSpread: 7.5,
    });
  });

  it("leaves omitted fields alone and applies only the ones supplied", async () => {
    const { app, cookie } = await adminCaller();
    const { pastWeekId, pastGameId } = await seedGames();

    await putOverride(app, cookie, pastGameId, {
      status: GAME_STATUS.FINAL,
      homeScore: 24,
      awayScore: 17,
    });
    await putOverride(app, cookie, pastGameId, { homeScore: 27 });

    const read = await readGame(app, cookie, pastWeekId, pastGameId);
    expect(read).toMatchObject({
      overrideStatus: GAME_STATUS.FINAL,
      overrideHomeScore: 27,
      overrideAwayScore: 17,
    });
  });

  it("clears one field back to provider truth without touching the others", async () => {
    const { app, cookie } = await adminCaller();
    const { pastWeekId, pastGameId } = await seedGames();
    await setGame(db, pastGameId, {
      status: GAME_STATUS.FINAL,
      homeScore: 10,
      awayScore: 20,
    });

    await putOverride(app, cookie, pastGameId, { homeScore: 24, awayScore: 17, spread: 7.5 });
    await putOverride(app, cookie, pastGameId, { spread: null });

    const read = await readGame(app, cookie, pastWeekId, pastGameId);
    expect(read).toMatchObject({
      overrideSpread: null,
      // Back to the provider's latest snapshot, not to null.
      effectiveSpread: -3.5,
      overrideHomeScore: 24,
      effectiveHomeScore: 24,
    });
  });

  it("clearing the last override leaves a row indistinguishable from an uncorrected one", async () => {
    const { app, cookie } = await adminCaller();
    const { pastWeekId, pastGameId } = await seedGames();
    await setGame(db, pastGameId, {
      status: GAME_STATUS.FINAL,
      homeScore: 10,
      awayScore: 20,
    });

    await putOverride(app, cookie, pastGameId, {
      status: GAME_STATUS.CANCELLED,
      homeScore: 24,
      awayScore: 17,
      spread: 7.5,
    });
    const cleared = await putOverride(app, cookie, pastGameId, {
      kickoffAt: null,
      status: null,
      homeScore: null,
      awayScore: null,
      spread: null,
    });

    expect(cleared.status).toBe(200);
    const read = await readGame(app, cookie, pastWeekId, pastGameId);
    expect(read).toMatchObject({
      overrideKickoffAt: null,
      overrideStatus: null,
      overrideHomeScore: null,
      overrideAwayScore: null,
      overrideSpread: null,
      // Attribution goes with the last override — the history lives in admin_audit.
      overriddenBy: null,
      overriddenAt: null,
      effectiveKickoffAt: PAST_KICKOFF.toISOString(),
      effectiveStatus: GAME_STATUS.FINAL,
      effectiveHomeScore: 10,
      effectiveAwayScore: 20,
      effectiveSpread: -3.5,
    });
  });
});

describe("PUT /api/admin/games/{gameId}/override — ingestion never clobbers a correction", () => {
  const WEEK = providerWeek(1, "2026-09-08T00:00:00.000Z", "2026-09-15T00:00:00.000Z");

  async function syncWith(game: ProviderGame) {
    provider.structure = { seasonYear: 2026, weeks: [WEEK] };
    provider.gamesByWeek = new Map([["regular:1", [game]]]);
    await syncNflSchedule(db, clock, provider, { seasonYear: 2026 });
  }

  it("survives a re-sync that rewrites every provider field", async () => {
    const { app, cookie } = await adminCaller();
    await syncWith(
      providerGame({
        providerGameId: "evt-1",
        weekNumber: 1,
        kickoffAt: PAST_KICKOFF,
        status: GAME_STATUS.FINAL,
        homeScore: 10,
        awayScore: 20,
      }),
    );
    const [seeded] = await db.select().from(games).where(eq(games.providerGameId, "evt-1"));

    await putOverride(app, cookie, seeded!.id, {
      status: GAME_STATUS.CANCELLED,
      homeScore: 24,
      awayScore: 17,
    });

    // The provider "corrects itself" — the exact event that used to eat an
    // override under a direct-edit design (arch D15's rejected alternative).
    await syncWith(
      providerGame({
        providerGameId: "evt-1",
        weekNumber: 1,
        kickoffAt: PAST_KICKOFF,
        status: GAME_STATUS.FINAL,
        homeScore: 31,
        awayScore: 28,
      }),
    );

    const read = await readGame(app, cookie, seeded!.weekId, seeded!.id);
    expect(read).toMatchObject({
      // Provider block moved...
      status: GAME_STATUS.FINAL,
      homeScore: 31,
      awayScore: 28,
      // ...the correction did not.
      overrideStatus: GAME_STATUS.CANCELLED,
      overrideHomeScore: 24,
      overrideAwayScore: 17,
      effectiveStatus: GAME_STATUS.CANCELLED,
      effectiveHomeScore: 24,
      effectiveAwayScore: 17,
    });
  });
});

describe("PUT /api/admin/games/{gameId}/override — audit trail", () => {
  it("records the prior override values, not the new ones", async () => {
    const { app, cookie, userId } = await adminCaller();
    const { pastGameId } = await seedGames();

    await putOverride(app, cookie, pastGameId, { homeScore: 24, status: GAME_STATUS.FINAL });
    await putOverride(app, cookie, pastGameId, { homeScore: 27 });

    const rows = await auditRows();
    expect(rows).toHaveLength(2);
    // Both rows share the fixed clock's `createdAt`, so they're identified by
    // the state they recorded rather than by ordering.
    const first = rows.find((row) => row.priorValue.overrideHomeScore === null);
    const second = rows.find((row) => row.priorValue.overrideHomeScore !== null);
    expect(first).toMatchObject({
      adminUserId: userId,
      action: ADMIN_AUDIT_ACTION.GAME_OVERRIDE,
      targetTable: "games",
      targetId: pastGameId,
      createdAt: NOW,
    });
    // The state each write replaced: nothing, then the first write's values.
    expect(first!.priorValue).toMatchObject({
      overrideHomeScore: null,
      overrideStatus: null,
      overriddenBy: null,
    });
    expect(second!.priorValue).toMatchObject({
      overrideHomeScore: 24,
      overrideStatus: GAME_STATUS.FINAL,
      overriddenBy: userId,
    });
  });

  it("writes no audit row when the override is refused", async () => {
    const { app, cookie } = await adminCaller();
    const { pastGameId } = await seedGames();
    await setGame(db, pastGameId, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 17 });

    const res = await putOverride(app, cookie, pastGameId, {
      kickoffAt: FUTURE_KICKOFF.toISOString(),
    });

    expect(res.status).toBe(409);
    expect(await auditRows()).toHaveLength(0);
    // And the write it would have described never happened either.
    const [row] = await db.select().from(games).where(eq(games.id, pastGameId));
    expect(row).toMatchObject({ overrideKickoffAt: null, overriddenBy: null });
  });
});

describe("PUT /api/admin/games/{gameId}/override — settlement recompute", () => {
  /** One 1-game week, both members picking opposite sides, already settled. */
  async function seedSettledLeague() {
    const seeded = await seedPickemLeague(db, auth, {
      weeks: [{ weekNumber: 1, kickoffs: [{ kickoffAt: PAST_KICKOFF }] }],
      members: [{ username: "home_picker" }, { username: "away_picker" }],
    });
    const weekId = seeded.weekIds.get("regular:1")!;
    const gameId = seeded.gameIds.get("regular:1")![0]!;
    const homePicker = seeded.members.get(seeded.users[0]!.user.id)!;
    const awayPicker = seeded.members.get(seeded.users[1]!.user.id)!;

    await insertPick(db, {
      leagueSeasonId: seeded.leagueSeasonId,
      leagueMemberId: homePicker,
      weekId,
      gameId,
      side: PICKEM_PICK_SIDE.HOME,
    });
    await insertPick(db, {
      leagueSeasonId: seeded.leagueSeasonId,
      leagueMemberId: awayPicker,
      weekId,
      gameId,
      side: PICKEM_PICK_SIDE.AWAY,
    });

    // Provider says home won — the incremental path settles it that way.
    await setGame(db, gameId, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10 });
    await settlePicksForGames(db, clock, [gameId]);

    return { ...seeded, weekId, gameId, homePicker, awayPicker };
  }

  async function outcomesByMember(leagueSeasonId: string) {
    const rows = await pickResultsFor(db, leagueSeasonId);
    return new Map(rows.map((row) => [row.leagueMemberId, row.outcome]));
  }

  async function seasonPointsByMember(leagueSeasonId: string) {
    const rows = await standingsFor(db, leagueSeasonId);
    return new Map(
      rows.filter((row) => row.weekId === null).map((row) => [row.leagueMemberId, row.points]),
    );
  }

  it("re-grades results and standings when a final score is corrected", async () => {
    const { app, cookie } = await adminCaller();
    const { leagueSeasonId, gameId, homePicker, awayPicker } = await seedSettledLeague();

    expect(await outcomesByMember(leagueSeasonId)).toEqual(
      new Map([
        [homePicker, PICK_OUTCOME.CORRECT],
        [awayPicker, PICK_OUTCOME.INCORRECT],
      ]),
    );

    // The provider had the teams the wrong way round.
    const res = await putOverride(app, cookie, gameId, { homeScore: 10, awayScore: 24 });

    expect(res.status).toBe(200);
    expect(await outcomesByMember(leagueSeasonId)).toEqual(
      new Map([
        [homePicker, PICK_OUTCOME.INCORRECT],
        [awayPicker, PICK_OUTCOME.CORRECT],
      ]),
    );
    expect(await seasonPointsByMember(leagueSeasonId)).toEqual(
      new Map([
        [homePicker, 0],
        [awayPicker, 1],
      ]),
    );
  });

  it("re-settles on a status correction, pushing a cancelled game's picks", async () => {
    const { app, cookie } = await adminCaller();
    const { leagueSeasonId, gameId, homePicker, awayPicker } = await seedSettledLeague();

    await putOverride(app, cookie, gameId, { status: GAME_STATUS.CANCELLED });

    expect(await outcomesByMember(leagueSeasonId)).toEqual(
      new Map([
        [homePicker, PICK_OUTCOME.PUSH],
        [awayPicker, PICK_OUTCOME.PUSH],
      ]),
    );
  });

  it("is idempotent — a second identical override lands on identical state", async () => {
    const { app, cookie } = await adminCaller();
    const { leagueSeasonId, gameId } = await seedSettledLeague();

    await putOverride(app, cookie, gameId, { homeScore: 10, awayScore: 24 });
    const afterFirst = {
      results: await outcomesByMember(leagueSeasonId),
      standings: await seasonPointsByMember(leagueSeasonId),
    };

    const res = await putOverride(app, cookie, gameId, { homeScore: 10, awayScore: 24 });

    expect(res.status).toBe(200);
    expect(await outcomesByMember(leagueSeasonId)).toEqual(afterFirst.results);
    expect(await seasonPointsByMember(leagueSeasonId)).toEqual(afterFirst.standings);
  });

  it("clearing an override re-settles back to provider truth", async () => {
    const { app, cookie } = await adminCaller();
    const { leagueSeasonId, gameId, homePicker, awayPicker } = await seedSettledLeague();

    await putOverride(app, cookie, gameId, { homeScore: 10, awayScore: 24 });
    await putOverride(app, cookie, gameId, { homeScore: null, awayScore: null });

    expect(await outcomesByMember(leagueSeasonId)).toEqual(
      new Map([
        [homePicker, PICK_OUTCOME.CORRECT],
        [awayPicker, PICK_OUTCOME.INCORRECT],
      ]),
    );
  });
});

/**
 * Lock state is derived from the effective kickoff (arch D11), so a kickoff
 * override moves it retroactively. Moving it *earlier* closes a window that
 * should already have been closed — always allowed. Moving it *later* re-opens
 * picks, which on a started game hands every member an edit against a known
 * outcome; the spec is explicit that even a real postponement doesn't re-open
 * picks (§Cancellations, Postponements & Re-picks).
 */
describe("PUT /api/admin/games/{gameId}/override — the kickoff lock boundary", () => {
  it("refuses a kickoff that would re-open picks on a started game", async () => {
    const { app, cookie } = await adminCaller();
    const { pastGameId } = await seedGames();
    await setGame(db, pastGameId, { status: GAME_STATUS.IN_PROGRESS, homeScore: 7, awayScore: 3 });

    const res = await putOverride(app, cookie, pastGameId, {
      kickoffAt: FUTURE_KICKOFF.toISOString(),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "override_unlocks_game" });
  });

  it("refuses a *clear* that would re-open picks on a started game", async () => {
    const { app, cookie } = await adminCaller();
    const { futureGameId } = await seedGames();
    // Provider kickoff is in the future; a prior override pulled it into the
    // past, and the game went final there.
    await setGame(db, futureGameId, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 17 });
    await putOverride(app, cookie, futureGameId, { kickoffAt: PAST_KICKOFF.toISOString() });

    const res = await putOverride(app, cookie, futureGameId, { kickoffAt: null });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "override_unlocks_game" });
  });

  it("allows re-opening a game the provider still reports as scheduled", async () => {
    const { app, cookie } = await adminCaller();
    const { pastWeekId, pastGameId } = await seedGames();

    const res = await putOverride(app, cookie, pastGameId, {
      kickoffAt: FUTURE_KICKOFF.toISOString(),
    });

    expect(res.status).toBe(200);
    const read = await readGame(app, cookie, pastWeekId, pastGameId);
    expect(read.effectiveKickoffAt).toBe(FUTURE_KICKOFF.toISOString());
  });

  it("allows the escape hatch: correcting the status back to scheduled in the same edit", async () => {
    const { app, cookie } = await adminCaller();
    const { pastWeekId, pastGameId } = await seedGames();
    await setGame(db, pastGameId, { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 17 });

    const res = await putOverride(app, cookie, pastGameId, {
      kickoffAt: FUTURE_KICKOFF.toISOString(),
      status: GAME_STATUS.SCHEDULED,
    });

    expect(res.status).toBe(200);
    const read = await readGame(app, cookie, pastWeekId, pastGameId);
    expect(read).toMatchObject({
      effectiveKickoffAt: FUTURE_KICKOFF.toISOString(),
      effectiveStatus: GAME_STATUS.SCHEDULED,
    });
  });

  it("allows moving a kickoff earlier, which only ever locks", async () => {
    const { app, cookie } = await adminCaller();
    const { futureWeekId, futureGameId } = await seedGames();

    const res = await putOverride(app, cookie, futureGameId, {
      kickoffAt: PAST_KICKOFF.toISOString(),
      status: GAME_STATUS.FINAL,
      homeScore: 24,
      awayScore: 17,
    });

    expect(res.status).toBe(200);
    const read = await readGame(app, cookie, futureWeekId, futureGameId);
    expect(read.effectiveKickoffAt).toBe(PAST_KICKOFF.toISOString());
  });
});
