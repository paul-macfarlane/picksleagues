import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { games, sportSeasons, weeks } from "@picksleagues/db";
import {
  FixedClock,
  type ProviderGame,
  type ProviderSeasonStructure,
  type ProviderWeek,
} from "@picksleagues/core";
import {
  GAME_STATUS,
  SPORT,
  WEEK_TYPE,
  type WeekType,
  type JobRunResponse,
} from "@picksleagues/schemas";
import { BaseFakeProvider } from "./setup/fake-provider";
import { resolveGameOverrides } from "../src/services/games";
import { syncNflSchedule } from "../src/services/nfl/sync-schedule";
import { syncNflOdds } from "../src/services/nfl/sync-odds";
import { providerGame, providerWeek } from "./setup/provider-fixtures";
import { resetDb } from "./setup/reset-db";
import { makeFixedAppHarness } from "./setup/fixed-app";
import { makeTestEnv } from "./setup/test-env";
import { runOddsSyncJob } from "./setup/jobs";

const testEnv = makeTestEnv();

const SEASON_YEAR = 2026;
// Week 1 runs 09-08 → 09-15; "now" sits mid-week, after g1's kickoff and
// before g2/g3's, so g1 is started and g2/g3 are not.
const ODDS_NOW = new Date("2026-09-12T00:00:00.000Z");
const seedClock = new FixedClock(new Date("2026-09-01T00:00:00.000Z"));
const oddsClock = new FixedClock(ODDS_NOW);

/** Regular and postseason week numbers overlap, so the fake keys games by both. */
function weekKey(weekType: WeekType, weekNumber: number): string {
  return `${weekType}:${weekNumber}`;
}

class FakeProvider extends BaseFakeProvider {
  structure: ProviderSeasonStructure = { seasonYear: SEASON_YEAR, weeks: [] };
  gamesByWeek = new Map<string, ProviderGame[]>();

  override async fetchNflSeasonStructure(): Promise<ProviderSeasonStructure> {
    return this.structure;
  }

  override async fetchNflWeekGames(
    _seasonYear: number,
    weekType: WeekType,
    weekNumber: number,
  ): Promise<ProviderGame[]> {
    return this.gamesByWeek.get(weekKey(weekType, weekNumber)) ?? [];
  }
}

const { db, appAt } = makeFixedAppHarness();
const provider = new FakeProvider();
const app = appAt(oddsClock.now(), { env: testEnv, provider: async () => provider });

/** Current spread per provider game id — the state a re-run must leave alone. */
async function spreadsByProviderId(): Promise<Map<string, number | null>> {
  const rows = await db
    .select({ providerGameId: games.providerGameId, spread: games.spread })
    .from(games);
  return new Map(rows.map((row) => [row.providerGameId, row.spread]));
}

/** Seeds one season + the given week with its games via the real schedule sync. */
async function seedSchedule(
  weekGames: ProviderGame[],
  week: ProviderWeek = providerWeek(1, "2026-09-08T00:00:00.000Z", "2026-09-15T00:00:00.000Z"),
) {
  provider.structure = { seasonYear: SEASON_YEAR, weeks: [week] };
  provider.gamesByWeek = new Map([[weekKey(week.weekType, week.weekNumber), weekGames]]);
  await syncNflSchedule(db, seedClock, provider, { seasonYear: SEASON_YEAR });
}

beforeEach(async () => {
  await resetDb(db);
  provider.structure = { seasonYear: SEASON_YEAR, weeks: [] };
  provider.gamesByWeek = new Map();
});

afterAll(async () => {
  await db.$client.end();
});

