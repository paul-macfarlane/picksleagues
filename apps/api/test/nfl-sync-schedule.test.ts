import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createDb,
  games,
  leagueMembers,
  leagueSeasons,
  leagues,
  pickemPicks,
  pickResults,
  sportSeasons,
  teams,
  users,
  weeks,
} from "@picksleagues/db";
import {
  FixedClock,
  estimatedNflWeeks,
  type GameDataProvider,
  type ProviderGame,
  type ProviderSeasonStructure,
  type ProviderTeam,
  type ProviderWeek,
} from "@picksleagues/core";
import {
  GAME_STATUS,
  LEAGUE_MODE,
  LEAGUE_STATUS,
  LEAGUE_VISIBILITY,
  MEMBER_ROLE,
  PICK_OUTCOME,
  PICK_SIDE,
  SPORT,
  WEEK_TYPE,
  type WeekType,
  type JobRunResponse,
} from "@picksleagues/schemas";
import { createApp } from "../src/app";
import { ingestSeasonSnapshot } from "../src/services/nfl/ingest-season";
import { syncNflSchedule } from "../src/services/nfl/sync-schedule";
import { DEFAULT_PICKEM_SETTINGS } from "./setup/league-helpers";
import { providerGame, providerWeek } from "./setup/provider-fixtures";
import { resetDb } from "./setup/reset-db";
import { getTestDatabaseUrl } from "./setup/test-database-url";
import { makeTestEnv } from "./setup/test-env";

const testEnv = makeTestEnv();

// September → nflSeasonYearFor maps to 2026, so a bare (cron-style) trigger
// defaults to season 2026.
const FIXED_NOW = new Date("2026-09-15T12:00:00.000Z");
const SEASON_YEAR = 2026;

/** Regular and postseason week numbers overlap, so the fake keys games by both. */
function weekKey(weekType: WeekType, weekNumber: number): string {
  return `${weekType}:${weekNumber}`;
}

/** Mutable in-memory provider — reshape `structure`/`gamesByWeek` between runs. */
class FakeProvider implements GameDataProvider {
  structure: ProviderSeasonStructure = { seasonYear: SEASON_YEAR, weeks: [] };
  gamesByWeek = new Map<string, ProviderGame[]>();
  // Per-season-year overrides, consulted only when set — everything above
  // stays year-agnostic for the bulk of tests (which only ever exercise one
  // season year and rely on `fetchNflSeasonStructure`/`fetchNflWeekGames`
  // ignoring the year argument). The offseason-lifecycle tests use these to
  // give the "ensure next season" step's `seasonYear + 1` fetch an answer
  // independent of the default season's fetch.
  structureByYear = new Map<number, ProviderSeasonStructure>();
  gamesByYearWeek = new Map<string, ProviderGame[]>();
  // Empty by default so existing tests (which don't exercise enrichment) stand
  // unchanged — the enrichment tests below populate this.
  teams: ProviderTeam[] = [];

  async fetchNflSeasonStructure(seasonYear: number): Promise<ProviderSeasonStructure> {
    return this.structureByYear.get(seasonYear) ?? this.structure;
  }

  async fetchNflWeekGames(
    seasonYear: number,
    weekType: WeekType,
    weekNumber: number,
  ): Promise<ProviderGame[]> {
    const yearKey = `${seasonYear}:${weekKey(weekType, weekNumber)}`;
    if (this.gamesByYearWeek.has(yearKey)) {
      return this.gamesByYearWeek.get(yearKey) ?? [];
    }
    return this.gamesByWeek.get(weekKey(weekType, weekNumber)) ?? [];
  }

  async fetchNflTeams(): Promise<ProviderTeam[]> {
    return this.teams;
  }
}

function providerTeam(overrides: Partial<ProviderTeam> & { providerTeamId: string }): ProviderTeam {
  return {
    abbreviation: "HOM",
    name: "Home Team",
    location: "Home",
    logoLightUrl: "https://example.com/hom-light.png",
    logoDarkUrl: "https://example.com/hom-dark.png",
    ...overrides,
  };
}

const db = createDb(getTestDatabaseUrl());
const provider = new FakeProvider();
const app = createApp({
  env: testEnv,
  db,
  clock: async () => new FixedClock(FIXED_NOW),
  provider: async () => provider,
});

function runSyncSchedule(query = "", secret: string | null = testEnv.JOB_SECRET) {
  return app.request(`/api/jobs/nfl/sync-schedule${query}`, {
    method: "POST",
    headers: secret ? { "x-job-secret": secret } : {},
  });
}

async function runOk(query = ""): Promise<Record<string, string | number | boolean>> {
  const res = await runSyncSchedule(query);
  expect(res.status).toBe(200);
  const body = (await res.json()) as JobRunResponse;
  expect(body.status).toBe("ok");
  return body.details ?? {};
}

/** Baseline: two regular weeks, two games in week 1, one in week 2. */
function seedBaselineProvider() {
  provider.structure = {
    seasonYear: SEASON_YEAR,
    weeks: [
      providerWeek(1, "2026-09-08T00:00:00.000Z", "2026-09-15T00:00:00.000Z"),
      providerWeek(2, "2026-09-15T00:00:00.000Z", "2026-09-22T00:00:00.000Z"),
    ],
  };
  provider.gamesByWeek = new Map([
    [
      weekKey(WEEK_TYPE.REGULAR, 1),
      [
        providerGame({ providerGameId: "g1", weekNumber: 1 }),
        providerGame({ providerGameId: "g2", weekNumber: 1 }),
      ],
    ],
    [weekKey(WEEK_TYPE.REGULAR, 2), [providerGame({ providerGameId: "g3", weekNumber: 2 })]],
  ]);
}

/**
 * Arranges a Pick'em league + one member + one pick on an already-ingested
 * game, via raw inserts (mirrors the "never deletes a week..." fixture below)
 * — this file has no `insertLeague`/`createAuthenticatedUser` harness of its
 * own since it exercises ingestion, not the league API.
 */