describe("syncNflOdds", () => {
  it("prices only unstarted games (a game past its kickoff is excluded)", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g1",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-11T17:00:00.000Z"),
        spread: -3.5,
      }),
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: 2.5,
      }),
    ]);

    const details = await syncNflOdds(db, oddsClock, provider, {});
    expect(details).toMatchObject({
      seasonYear: SEASON_YEAR,
      weekNumber: 1,
      unstartedGames: 1,
      spreadsUpdated: 1,
      gamesWithoutOdds: 0,
    });

    // g1 already kicked off, so its line is never touched — the provider's -3.5
    // for it must not land.
    expect(await spreadsByProviderId()).toEqual(
      new Map([
        ["g1", null],
        ["g2", 2.5],
      ]),
    );
  });

  /**
   * Found by manual regression testing (runbook Pass 4, ATS variant). Keying on
   * `status = scheduled` denied a postponed game any spread, so an ATS league
   * refused every pick on it with `spread_unavailable` — permanently, since a
   * postponement is announced ahead of time and never becomes `scheduled` again.
   *
   * Both directions matter and are asserted together: the slate calls a
   * postponed game pickable (it is played later, spec §Cancellations) and a
   * cancelled one not, so the odds sync has to draw the line in the same place
   * or the app offers a pick it will always reject.
   */
  it("prices a postponed game whose kickoff is still ahead, but never a cancelled one", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "postponed",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: -3.5,
        status: GAME_STATUS.POSTPONED,
      }),
      providerGame({
        providerGameId: "cancelled",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T20:00:00.000Z"),
        spread: 6.5,
        status: GAME_STATUS.CANCELLED,
      }),
    ]);

    const details = await syncNflOdds(db, oddsClock, provider, {});
    expect(details).toMatchObject({ unstartedGames: 1, spreadsUpdated: 1 });

    expect(await spreadsByProviderId()).toEqual(
      new Map([
        ["postponed", -3.5],
        ["cancelled", null],
      ]),
    );
  });

  it("stamps updated_at from the injected clock, not the DB clock", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: 2.5,
      }),
    ]);

    await syncNflOdds(db, oddsClock, provider, {});

    const [g2] = await db.select().from(games).where(eq(games.providerGameId, "g2"));
    expect(g2?.spread).toBe(2.5);
    expect(g2?.updatedAt).toEqual(ODDS_NOW);
  });

  it("counts unstarted games without a provider line and leaves their spread alone", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: 2.5,
      }),
      providerGame({
        providerGameId: "g3",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T20:00:00.000Z"),
        spread: null,
      }),
    ]);

    const details = await syncNflOdds(db, oddsClock, provider, {});
    expect(details).toMatchObject({ unstartedGames: 2, spreadsUpdated: 1, gamesWithoutOdds: 1 });
    expect(await spreadsByProviderId()).toEqual(
      new Map([
        ["g2", 2.5],
        ["g3", null],
      ]),
    );
  });

  // The point of the collapse (ADR-0018): one current number per game, no
  // history. `updated_at` is compared too — it is served as the row's as-of
  // instant, so a re-run that restamped it would be a visible change even
  // though the line never moved.
  it("re-running against the same provider response leaves row state identical", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: 2.5,
      }),
      providerGame({
        providerGameId: "g3",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T20:00:00.000Z"),
        spread: null,
      }),
    ]);

    const first = await syncNflOdds(db, oddsClock, provider, {});
    expect(first).toMatchObject({ unstartedGames: 2, spreadsUpdated: 1, gamesWithoutOdds: 1 });
    const afterFirst = await db.select().from(games).orderBy(games.providerGameId);

    const second = await syncNflOdds(db, oddsClock, provider, {});
    expect(second).toMatchObject({ unstartedGames: 2, spreadsUpdated: 0, gamesWithoutOdds: 1 });

    expect(await db.select().from(games).orderBy(games.providerGameId)).toEqual(afterFirst);
  });

  it("writes the new number when the line moves, and only then", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: 2.5,
      }),
    ]);
    await syncNflOdds(db, oddsClock, provider, {});

    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: -1.5,
      }),
    ]);

    const details = await syncNflOdds(db, oddsClock, provider, {});
    expect(details).toMatchObject({ spreadsUpdated: 1 });
    expect(await spreadsByProviderId()).toEqual(new Map([["g2", -1.5]]));
  });

  /**
   * PKM-9: written in the same `set()` as `spread`, never as an `override_*`
   * (arch D15) — asserted directly against the row since `spreadsByProviderId`
   * only tracks the number.
   */
  describe("spread_source (PKM-9)", () => {
    it("writes the book alongside the spread", async () => {
      await seedSchedule([
        providerGame({
          providerGameId: "g2",
          weekNumber: 1,
          kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
          spread: 2.5,
          spreadSource: "DraftKings",
        }),
      ]);

      const details = await syncNflOdds(db, oddsClock, provider, {});
      expect(details).toMatchObject({ spreadsUpdated: 1 });

      const [g2] = await db.select().from(games).where(eq(games.providerGameId, "g2"));
      expect(g2).toMatchObject({ spread: 2.5, spreadSource: "DraftKings" });
    });

    it("re-running with the same number and the same book leaves the row a true no-op", async () => {
      await seedSchedule([
        providerGame({
          providerGameId: "g2",
          weekNumber: 1,
          kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
          spread: 2.5,
          spreadSource: "DraftKings",
        }),
      ]);
      await syncNflOdds(db, oddsClock, provider, {});
      const afterFirst = await db.select().from(games).where(eq(games.providerGameId, "g2"));

      const second = await syncNflOdds(db, oddsClock, provider, {});
      expect(second).toMatchObject({ spreadsUpdated: 0 });
      expect(await db.select().from(games).where(eq(games.providerGameId, "g2"))).toEqual(
        afterFirst,
      );
    });

    it("writes when the book changes even though the number didn't move", async () => {
      await seedSchedule([
        providerGame({
          providerGameId: "g2",
          weekNumber: 1,
          kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
          spread: 2.5,
          spreadSource: "DraftKings",
        }),
      ]);
      await syncNflOdds(db, oddsClock, provider, {});

      provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [
        providerGame({
          providerGameId: "g2",
          weekNumber: 1,
          kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
          spread: 2.5,
          spreadSource: "ESPN BET",
        }),
      ]);

      const details = await syncNflOdds(db, oddsClock, provider, {});
      expect(details).toMatchObject({ spreadsUpdated: 1 });
      const [g2] = await db.select().from(games).where(eq(games.providerGameId, "g2"));
      expect(g2).toMatchObject({ spread: 2.5, spreadSource: "ESPN BET" });
    });

    it("never writes a source for a game with no line", async () => {
      await seedSchedule([
        providerGame({
          providerGameId: "g3",
          weekNumber: 1,
          kickoffAt: new Date("2026-09-14T20:00:00.000Z"),
          spread: null,
          spreadSource: null,
        }),
      ]);

      const details = await syncNflOdds(db, oddsClock, provider, {});
      expect(details).toMatchObject({ gamesWithoutOdds: 1, spreadsUpdated: 0 });
      const [g3] = await db.select().from(games).where(eq(games.providerGameId, "g3"));
      expect(g3).toMatchObject({ spread: null, spreadSource: null });
    });
  });

  // Arch D15: ingestion writes provider columns only, so a correction outlives
  // every re-sync — and the resolved number an operator sees stays theirs.
  it("never clobbers an override_spread, and the override still wins after the re-sync", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: 2.5,
      }),
    ]);
    await db.update(games).set({ overrideSpread: -7 });

    await syncNflOdds(db, oddsClock, provider, {});

    const [g2] = await db.select().from(games).where(eq(games.providerGameId, "g2"));
    expect(g2).toMatchObject({ spread: 2.5, overrideSpread: -7 });
    expect(resolveGameOverrides(g2!).spread).toBe(-7);
  });

  it("pre-season: with no in-progress week, falls back to the next upcoming week and prices it", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: 2.5,
      }),
    ]);

    // Clock sits before week 1 starts (2026-09-08), so there is no in-progress
    // week — the next-upcoming-week fallback resolves week 1.
    const preSeasonClock = new FixedClock(new Date("2026-09-01T00:00:00.000Z"));
    const details = await syncNflOdds(db, preSeasonClock, provider, {});
    expect(details).toMatchObject({ weekNumber: 1, unstartedGames: 1, spreadsUpdated: 1 });
    expect(await spreadsByProviderId()).toEqual(new Map([["g2", 2.5]]));
  });

  it("off-season: after every week has ended with no explicit week, no_current_week and writes nothing", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: 2.5,
      }),
    ]);

    // Clock sits after week 1 ends (2026-09-15) with no later week to fall to.
    const offSeasonClock = new FixedClock(new Date("2026-09-20T00:00:00.000Z"));
    const details = await syncNflOdds(db, offSeasonClock, provider, {});
    expect(details).toMatchObject({ skipped: true, reason: "no_current_week" });
    expect(await spreadsByProviderId()).toEqual(new Map([["g2", null]]));
  });

  it("explicit week: prices the requested week's unstarted games", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: 2.5,
      }),
    ]);

    const details = await syncNflOdds(db, oddsClock, provider, { weekNumber: 1 });
    expect(details).toMatchObject({ seasonYear: SEASON_YEAR, weekNumber: 1, spreadsUpdated: 1 });
    expect(await spreadsByProviderId()).toEqual(new Map([["g2", 2.5]]));
  });

  it("explicit postseason week: prices that week's unstarted postseason games", async () => {
    await seedSchedule(
      [
        providerGame({
          providerGameId: "post1",
          weekType: WEEK_TYPE.POSTSEASON,
          weekNumber: 1,
          kickoffAt: new Date("2027-01-10T18:00:00.000Z"),
          spread: -4.5,
        }),
      ],
      providerWeek(
        1,
        "2027-01-09T00:00:00.000Z",
        "2027-01-13T00:00:00.000Z",
        WEEK_TYPE.POSTSEASON,
        "Wild Card",
      ),
    );

    const details = await syncNflOdds(db, oddsClock, provider, {
      weekType: WEEK_TYPE.POSTSEASON,
      weekNumber: 1,
    });
    expect(details).toMatchObject({ seasonYear: SEASON_YEAR, weekNumber: 1, spreadsUpdated: 1 });

    expect(await spreadsByProviderId()).toEqual(new Map([["post1", -4.5]]));
  });

  it("explicit week that isn't synced returns week_not_synced (distinct from the derived no_current_week)", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: 2.5,
      }),
    ]);

    const details = await syncNflOdds(db, oddsClock, provider, { weekNumber: 5 });
    expect(details).toMatchObject({ skipped: true, reason: "week_not_synced" });
    expect(await spreadsByProviderId()).toEqual(new Map([["g2", null]]));
  });

  it("no-ops when the season has not been synced and writes nothing", async () => {
    const details = await syncNflOdds(db, oddsClock, provider, {});
    expect(details).toMatchObject({ skipped: true, reason: "season_not_synced" });
    expect(await db.select().from(sportSeasons)).toHaveLength(0);
    expect(await db.select().from(weeks)).toHaveLength(0);
    expect(await spreadsByProviderId()).toEqual(new Map());
  });

  it("ignores a provider game that isn't in our tables (never creates games/weeks)", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: 2.5,
      }),
    ]);

    // Provider now reports an extra game we never ingested.
    provider.gamesByWeek.set(weekKey(WEEK_TYPE.REGULAR, 1), [
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: 2.5,
      }),
      providerGame({
        providerGameId: "unknown",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: -7,
      }),
    ]);

    const details = await syncNflOdds(db, oddsClock, provider, {});
    expect(details).toMatchObject({ unstartedGames: 1, spreadsUpdated: 1 });
    expect(await db.select().from(games)).toHaveLength(1);
    expect(await db.select().from(weeks)).toHaveLength(1);
    expect(await spreadsByProviderId()).toEqual(new Map([["g2", 2.5]]));
  });
});

/**
 * The boundary SIMP-16 was opened to establish. Windows here are the real ESPN
 * shape, not a convenient one — see `WEEK_1`/`WEEK_2` below.
 */
describe("syncNflOdds: real ESPN week windows (the Tuesday gap)", () => {
  /**
   * Verified against the live ESPN core API on 2026-08-05
   * (`sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2025/types/2/weeks/{n}`),
   * the same endpoint `EspnProvider` reads. After the opening week, an ESPN week
   * runs Wednesday ~07:00Z to the following Wednesday ~06:59Z (08:00Z/07:59Z
   * once EST starts) and the windows are contiguous — no gap between them:
   *
   *   reg wk 1: 2025-09-04T07:00Z (Thu) → 2025-09-10T06:59Z (Wed)
   *   reg wk 2: 2025-09-10T07:00Z (Wed) → 2025-09-17T06:59Z (Wed)
   *   reg wk 3: 2025-09-17T07:00Z (Wed) → 2025-09-24T06:59Z (Wed)
   *
   * Shifted onto this suite's 2026 season (opener Thursday 2026-09-10). The
   * consequence: on a Tuesday the *current* week is the one already played, so
   * a current-week-only target prices nothing at all and the coming weekend's
   * games carry no line until Wednesday ~3am ET.
   */
  const WEEK_1 = providerWeek(1, "2026-09-10T07:00:00.000Z", "2026-09-16T06:59:00.000Z");
  const WEEK_2 = providerWeek(2, "2026-09-16T07:00:00.000Z", "2026-09-23T06:59:00.000Z");
  const WEEK_3 = providerWeek(3, "2026-09-23T07:00:00.000Z", "2026-09-30T06:59:00.000Z");

  // Tuesday afternoon ET, inside week 1's window with every week-1 game played.
  const TUESDAY = new Date("2026-09-15T18:00:00.000Z");
  // Thursday afternoon ET, inside week 2's window and before its first kickoff.
  const MID_WEEK = new Date("2026-09-17T18:00:00.000Z");

  const WEEK_1_GAMES = [
    providerGame({
      providerGameId: "w1-sun",
      weekNumber: 1,
      kickoffAt: new Date("2026-09-13T17:00:00.000Z"),
      spread: -3.5,
    }),
    providerGame({
      providerGameId: "w1-mon",
      weekNumber: 1,
      kickoffAt: new Date("2026-09-15T00:15:00.000Z"),
      spread: 1.5,
    }),
  ];
  const WEEK_2_GAMES = [
    providerGame({
      providerGameId: "w2-thu",
      weekNumber: 2,
      kickoffAt: new Date("2026-09-18T00:15:00.000Z"),
      spread: -6.5,
    }),
    providerGame({
      providerGameId: "w2-sun",
      weekNumber: 2,
      kickoffAt: new Date("2026-09-20T17:00:00.000Z"),
      spread: 2.5,
    }),
  ];
  const WEEK_3_GAMES = [
    providerGame({
      providerGameId: "w3-sun",
      weekNumber: 3,
      kickoffAt: new Date("2026-09-27T17:00:00.000Z"),
      spread: -7.5,
    }),
  ];

  async function seedThreeWeeks() {
    provider.structure = { seasonYear: SEASON_YEAR, weeks: [WEEK_1, WEEK_2, WEEK_3] };
    provider.gamesByWeek = new Map([
      [weekKey(WEEK_TYPE.REGULAR, 1), WEEK_1_GAMES],
      [weekKey(WEEK_TYPE.REGULAR, 2), WEEK_2_GAMES],
      [weekKey(WEEK_TYPE.REGULAR, 3), WEEK_3_GAMES],
    ]);
    await syncNflSchedule(db, seedClock, provider, { seasonYear: SEASON_YEAR });
  }

  it("Tuesday, with the current week fully played: the coming week's games still come out priced", async () => {
    await seedThreeWeeks();

    const details = await syncNflOdds(db, new FixedClock(TUESDAY), provider, {});
    expect(details).toMatchObject({
      seasonYear: SEASON_YEAR,
      weekNumber: 1,
      unstartedGames: 2,
      spreadsUpdated: 2,
      gamesWithoutOdds: 0,
    });

    expect(await spreadsByProviderId()).toEqual(
      new Map([
        ["w1-sun", null],
        ["w1-mon", null],
        ["w2-thu", -6.5],
        ["w2-sun", 2.5],
        // Two weeks out, not one — pricing the whole rest of the season would
        // be a different job.
        ["w3-sun", null],
      ]),
    );
  });

  it("mid-week: prices what is left of the current week and all of the next", async () => {
    await seedThreeWeeks();

    const details = await syncNflOdds(db, new FixedClock(MID_WEEK), provider, {});
    expect(details).toMatchObject({ weekNumber: 2, unstartedGames: 3, spreadsUpdated: 3 });

    expect(await spreadsByProviderId()).toEqual(
      new Map([
        ["w1-sun", null],
        ["w1-mon", null],
        ["w2-thu", -6.5],
        ["w2-sun", 2.5],
        ["w3-sun", -7.5],
      ]),
    );
  });

  it("re-running over both weeks leaves row state identical", async () => {
    await seedThreeWeeks();
    const tuesdayClock = new FixedClock(TUESDAY);

    await syncNflOdds(db, tuesdayClock, provider, {});
    const afterFirst = await db.select().from(games).orderBy(games.providerGameId);

    const second = await syncNflOdds(db, tuesdayClock, provider, {});
    expect(second).toMatchObject({ unstartedGames: 2, spreadsUpdated: 0 });
    expect(await db.select().from(games).orderBy(games.providerGameId)).toEqual(afterFirst);
  });

  it("an explicit week targets that week and only that week", async () => {
    await seedThreeWeeks();

    const details = await syncNflOdds(db, new FixedClock(TUESDAY), provider, { weekNumber: 2 });
    expect(details).toMatchObject({ weekNumber: 2, weeksTargeted: 1, spreadsUpdated: 2 });

    // Week 3 stays unpriced: naming a week is the narrow, manual path.
    expect(await spreadsByProviderId()).toEqual(
      new Map([
        ["w1-sun", null],
        ["w1-mon", null],
        ["w2-thu", -6.5],
        ["w2-sun", 2.5],
        ["w3-sun", null],
      ]),
    );
  });

  // The week after regular week 18 is postseason week 1: the following week is
  // found by start time, never by week type, or the Wild Card slate would sit
  // unpriced through the last regular-season week.
  it("the week following the last regular week is the first postseason week", async () => {
    provider.structure = {
      seasonYear: SEASON_YEAR,
      weeks: [
        providerWeek(18, "2026-12-30T08:00:00.000Z", "2027-01-06T07:59:00.000Z"),
        providerWeek(
          1,
          "2027-01-06T08:00:00.000Z",
          "2027-01-13T07:59:00.000Z",
          WEEK_TYPE.POSTSEASON,
          "Wild Card",
        ),
      ],
    };
    provider.gamesByWeek = new Map([
      [
        weekKey(WEEK_TYPE.REGULAR, 18),
        [
          providerGame({
            providerGameId: "reg18",
            weekNumber: 18,
            kickoffAt: new Date("2027-01-03T18:00:00.000Z"),
            spread: -1.5,
          }),
        ],
      ],
      [
        weekKey(WEEK_TYPE.POSTSEASON, 1),
        [
          providerGame({
            providerGameId: "wc1",
            weekType: WEEK_TYPE.POSTSEASON,
            weekNumber: 1,
            kickoffAt: new Date("2027-01-09T21:30:00.000Z"),
            spread: -4.5,
          }),
        ],
      ],
    ]);
    await syncNflSchedule(db, seedClock, provider, { seasonYear: SEASON_YEAR });

    // Friday of regular week 18, before its Sunday games.
    const details = await syncNflOdds(
      db,
      new FixedClock(new Date("2027-01-01T18:00:00.000Z")),
      provider,
      {},
    );
    expect(details).toMatchObject({ weekNumber: 18, unstartedGames: 2, spreadsUpdated: 2 });

    expect(await spreadsByProviderId()).toEqual(
      new Map([
        ["reg18", -1.5],
        ["wc1", -4.5],
      ]),
    );
  });
});