async function seedPickemPickOnGame(seasonId: string, weekId: string, gameId: string) {
  const [league] = await db
    .insert(leagues)
    .values({
      name: "Sync Settle Test League",
      mode: LEAGUE_MODE.PICKEM,
      visibility: LEAGUE_VISIBILITY.PRIVATE,
      maxMembers: 10,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    .returning();
  const [leagueSeason] = await db
    .insert(leagueSeasons)
    .values({
      leagueId: league!.id,
      seasonId,
      settings: DEFAULT_PICKEM_SETTINGS,
      status: LEAGUE_STATUS.ACTIVE,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    .returning();
  const [user] = await db
    .insert(users)
    .values({
      id: randomUUID(),
      display_name: "Picker",
      email: `picker-${randomUUID()}@example.com`,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    .returning();
  const [member] = await db
    .insert(leagueMembers)
    .values({
      leagueId: league!.id,
      userId: user!.id,
      role: MEMBER_ROLE.COMMISSIONER,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    .returning();
  const [pick] = await db
    .insert(pickemPicks)
    .values({
      leagueSeasonId: leagueSeason!.id,
      leagueMemberId: member!.id,
      weekId,
      gameId,
      side: PICK_SIDE.HOME,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    .returning();
  return { leagueSeasonId: leagueSeason!.id, pickId: pick!.id };
}

async function pickResultFor(pickId: string) {
  const [row] = await db.select().from(pickResults).where(eq(pickResults.pickemPickId, pickId));
  return row;
}

beforeEach(async () => {
  await resetDb(db);
  provider.structure = { seasonYear: SEASON_YEAR, weeks: [] };
  provider.gamesByWeek = new Map();
  provider.structureByYear = new Map();
  provider.gamesByYearWeek = new Map();
  provider.teams = [];
});

afterAll(async () => {
  await db.$client.end();
});

describe("POST /api/jobs/nfl/sync-schedule", () => {
  it("401s without the x-job-secret header", async () => {
    const res = await runSyncSchedule("", null);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
  });

  it("first run creates the season, weeks, and games with counters in the envelope", async () => {
    seedBaselineProvider();

    const details = await runOk();
    expect(details).toMatchObject({
      seasonYear: SEASON_YEAR,
      weeksSynced: 2,
      gamesCreated: 3,
      gamesUpdated: 0,
      postponements: 0,
      cancellations: 0,
      weekMoves: 0,
      kickoffChanges: 0,
    });

    const [season] = await db.select().from(sportSeasons);
    expect(season).toMatchObject({ sport: "nfl", year: SEASON_YEAR });
    expect(await db.select().from(weeks)).toHaveLength(2);
    expect(await db.select().from(games)).toHaveLength(3);
  });

  it("is idempotent: a second run at a later clock instant leaves every row byte-identical and touches nothing", async () => {
    seedBaselineProvider();
    // Teams-listing enrichment lands on the same first run, so this
    // idempotency check also proves enrichment writes never churn on re-run.
    provider.teams = [
      providerTeam({ providerTeamId: "hom-id", abbreviation: "HOM", name: "Home Team" }),
      providerTeam({
        providerTeamId: "awy-id",
        abbreviation: "AWY",
        name: "Away Team",
        location: "Away",
        logoLightUrl: "https://example.com/awy-light.png",
        logoDarkUrl: "https://example.com/awy-dark.png",
      }),
    ];
    await runOk();
    const firstGames = await db.select().from(games).orderBy(games.providerGameId);
    const firstWeeks = await db.select().from(weeks).orderBy(weeks.weekNumber);
    const firstSeason = await db.select().from(sportSeasons);
    const firstTeams = await db.select().from(teams).orderBy(teams.providerTeamId);
    // Enrichment actually landed on this first run — otherwise the
    // byte-identical assertion below would trivially pass on all-null rows.
    expect(firstTeams.every((team) => team.location !== null)).toBe(true);

    // A strictly later instant proves no-op re-runs never touch updatedAt (a
    // byte-identical re-run under the old unconditional upsert would have churned
    // updatedAt to this new value).
    const laterClock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    const details = await syncNflSchedule(db, laterClock, provider, { seasonYear: SEASON_YEAR });
    expect(details).toMatchObject({ gamesCreated: 0, gamesUpdated: 0, teamsEnriched: 0 });

    expect(await db.select().from(games).orderBy(games.providerGameId)).toEqual(firstGames);
    expect(await db.select().from(weeks).orderBy(weeks.weekNumber)).toEqual(firstWeeks);
    expect(await db.select().from(sportSeasons)).toEqual(firstSeason);
    expect(await db.select().from(teams).orderBy(teams.providerTeamId)).toEqual(firstTeams);
  });

  it("dedupes a game listed under two weeks (last-wins) so the upsert never hits the same row twice", async () => {
    provider.structure = {
      seasonYear: SEASON_YEAR,
      weeks: [
        providerWeek(1, "2026-09-08T00:00:00.000Z", "2026-09-15T00:00:00.000Z"),
        providerWeek(2, "2026-09-15T00:00:00.000Z", "2026-09-22T00:00:00.000Z"),
      ],
    };
    // ESPN transiently lists a rescheduled game under both its old and new week.
    provider.gamesByWeek = new Map([
      [weekKey(WEEK_TYPE.REGULAR, 1), [providerGame({ providerGameId: "g1", weekNumber: 1 })]],
      [weekKey(WEEK_TYPE.REGULAR, 2), [providerGame({ providerGameId: "g1", weekNumber: 2 })]],
    ]);

    const details = await runOk();
    expect(details).toMatchObject({ gamesCreated: 1, duplicateProviderGames: 1 });

    const gameRows = await db.select().from(games);
    expect(gameRows).toHaveLength(1);
    const [week2] = await db.select().from(weeks).where(eq(weeks.weekNumber, 2));
    expect(gameRows[0]?.weekId).toBe(week2?.id);
  });

  it("updates kickoffAt and counts a kickoff change", async () => {
    seedBaselineProvider();
    await runOk();

    const moved = new Date("2026-09-14T20:00:00.000Z");
    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [
      providerGame({ providerGameId: "g1", weekNumber: 1, kickoffAt: moved }),
      providerGame({ providerGameId: "g2", weekNumber: 1 }),
    ]);

    const details = await runOk();
    expect(details).toMatchObject({ kickoffChanges: 1, gamesCreated: 0 });
    const [g1] = await db.select().from(games).where(eq(games.providerGameId, "g1"));
    expect(g1?.kickoffAt).toEqual(moved);
  });

  it.each([
    { label: "postponed", status: GAME_STATUS.POSTPONED, counter: "postponements" },
    { label: "cancelled", status: GAME_STATUS.CANCELLED, counter: "cancellations" },
  ])("updates status to $label and counts it", async ({ status, counter }) => {
    seedBaselineProvider();
    await runOk();

    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [
      providerGame({ providerGameId: "g1", weekNumber: 1, status }),
      providerGame({ providerGameId: "g2", weekNumber: 1 }),
    ]);

    const details = await runOk();
    expect(details[counter]).toBe(1);
    const [g1] = await db.select().from(games).where(eq(games.providerGameId, "g1"));
    expect(g1?.status).toBe(status);
  });

  it("moves a game to another week and counts the week move", async () => {
    seedBaselineProvider();
    await runOk();
    const [before] = await db.select().from(games).where(eq(games.providerGameId, "g1"));

    // g1 leaves week 1 and reappears in week 2's fetch.
    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [
      providerGame({ providerGameId: "g2", weekNumber: 1 }),
    ]);
    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 2), [
      providerGame({ providerGameId: "g3", weekNumber: 2 }),
      providerGame({ providerGameId: "g1", weekNumber: 2 }),
    ]);

    const details = await runOk();
    expect(details).toMatchObject({ weekMoves: 1, gamesCreated: 0 });
    const [after] = await db.select().from(games).where(eq(games.providerGameId, "g1"));
    expect(after?.weekId).not.toBe(before?.weekId);

    const [week2] = await db.select().from(weeks).where(eq(weeks.weekNumber, 2));
    expect(after?.weekId).toBe(week2?.id);
  });

  it("updates a game's team FK when the provider swaps its home team and counts it in gamesUpdated", async () => {
    seedBaselineProvider();
    await runOk();

    // g1's home team changes to a brand-new provider team (a correction, not a
    // rename of the same provider id) — the game row's homeTeamId must follow.
    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [
      providerGame({
        providerGameId: "g1",
        weekNumber: 1,
        homeTeamProviderId: "new-hom-id",
        homeTeamAbbr: "NEW",
        homeTeamName: "New Home Team",
      }),
      providerGame({ providerGameId: "g2", weekNumber: 1 }),
    ]);

    const details = await runOk();
    expect(details).toMatchObject({ gamesUpdated: 1, gamesCreated: 0, teamsCreated: 1 });

    const [g1] = await db.select().from(games).where(eq(games.providerGameId, "g1"));
    const [newHomeTeam] = await db
      .select()
      .from(teams)
      .where(eq(teams.providerTeamId, "new-hom-id"));
    expect(g1?.homeTeamId).toBe(newHomeTeam?.id);
    expect(g1?.homeTeamId).not.toBe(
      (await db.select().from(teams).where(eq(teams.providerTeamId, "hom-id")))[0]?.id,
    );
  });

  it("never clobbers admin override fields on re-sync (arch D15)", async () => {
    seedBaselineProvider();
    await runOk();

    const overriddenAt = new Date("2026-09-16T00:00:00.000Z");
    const overrideKickoff = new Date("2026-12-25T00:00:00.000Z");
    await db
      .update(games)
      .set({
        overrideStatus: GAME_STATUS.CANCELLED,
        overrideKickoffAt: overrideKickoff,
        overrideHomeScore: 42,
        overriddenAt,
      })
      .where(eq(games.providerGameId, "g1"));

    // Provider data for g1 changes across the board.
    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [
      providerGame({
        providerGameId: "g1",
        weekNumber: 1,
        status: GAME_STATUS.FINAL,
        kickoffAt: new Date("2026-09-13T18:00:00.000Z"),
        homeScore: 21,
        awayScore: 17,
      }),
      providerGame({ providerGameId: "g2", weekNumber: 1 }),
    ]);

    await runOk();

    const [g1] = await db.select().from(games).where(eq(games.providerGameId, "g1"));
    // Provider fields followed the re-sync...
    expect(g1?.status).toBe(GAME_STATUS.FINAL);
    expect(g1?.homeScore).toBe(21);
    expect(g1?.awayScore).toBe(17);
    expect(g1?.kickoffAt).toEqual(new Date("2026-09-13T18:00:00.000Z"));
    // ...while every override_* field stayed byte-identical.
    expect(g1?.overrideStatus).toBe(GAME_STATUS.CANCELLED);
    expect(g1?.overrideKickoffAt).toEqual(overrideKickoff);
    expect(g1?.overrideHomeScore).toBe(42);
    expect(g1?.overriddenAt).toEqual(overriddenAt);
  });

  it("narrows to a single week when ?week= is given (only that week's games are fetched)", async () => {
    seedBaselineProvider();

    const details = await runOk("?week=1");
    // Both week rows are still synced (cheap structure data), but only week 1's
    // games were fetched and upserted.
    expect(details).toMatchObject({ weeksSynced: 2, gamesCreated: 2 });
    const gameRows = await db.select().from(games);
    expect(gameRows.map((g) => g.providerGameId).sort()).toEqual(["g1", "g2"]);
  });

  it("skips an explicit week the structure doesn't expose (e.g. the excluded Pro Bowl week)", async () => {
    seedBaselineProvider();

    const details = await runOk("?weekType=postseason&week=4");
    expect(details).toMatchObject({ skipped: true, reason: "week_not_synced" });
    // Nothing was written — the skip happens before any fetch or transaction.
    expect(await db.select().from(games)).toHaveLength(0);
  });

  it("honors an explicit ?season=", async () => {
    seedBaselineProvider();
    provider.structure.seasonYear = 2025;

    const details = await runOk("?season=2025");
    expect(details.seasonYear).toBe(2025);
    const [season] = await db.select().from(sportSeasons);
    expect(season?.year).toBe(2025);
  });

  it("syncs postseason weeks alongside regular; a regular week 1 and postseason week 1 coexist and labels are stored", async () => {
    provider.structure = {
      seasonYear: SEASON_YEAR,
      weeks: [
        providerWeek(1, "2026-09-08T00:00:00.000Z", "2026-09-15T00:00:00.000Z"),
        providerWeek(
          1,
          "2027-01-09T00:00:00.000Z",
          "2027-01-13T00:00:00.000Z",
          WEEK_TYPE.POSTSEASON,
          "Wild Card",
        ),
      ],
    };
    provider.gamesByWeek = new Map([
      [weekKey(WEEK_TYPE.REGULAR, 1), [providerGame({ providerGameId: "reg1", weekNumber: 1 })]],
      [
        weekKey(WEEK_TYPE.POSTSEASON, 1),
        [
          providerGame({
            providerGameId: "post1",
            weekType: WEEK_TYPE.POSTSEASON,
            weekNumber: 1,
            kickoffAt: new Date("2027-01-10T18:00:00.000Z"),
          }),
        ],
      ],
    ]);

    const details = await runOk();
    // Two week rows sharing weekNumber 1 prove the (season, type, number) unique
    // constraint discriminates them rather than colliding.
    expect(details).toMatchObject({ weeksSynced: 2, gamesCreated: 2 });

    expect(await db.select().from(weeks)).toHaveLength(2);
    const [regularWeek] = await db
      .select()
      .from(weeks)
      .where(eq(weeks.weekType, WEEK_TYPE.REGULAR));
    const [postseasonWeek] = await db
      .select()
      .from(weeks)
      .where(eq(weeks.weekType, WEEK_TYPE.POSTSEASON));
    expect(regularWeek?.weekNumber).toBe(1);
    expect(regularWeek?.label).toBe("Week 1");
    expect(postseasonWeek?.weekNumber).toBe(1);
    expect(postseasonWeek?.label).toBe("Wild Card");

    // Each game landed under the correct week type's row.
    const [post1] = await db.select().from(games).where(eq(games.providerGameId, "post1"));
    expect(post1?.weekId).toBe(postseasonWeek?.id);
  });

  it("narrows to a single postseason week when ?weekType=postseason&week=1 is given", async () => {
    provider.structure = {
      seasonYear: SEASON_YEAR,
      weeks: [
        providerWeek(1, "2026-09-08T00:00:00.000Z", "2026-09-15T00:00:00.000Z"),
        providerWeek(
          1,
          "2027-01-09T00:00:00.000Z",
          "2027-01-13T00:00:00.000Z",
          WEEK_TYPE.POSTSEASON,
          "Wild Card",
        ),
      ],
    };
    provider.gamesByWeek = new Map([
      [weekKey(WEEK_TYPE.REGULAR, 1), [providerGame({ providerGameId: "reg1", weekNumber: 1 })]],
      [
        weekKey(WEEK_TYPE.POSTSEASON, 1),
        [
          providerGame({
            providerGameId: "post1",
            weekType: WEEK_TYPE.POSTSEASON,
            weekNumber: 1,
            kickoffAt: new Date("2027-01-10T18:00:00.000Z"),
          }),
        ],
      ],
    ]);

    const details = await runOk("?weekType=postseason&week=1");
    // Both week rows are synced from the structure, but only postseason week 1's
    // games were fetched and written.
    expect(details).toMatchObject({ weeksSynced: 2, gamesCreated: 1 });
    const gameRows = await db.select().from(games);
    expect(gameRows.map((g) => g.providerGameId)).toEqual(["post1"]);

    const [postseasonWeek] = await db
      .select()
      .from(weeks)
      .where(and(eq(weeks.weekType, WEEK_TYPE.POSTSEASON), eq(weeks.weekNumber, 1)));
    expect(gameRows[0]?.weekId).toBe(postseasonWeek?.id);
  });

  it("skips with week_not_synced for an explicit week the structure doesn't expose (e.g. the Pro Bowl)", async () => {
    provider.structure = {
      seasonYear: SEASON_YEAR,
      weeks: [providerWeek(1, "2026-09-08T00:00:00.000Z", "2026-09-15T00:00:00.000Z")],
    };
    provider.gamesByWeek = new Map([
      // The provider would even return games for the excluded week — the skip
      // must fire off the structure, before any game fetch is attempted.
      [
        weekKey(WEEK_TYPE.POSTSEASON, 4),
        [
          providerGame({
            providerGameId: "probowl",
            weekType: WEEK_TYPE.POSTSEASON,
            weekNumber: 4,
          }),
        ],
      ],
    ]);

    const details = await runOk("?weekType=postseason&week=4");
    expect(details).toMatchObject({ skipped: true, reason: "week_not_synced" });
    expect(await db.select().from(games)).toEqual([]);
  });

  it("upserts one teams row per distinct provider team even when it's shared across games", async () => {
    provider.structure = {
      seasonYear: SEASON_YEAR,
      // Ends after FIXED_NOW (unlike the single-week fixtures below) so the
      // default season isn't "concluded" — this test isn't exercising the
      // offseason-lifecycle ensure step (see the dedicated describe block).
      weeks: [providerWeek(1, "2026-09-08T00:00:00.000Z", "2026-09-22T00:00:00.000Z")],
    };
    provider.gamesByWeek = new Map([
      [
        weekKey(WEEK_TYPE.REGULAR, 1),
        [
          providerGame({
            providerGameId: "g1",
            weekNumber: 1,
            homeTeamAbbr: "KC",
            homeTeamName: "Kansas City Chiefs",
            homeTeamProviderId: "kc-id",
          }),
          providerGame({
            providerGameId: "g2",
            weekNumber: 1,
            awayTeamAbbr: "KC",
            awayTeamName: "Kansas City Chiefs",
            awayTeamProviderId: "kc-id",
          }),
        ],
      ],
    ]);

    const details = await runOk();
    // Distinct provider teams across g1/g2: hom-id, awy-id (g1), kc-id (g1 home
    // / g2 away, same provider id) — three rows, not four.
    expect(details).toMatchObject({ teamsCreated: 3 });

    const kcTeams = await db.select().from(teams).where(eq(teams.providerTeamId, "kc-id"));
    expect(kcTeams).toHaveLength(1);
    expect(kcTeams[0]).toMatchObject({ sport: SPORT.NFL, abbreviation: "KC" });
  });

  it("inserts two distinct provider teams that share an abbreviation (ESPN's placeholder 'TBD' playoff matchups)", async () => {
    provider.structure = {
      seasonYear: SEASON_YEAR,
      weeks: [
        providerWeek(
          1,
          "2027-01-09T00:00:00.000Z",
          "2027-01-13T00:00:00.000Z",
          WEEK_TYPE.POSTSEASON,
          "Wild Card",
        ),
      ],
    };
    // Two undetermined playoff matchups: distinct provider ids, identical
    // "TBD" abbreviation — the abbreviation unique is bootstrap-only (rows
    // with no providerTeamId), so both must insert as separate rows here.
    provider.gamesByWeek = new Map([
      [
        weekKey(WEEK_TYPE.POSTSEASON, 1),
        [
          providerGame({
            providerGameId: "post1",
            weekType: WEEK_TYPE.POSTSEASON,
            weekNumber: 1,
            homeTeamAbbr: "TBD",
            homeTeamName: "TBD",
            homeTeamProviderId: "-1",
            awayTeamAbbr: "TBD",
            awayTeamName: "TBD",
            awayTeamProviderId: "-2",
          }),
          providerGame({
            providerGameId: "post2",
            weekType: WEEK_TYPE.POSTSEASON,
            weekNumber: 1,
            homeTeamAbbr: "TBD",
            homeTeamName: "TBD",
            homeTeamProviderId: "-3",
            awayTeamAbbr: "TBD",
            awayTeamName: "TBD",
            awayTeamProviderId: "-4",
          }),
        ],
      ],
    ]);

    const details = await runOk();
    expect(details).toMatchObject({ gamesCreated: 2, teamsCreated: 4 });

    const tbdTeams = await db.select().from(teams).where(eq(teams.abbreviation, "TBD"));
    expect(tbdTeams).toHaveLength(4);
    expect(new Set(tbdTeams.map((team) => team.providerTeamId))).toEqual(
      new Set(["-1", "-2", "-3", "-4"]),
    );

    const gameRows = await db.select().from(games);
    expect(gameRows.map((g) => g.providerGameId).sort()).toEqual(["post1", "post2"]);
    for (const game of gameRows) {
      expect(game.homeTeamId).not.toBeNull();
      expect(game.awayTeamId).not.toBeNull();
    }
  });

  it("updates a team's name/abbreviation on a provider rename, without creating a duplicate row", async () => {
    seedBaselineProvider();
    await runOk();

    // Both week-1 games share the "hom-id" team — rename both consistently
    // (a real provider sync would never report the same team under two
    // different current names within one batch) and narrow to week 1 so
    // week 2's still-default-named game doesn't race the rename.
    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [
      providerGame({ providerGameId: "g1", weekNumber: 1, homeTeamName: "New Home Name" }),
      providerGame({ providerGameId: "g2", weekNumber: 1, homeTeamName: "New Home Name" }),
    ]);

    const details = await runOk("?week=1");
    expect(details).toMatchObject({ teamsCreated: 0 });

    const homeTeams = await db.select().from(teams).where(eq(teams.providerTeamId, "hom-id"));
    expect(homeTeams).toHaveLength(1);
    expect(homeTeams[0]?.name).toBe("New Home Name");
  });

  it("bootstrap: fills a pre-existing NULL-providerTeamId team's providerTeamId by abbreviation match, no duplicate", async () => {
    const [bootstrapTeam] = await db
      .insert(teams)
      .values({
        sport: SPORT.NFL,
        abbreviation: "HOM",
        name: "Home Team",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      })
      .returning();

    seedBaselineProvider();
    const details = await runOk();
    // Only AWY is a brand-new row — HOM matched the pre-existing bootstrap row.
    expect(details).toMatchObject({ teamsCreated: 1 });

    const homeTeams = await db.select().from(teams).where(eq(teams.abbreviation, "HOM"));
    expect(homeTeams).toHaveLength(1);
    expect(homeTeams[0]?.id).toBe(bootstrapTeam?.id);
    expect(homeTeams[0]?.providerTeamId).toBe("hom-id");
  });
});

describe("sync-schedule settles cancellations and week moves immediately (no separate settle call)", () => {
  it("a cancelled game's pick becomes a push immediately after the sync", async () => {
    seedBaselineProvider();
    await runOk();
    const [season] = await db.select().from(sportSeasons);
    const [week1] = await db.select().from(weeks).where(eq(weeks.weekNumber, 1));
    const [g1] = await db.select().from(games).where(eq(games.providerGameId, "g1"));
    const { pickId } = await seedPickemPickOnGame(season!.id, week1!.id, g1!.id);

    // g1 goes final and is already settled before the cancellation lands.
    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [
      providerGame({
        providerGameId: "g1",
        weekNumber: 1,
        status: GAME_STATUS.FINAL,
        homeScore: 24,
        awayScore: 10,
      }),
      providerGame({ providerGameId: "g2", weekNumber: 1 }),
    ]);
    const finalDetails = await runOk();
    expect(finalDetails.settledLeagueSeasons).toBeGreaterThanOrEqual(1);
    expect(await pickResultFor(pickId)).toMatchObject({ outcome: PICK_OUTCOME.CORRECT });

    // The provider now reports the same game cancelled.
    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [
      providerGame({ providerGameId: "g1", weekNumber: 1, status: GAME_STATUS.CANCELLED }),
      providerGame({ providerGameId: "g2", weekNumber: 1 }),
    ]);
    const details = await runOk();
    expect(details.settledLeagueSeasons).toBeGreaterThanOrEqual(1);

    expect(await pickResultFor(pickId)).toMatchObject({ outcome: PICK_OUTCOME.PUSH });
  });

  it("a week move settles the pick as a push in its original week, immediately after the sync", async () => {
    seedBaselineProvider();
    await runOk();
    const [season] = await db.select().from(sportSeasons);
    const [week1] = await db.select().from(weeks).where(eq(weeks.weekNumber, 1));
    const [g1] = await db.select().from(games).where(eq(games.providerGameId, "g1"));
    const { pickId } = await seedPickemPickOnGame(season!.id, week1!.id, g1!.id);

    // g1 leaves week 1 and reappears in week 2's fetch; the pick keeps week 1.
    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [
      providerGame({ providerGameId: "g2", weekNumber: 1 }),
    ]);
    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 2), [
      providerGame({ providerGameId: "g3", weekNumber: 2 }),
      providerGame({ providerGameId: "g1", weekNumber: 2 }),
    ]);

    const details = await runOk();
    expect(details).toMatchObject({ weekMoves: 1 });
    expect(details.settledLeagueSeasons).toBeGreaterThanOrEqual(1);

    const result = await pickResultFor(pickId);
    expect(result).toMatchObject({ outcome: PICK_OUTCOME.PUSH, weekId: week1!.id });
  });

  it("a pure kickoff-time change does not resettle anything — settledLeagueSeasons stays 0", async () => {
    seedBaselineProvider();
    await runOk();
    const [season] = await db.select().from(sportSeasons);
    const [week1] = await db.select().from(weeks).where(eq(weeks.weekNumber, 1));
    const [g1] = await db.select().from(games).where(eq(games.providerGameId, "g1"));
    await seedPickemPickOnGame(season!.id, week1!.id, g1!.id);

    // Locking is derived at read time from kickoffAt, never stored, so a
    // kickoff-only change has nothing for settlement to react to.
    const moved = new Date("2026-09-14T20:00:00.000Z");
    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [
      providerGame({ providerGameId: "g1", weekNumber: 1, kickoffAt: moved }),
      providerGame({ providerGameId: "g2", weekNumber: 1 }),
    ]);

    const details = await runOk();
    expect(details).toMatchObject({ kickoffChanges: 1, settledLeagueSeasons: 0 });
  });
});

describe("teams-listing enrichment (location + logos)", () => {
  it("enriches location and both logo urls for a team resolved from the games batch, counting teamsEnriched", async () => {
    seedBaselineProvider();
    provider.teams = [
      providerTeam({
        providerTeamId: "hom-id",
        abbreviation: "HOM",
        name: "Home Team",
        location: "Home City",
        logoLightUrl: "https://example.com/hom-light.png",
        logoDarkUrl: "https://example.com/hom-dark.png",
      }),
    ];

    const details = await runOk();
    expect(details).toMatchObject({ teamsEnriched: 1 });

    const [homeTeam] = await db.select().from(teams).where(eq(teams.providerTeamId, "hom-id"));
    expect(homeTeam).toMatchObject({
      location: "Home City",
      logoLightUrl: "https://example.com/hom-light.png",
      logoDarkUrl: "https://example.com/hom-dark.png",
    });

    // A provider team never in the listing (the "AWY" fixture team) keeps null
    // metadata rather than erroring or being invented.
    const [awayTeam] = await db.select().from(teams).where(eq(teams.providerTeamId, "awy-id"));
    expect(awayTeam).toMatchObject({ location: null, logoLightUrl: null, logoDarkUrl: null });
  });

  it("a TBD playoff placeholder never in the teams listing keeps null metadata", async () => {
    provider.structure = {
      seasonYear: SEASON_YEAR,
      weeks: [
        providerWeek(
          1,
          "2027-01-09T00:00:00.000Z",
          "2027-01-13T00:00:00.000Z",
          WEEK_TYPE.POSTSEASON,
          "Wild Card",
        ),
      ],
    };
    provider.gamesByWeek = new Map([
      [
        weekKey(WEEK_TYPE.POSTSEASON, 1),
        [
          providerGame({
            providerGameId: "post1",
            weekType: WEEK_TYPE.POSTSEASON,
            weekNumber: 1,
            homeTeamAbbr: "TBD",
            homeTeamName: "TBD",
            homeTeamProviderId: "-1",
            awayTeamAbbr: "TBD",
            awayTeamName: "TBD",
            awayTeamProviderId: "-2",
          }),
        ],
      ],
    ]);
    // Real listing carries only resolved teams — TBD placeholders never appear.
    provider.teams = [providerTeam({ providerTeamId: "kc-id", abbreviation: "KC", name: "KC" })];

    const details = await runOk();
    expect(details).toMatchObject({ teamsEnriched: 0 });

    const tbdTeams = await db.select().from(teams).where(eq(teams.abbreviation, "TBD"));
    expect(tbdTeams).toHaveLength(2);
    for (const team of tbdTeams) {
      expect(team.location).toBeNull();
      expect(team.logoLightUrl).toBeNull();
      expect(team.logoDarkUrl).toBeNull();
    }
  });

  it("a changed logo url on a subsequent run updates the row in place", async () => {
    seedBaselineProvider();
    provider.teams = [
      providerTeam({
        providerTeamId: "hom-id",
        location: "Home City",
        logoLightUrl: "https://example.com/hom-light.png",
        logoDarkUrl: "https://example.com/hom-dark.png",
      }),
    ];
    await runOk();

    provider.teams = [
      providerTeam({
        providerTeamId: "hom-id",
        location: "Home City",
        logoLightUrl: "https://example.com/hom-light-v2.png",
        logoDarkUrl: "https://example.com/hom-dark.png",
      }),
    ];
    const details = await runOk();
    expect(details).toMatchObject({ teamsEnriched: 1 });

    const [homeTeam] = await db.select().from(teams).where(eq(teams.providerTeamId, "hom-id"));
    expect(homeTeam?.logoLightUrl).toBe("https://example.com/hom-light-v2.png");
  });
});