/**
 * `nflSeasonYearFor` maps Jan–Jul back to the prior season label, so all
 * offseason a bare run would derive a season whose weeks are already over while
 * next season's games sit unsynced — and an ATS league can take no picks until
 * their odds exist (locking is `kickoff > now`, so members can pick that early).
 */
describe("syncNflOdds: offseason season roll-forward", () => {
  const NEXT_SEASON_YEAR = SEASON_YEAR + 1;
  // July 2027 → nflSeasonYearFor derives 2026, the concluded season.
  const offseasonClock = new FixedClock(new Date("2027-07-27T00:00:00.000Z"));

  /** Seeds one season's week + games via the real schedule sync (explicit season). */
  async function seedSeason(seasonYear: number, week: ProviderWeek, weekGames: ProviderGame[]) {
    provider.structure = { seasonYear, weeks: [week] };
    provider.gamesByWeek = new Map([[weekKey(week.weekType, week.weekNumber), weekGames]]);
    await syncNflSchedule(db, seedClock, provider, { seasonYear });
  }

  /** The derived default season, every week of it behind the offseason clock. */
  function seedConcludedDefaultSeason() {
    return seedSeason(
      SEASON_YEAR,
      providerWeek(1, "2026-09-08T00:00:00.000Z", "2026-09-15T00:00:00.000Z"),
      [
        providerGame({
          providerGameId: "g2",
          weekNumber: 1,
          kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
          spread: 2.5,
        }),
      ],
    );
  }

  /** Next season, already ingested by schedule-sync's ensure step (ADR-0009). */
  function seedUpcomingSeason() {
    return seedSeason(
      NEXT_SEASON_YEAR,
      providerWeek(1, "2027-09-09T00:00:00.000Z", "2027-09-16T00:00:00.000Z"),
      [
        providerGame({
          providerGameId: "n1",
          weekNumber: 1,
          kickoffAt: new Date("2027-09-12T17:00:00.000Z"),
          spread: -6.5,
        }),
      ],
    );
  }

  it("default season concluded + next season synced: a bare run prices the NEXT season's first week", async () => {
    await seedConcludedDefaultSeason();
    await seedUpcomingSeason();

    const details = await syncNflOdds(db, offseasonClock, provider, {});
    expect(details).toMatchObject({
      seasonYear: NEXT_SEASON_YEAR,
      weekNumber: 1,
      unstartedGames: 1,
      spreadsUpdated: 1,
    });

    expect(await spreadsByProviderId()).toEqual(
      new Map([
        ["g2", null],
        ["n1", -6.5],
      ]),
    );
  });

  it("default season concluded + NO next season row: no-ops and never creates one", async () => {
    await seedConcludedDefaultSeason();
    const seasonsBefore = await db.select().from(sportSeasons);

    const details = await syncNflOdds(db, offseasonClock, provider, {});
    expect(details).toMatchObject({ skipped: true, reason: "no_current_week" });

    // Creating next year's season is schedule-sync's job — recurring syncs only
    // ever query reference data.
    expect(await db.select().from(sportSeasons)).toEqual(seasonsBefore);
    expect(await spreadsByProviderId()).toEqual(new Map([["g2", null]]));
  });

  it("derived season never synced + next season synced: a bare run prices the NEXT season", async () => {
    // The routine pre-launch shape: a wipe-and-reseed during the offseason
    // seeds only the season about to start, so the derived label points at a
    // season with no rows at all. Rolling forward only on CONCLUDED read that
    // as "stay put" and skipped `season_not_synced` for months.
    await seedUpcomingSeason();

    const details = await syncNflOdds(db, offseasonClock, provider, {});
    expect(details).toMatchObject({
      seasonYear: NEXT_SEASON_YEAR,
      weekNumber: 1,
      unstartedGames: 1,
      spreadsUpdated: 1,
    });
  });

  it("derived season never synced + next season row with no weeks: stays put and creates nothing", async () => {
    // A season row with nothing ingested is nothing to sync either — rolling
    // onto it would trade one no-op for another while hiding which season the
    // run meant.
    const seededAt = seedClock.now();
    await db.insert(sportSeasons).values({
      sport: SPORT.NFL,
      year: NEXT_SEASON_YEAR,
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    const seasonsBefore = await db.select().from(sportSeasons);

    const details = await syncNflOdds(db, offseasonClock, provider, {});
    expect(details).toMatchObject({ skipped: true, reason: "season_not_synced" });

    expect(await db.select().from(sportSeasons)).toEqual(seasonsBefore);
    expect(await spreadsByProviderId()).toEqual(new Map());
  });

  it("an explicit season/week still wins over the roll-forward", async () => {
    await seedConcludedDefaultSeason();
    await seedUpcomingSeason();

    const details = await syncNflOdds(db, offseasonClock, provider, {
      seasonYear: SEASON_YEAR,
      weekNumber: 1,
    });
    // The concluded season's games are all past kickoff, so targeting it writes
    // nothing — the roll-forward would have reported 2027 and one update.
    expect(details).toMatchObject({
      seasonYear: SEASON_YEAR,
      weekNumber: 1,
      unstartedGames: 0,
      spreadsUpdated: 0,
    });
    expect(await spreadsByProviderId()).toEqual(
      new Map([
        ["g2", null],
        ["n1", null],
      ]),
    );
  });

  it("an explicit week with a derived season rolls forward with it", async () => {
    await seedConcludedDefaultSeason();
    await seedUpcomingSeason();

    const details = await syncNflOdds(db, offseasonClock, provider, { weekNumber: 1 });
    expect(details).toMatchObject({ seasonYear: NEXT_SEASON_YEAR, spreadsUpdated: 1 });
  });
});

describe("POST /api/jobs/nfl/sync-odds", () => {
  it("returns the job envelope with the odds counters", async () => {
    await seedSchedule([
      providerGame({
        providerGameId: "g2",
        weekNumber: 1,
        kickoffAt: new Date("2026-09-14T17:00:00.000Z"),
        spread: 2.5,
      }),
    ]);

    const res = await runOddsSyncJob(app);
    expect(res.status).toBe(200);
    const body = (await res.json()) as JobRunResponse;
    expect(body.status).toBe("ok");
    expect(body.details).toMatchObject({ weekNumber: 1, spreadsUpdated: 1 });
  });
});