describe("offseason lifecycle: ensure next NFL season exists (ADR-0009)", () => {
  const UPCOMING_YEAR = SEASON_YEAR + 1;

  /** A single default-season week ending well before FIXED_NOW — "concluded". */
  function seedConcludedDefaultSeason() {
    provider.structure = {
      seasonYear: SEASON_YEAR,
      weeks: [providerWeek(1, "2026-09-01T00:00:00.000Z", "2026-09-08T00:00:00.000Z")],
    };
  }

  async function upcomingSeasonRow() {
    const [row] = await db.select().from(sportSeasons).where(eq(sportSeasons.year, UPCOMING_YEAR));
    return row;
  }

  it("no weeks at all (fresh env) skips the ensure step", async () => {
    // provider.structure defaults to weeks: [] in beforeEach, so the default
    // season itself never gets any week rows this run.
    const details = await runOk();
    expect(details).toMatchObject({
      upcoming: "skipped_no_weeks",
      upcomingSeasonYear: UPCOMING_YEAR,
    });
    expect(await upcomingSeasonRow()).toBeUndefined();
  });

  it("default season not concluded (a week still ends after now) skips the ensure step", async () => {
    seedBaselineProvider(); // week 2 ends 2026-09-22, after FIXED_NOW.
    const details = await runOk();
    expect(details).toMatchObject({
      upcoming: "skipped_not_concluded",
      upcomingSeasonYear: UPCOMING_YEAR,
    });
    expect(await upcomingSeasonRow()).toBeUndefined();
  });

  it("boundary: the greatest endsAt exactly equal to now counts as concluded (documented `<=`)", async () => {
    provider.structure = {
      seasonYear: SEASON_YEAR,
      weeks: [providerWeek(1, "2026-09-08T00:00:00.000Z", FIXED_NOW.toISOString())],
    };
    provider.structureByYear.set(UPCOMING_YEAR, { seasonYear: UPCOMING_YEAR, weeks: [] });

    const details = await runOk();
    expect(details).toMatchObject({ upcoming: "provisional", upcomingSeasonYear: UPCOMING_YEAR });
  });

  it("an explicit ?season= run never triggers the ensure step, even for a concluded season", async () => {
    seedConcludedDefaultSeason();
    provider.structureByYear.set(UPCOMING_YEAR, { seasonYear: UPCOMING_YEAR, weeks: [] });

    const details = await runOk(`?season=${SEASON_YEAR}`);
    expect(details).not.toHaveProperty("upcoming");
    expect(details).not.toHaveProperty("upcomingSeasonYear");
    expect(await upcomingSeasonRow()).toBeUndefined();
  });

  it("concluded + provider hasn't published next season yet → provisional season with the estimated skeleton, zero games", async () => {
    seedConcludedDefaultSeason();
    provider.structureByYear.set(UPCOMING_YEAR, { seasonYear: UPCOMING_YEAR, weeks: [] });

    const details = await runOk();
    expect(details).toMatchObject({ upcoming: "provisional", upcomingSeasonYear: UPCOMING_YEAR });

    const upcomingSeason = await upcomingSeasonRow();
    expect(upcomingSeason).toMatchObject({ sport: SPORT.NFL, provisional: true });

    const upcomingWeeks = await db
      .select()
      .from(weeks)
      .where(eq(weeks.seasonId, upcomingSeason!.id));
    expect(upcomingWeeks).toHaveLength(22);
    const week1 = upcomingWeeks.find(
      (week) => week.weekType === WEEK_TYPE.REGULAR && week.weekNumber === 1,
    );
    expect(week1?.startsAt).toEqual(estimatedNflWeeks(UPCOMING_YEAR)[0]?.startsAt);

    const upcomingGames = await db
      .select()
      .from(games)
      .innerJoin(weeks, eq(games.weekId, weeks.id))
      .where(eq(weeks.seasonId, upcomingSeason!.id));
    expect(upcomingGames).toHaveLength(0);
  });

  it("is idempotent: re-running a concluded+unpublished offseason leaves the provisional season byte-identical", async () => {
    seedConcludedDefaultSeason();
    provider.structureByYear.set(UPCOMING_YEAR, { seasonYear: UPCOMING_YEAR, weeks: [] });
    await runOk();

    const firstSeason = await upcomingSeasonRow();
    const firstWeeks = await db
      .select()
      .from(weeks)
      .where(eq(weeks.seasonId, firstSeason!.id))
      .orderBy(weeks.weekType, weeks.weekNumber);

    // A strictly later clock proves the no-op re-run never touches updatedAt.
    const laterClock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    const details = await syncNflSchedule(db, laterClock, provider);
    expect(details).toMatchObject({ upcoming: "provisional", upcomingSeasonYear: UPCOMING_YEAR });

    const secondSeason = await upcomingSeasonRow();
    const secondWeeks = await db
      .select()
      .from(weeks)
      .where(eq(weeks.seasonId, secondSeason!.id))
      .orderBy(weeks.weekType, weeks.weekNumber);
    expect(secondSeason).toEqual(firstSeason);
    expect(secondWeeks).toEqual(firstWeeks);
  });

  it("concluded + provider later publishes the real structure → clears provisional, corrects estimated weeks in place, ingests games", async () => {
    seedConcludedDefaultSeason();
    provider.structureByYear.set(UPCOMING_YEAR, { seasonYear: UPCOMING_YEAR, weeks: [] });
    await runOk();

    const provisionalSeason = await upcomingSeasonRow();
    const [provisionalWeek1] = await db
      .select()
      .from(weeks)
      .where(
        and(
          eq(weeks.seasonId, provisionalSeason!.id),
          eq(weeks.weekType, WEEK_TYPE.REGULAR),
          eq(weeks.weekNumber, 1),
        ),
      );

    // ESPN publishes the real schedule — a different week 1 start than the estimate.
    const realWeek1Starts = new Date("2027-09-10T00:00:00.000Z");
    expect(provisionalWeek1?.startsAt.getTime()).not.toBe(realWeek1Starts.getTime());
    provider.structureByYear.set(UPCOMING_YEAR, {
      seasonYear: UPCOMING_YEAR,
      weeks: [providerWeek(1, realWeek1Starts.toISOString(), "2027-09-17T00:00:00.000Z")],
    });
    provider.gamesByYearWeek.set(`${UPCOMING_YEAR}:${weekKey(WEEK_TYPE.REGULAR, 1)}`, [
      providerGame({ providerGameId: "next-g1", weekNumber: 1, kickoffAt: realWeek1Starts }),
    ]);

    const details = await runOk();
    expect(details).toMatchObject({ upcoming: "real", upcomingSeasonYear: UPCOMING_YEAR });

    const realSeason = await upcomingSeasonRow();
    // Corrected in place — never re-forked (ADR-0009).
    expect(realSeason?.id).toBe(provisionalSeason?.id);
    expect(realSeason?.provisional).toBe(false);

    const [correctedWeek1] = await db
      .select()
      .from(weeks)
      .where(eq(weeks.id, provisionalWeek1!.id));
    expect(correctedWeek1?.id).toBe(provisionalWeek1?.id);
    expect(correctedWeek1?.startsAt).toEqual(realWeek1Starts);

    const upcomingGames = await db.select().from(games).where(eq(games.providerGameId, "next-g1"));
    expect(upcomingGames).toHaveLength(1);
  });
});

describe("convergence sweep: stale weeks with zero games are dropped (ADR-0009)", () => {
  const SB_KICKOFF = new Date("2027-02-08T23:30:00.000Z");

  function ingest(
    structureWeeks: ProviderWeek[],
    providerGames: ProviderGame[],
    opts?: { provisional?: boolean },
  ) {
    return db.transaction((tx) =>
      ingestSeasonSnapshot(tx, FIXED_NOW, SEASON_YEAR, structureWeeks, providerGames, opts),
    );
  }

  async function seasonRow() {
    const [row] = await db.select().from(sportSeasons).where(eq(sportSeasons.year, SEASON_YEAR));
    return row;
  }

  async function seasonWeeks() {
    const season = await seasonRow();
    return db.select().from(weeks).where(eq(weeks.seasonId, season!.id));
  }

  it("provisional skeleton then the full real structure lands: 22 weeks, matching keys kept in place, nothing orphaned", async () => {
    await ingest(estimatedNflWeeks(SEASON_YEAR), [], { provisional: true });
    const before = await seasonWeeks();
    expect(before).toHaveLength(22);
    const idByKey = new Map(before.map((w) => [weekKey(w.weekType, w.weekNumber), w.id]));

    // Real structure — same 22 domain keys (normalized Super Bowl = 4), shifted dates.
    const realStructure = estimatedNflWeeks(SEASON_YEAR).map((w) => ({
      ...w,
      startsAt: new Date(w.startsAt.getTime() + 86_400_000),
      endsAt: new Date(w.endsAt.getTime() + 86_400_000),
    }));
    const result = await ingest(realStructure, [], { provisional: false });
    expect(result.weeksDeleted).toBe(0);

    const after = await seasonWeeks();
    expect(after).toHaveLength(22);
    for (const w of after) {
      // Corrected in place — matching keys keep their original row id.
      expect(w.id).toBe(idByKey.get(weekKey(w.weekType, w.weekNumber)));
    }
    expect((await seasonRow())?.provisional).toBe(false);
  });

  it("provisional skeleton then a regular-only real structure: estimated postseason weeks (zero games) are swept, 18 weeks, provisional cleared", async () => {
    await ingest(estimatedNflWeeks(SEASON_YEAR), [], { provisional: true });
    expect(await seasonWeeks()).toHaveLength(22);

    const regularOnly = estimatedNflWeeks(SEASON_YEAR).filter(
      (w) => w.weekType === WEEK_TYPE.REGULAR,
    );
    const result = await ingest(regularOnly, [], { provisional: false });
    expect(result.weeksDeleted).toBe(4);

    const after = await seasonWeeks();
    expect(after).toHaveLength(18);
    expect(after.every((w) => w.weekType === WEEK_TYPE.REGULAR)).toBe(true);
    expect((await seasonRow())?.provisional).toBe(false);
  });

  it("never deletes a week that still owns games, even when the structure omits it", async () => {
    const superBowlWeek = providerWeek(
      4,
      "2027-02-08T00:00:00.000Z",
      "2027-02-15T00:00:00.000Z",
      WEEK_TYPE.POSTSEASON,
      "Super Bowl",
    );
    const regularWeek = providerWeek(1, "2026-09-08T00:00:00.000Z", "2026-09-15T00:00:00.000Z");
    await ingest(
      [regularWeek, superBowlWeek],
      [
        providerGame({ providerGameId: "reg", weekNumber: 1 }),
        providerGame({
          providerGameId: "sb",
          weekType: WEEK_TYPE.POSTSEASON,
          weekNumber: 4,
          kickoffAt: SB_KICKOFF,
        }),
      ],
    );
    expect(await seasonWeeks()).toHaveLength(2);

    // The structure now omits postseason 4; the Super Bowl game is NOT
    // re-supplied, so it stays put on its week — the sweep must spare a week
    // that still owns games.
    const result = await ingest(
      [regularWeek],
      [providerGame({ providerGameId: "reg", weekNumber: 1 })],
    );
    expect(result.weeksDeleted).toBe(0);

    const after = await seasonWeeks();
    expect(after.some((w) => w.weekType === WEEK_TYPE.POSTSEASON && w.weekNumber === 4)).toBe(true);
  });

  it("legacy self-heal: a Super Bowl stored under the old ESPN number 5 is repointed to the domain 4 and the empty 5-row swept", async () => {
    // Legacy DB state: full structure with the Super Bowl numbered 5 (what the
    // pre-normalization adapter stored) carrying its game.
    const legacyStructure = estimatedNflWeeks(SEASON_YEAR).map((w) =>
      w.weekType === WEEK_TYPE.POSTSEASON && w.weekNumber === 4 ? { ...w, weekNumber: 5 } : w,
    );
    await ingest(legacyStructure, [
      providerGame({
        providerGameId: "sb",
        weekType: WEEK_TYPE.POSTSEASON,
        weekNumber: 5,
        kickoffAt: SB_KICKOFF,
      }),
    ]);
    const legacyWeeks = await seasonWeeks();
    expect(legacyWeeks).toHaveLength(22);
    expect(legacyWeeks.some((w) => w.weekType === WEEK_TYPE.POSTSEASON && w.weekNumber === 5)).toBe(
      true,
    );

    // Next bare sync: normalized structure (Super Bowl = 4) and the same game
    // now addressed under the domain number 4.
    const result = await ingest(estimatedNflWeeks(SEASON_YEAR), [
      providerGame({
        providerGameId: "sb",
        weekType: WEEK_TYPE.POSTSEASON,
        weekNumber: 4,
        kickoffAt: SB_KICKOFF,
      }),
    ]);
    expect(result.weekMoves).toBe(1);
    expect(result.weeksDeleted).toBe(1);

    const after = await seasonWeeks();
    expect(after).toHaveLength(22);
    expect(after.some((w) => w.weekType === WEEK_TYPE.POSTSEASON && w.weekNumber === 5)).toBe(
      false,
    );
    const sbWeek4 = after.find((w) => w.weekType === WEEK_TYPE.POSTSEASON && w.weekNumber === 4);
    expect(sbWeek4).toBeDefined();
    const [game] = await db.select().from(games).where(eq(games.providerGameId, "sb"));
    expect(game?.weekId).toBe(sbWeek4?.id);
  });

  it("never deletes a week that holds zero games but still holds a pick — the sync still succeeds despite the RESTRICT FK", async () => {
    const week1 = providerWeek(1, "2026-09-08T00:00:00.000Z", "2026-09-15T00:00:00.000Z");
    const week2 = providerWeek(2, "2026-09-15T00:00:00.000Z", "2026-09-22T00:00:00.000Z");
    await ingest([week1, week2], [providerGame({ providerGameId: "g1", weekNumber: 1 })]);

    const season = await seasonRow();
    const week1Row = (await seasonWeeks()).find(
      (w) => w.weekType === WEEK_TYPE.REGULAR && w.weekNumber === 1,
    )!;
    const [g1Before] = await db.select().from(games).where(eq(games.providerGameId, "g1"));

    // A member picks g1 while it still belongs to week 1 — pickem_picks
    // denormalizes the week the pick was made in independently of the game's
    // own week_id (PKM-2), which is exactly what lets the two diverge below.
    const [league] = await db
      .insert(leagues)
      .values({
        name: "Sweep Test League",
        mode: LEAGUE_MODE.PICKEM,
        visibility: LEAGUE_VISIBILITY.PRIVATE,
        maxMembers: 10,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      })
      .returning();
    const [leagueSeason] = await db
      .insert(leagueSeasons)
      .values({
        leagueId: league!.id,
        seasonId: season!.id,
        settings: DEFAULT_PICKEM_SETTINGS,
        status: LEAGUE_STATUS.ACTIVE,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      })
      .returning();
    const [user] = await db
      .insert(users)
      .values({
        id: randomUUID(),
        display_name: "Picker",
        email: "picker@example.com",
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      })
      .returning();
    const [member] = await db
      .insert(leagueMembers)
      .values({
        leagueId: league!.id,
        userId: user!.id,
        role: MEMBER_ROLE.COMMISSIONER,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      })
      .returning();
    await db.insert(pickemPicks).values({
      leagueSeasonId: leagueSeason!.id,
      leagueMemberId: member!.id,
      weekId: week1Row.id,
      gameId: g1Before!.id,
      side: PICK_SIDE.HOME,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });

    // g1 moves to week 2 and week 1 drops out of the published structure —
    // week 1 is now both game-free and orphaned, but the pick above still
    // addresses it. Before the fix, deleting it would hit pickem_picks' own
    // RESTRICT FK and abort (and keep aborting on every future tick) the
    // whole sync transaction.
    const result = await ingest([week2], [providerGame({ providerGameId: "g1", weekNumber: 2 })]);
    expect(result.weeksDeleted).toBe(0);

    const after = await seasonWeeks();
    expect(after.some((w) => w.id === week1Row.id)).toBe(true);

    const [pick] = await db
      .select()
      .from(pickemPicks)
      .where(eq(pickemPicks.leagueMemberId, member!.id));
    expect(pick?.weekId).toBe(week1Row.id);

    const [g1After] = await db.select().from(games).where(eq(games.providerGameId, "g1"));
    expect(g1After?.weekId).not.toBe(week1Row.id);
  });
});
