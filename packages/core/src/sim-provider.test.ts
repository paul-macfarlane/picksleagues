import { describe, expect, it } from "vitest";
import { GAME_STATUS, SIM_FINAL_STATUS, WEEK_TYPE } from "@picksleagues/schemas";
import { FixedClock } from "./clock";
import {
  projectFixtureGame,
  SIM_GAME_DURATION_MS,
  SimulatedProvider,
  type SimFixtureGameRow,
  type SimFixtureSnapshot,
} from "./sim-provider";

const KICKOFF = new Date("2026-09-13T17:00:00.000Z");

function fixture(overrides: Partial<SimFixtureGameRow> = {}): SimFixtureGameRow {
  return {
    providerGameId: "sim-1",
    weekType: WEEK_TYPE.REGULAR,
    weekNumber: 1,
    homeTeamAbbr: "PHI",
    homeTeamName: "Eagles",
    homeTeamProviderId: "21",
    awayTeamAbbr: "DAL",
    awayTeamName: "Cowboys",
    awayTeamProviderId: "6",
    kickoffAt: KICKOFF,
    spread: -3.5,
    finalStatus: SIM_FINAL_STATUS.FINAL,
    finalHomeScore: 24,
    finalAwayScore: 17,
    ...overrides,
  };
}

const at = (offsetMs: number) => new Date(KICKOFF.getTime() + offsetMs);

describe("projectFixtureGame", () => {
  // The boundary instants are the whole point of the projection: they are what
  // the derived-lock rule (arch D11) and settlement eligibility read.
  const PERIOD_MS = SIM_GAME_DURATION_MS / 4;

  it.each([
    {
      name: "long before kickoff",
      now: at(-7 * 24 * 60 * 60 * 1000),
      expected: {
        status: GAME_STATUS.SCHEDULED,
        homeScore: null,
        awayScore: null,
        period: null,
        clockSeconds: null,
      },
    },
    {
      name: "one millisecond before kickoff",
      now: at(-1),
      expected: {
        status: GAME_STATUS.SCHEDULED,
        homeScore: null,
        awayScore: null,
        period: null,
        clockSeconds: null,
      },
    },
    {
      name: "exactly at kickoff — half-open, so the game has started",
      now: at(0),
      expected: {
        status: GAME_STATUS.IN_PROGRESS,
        homeScore: 0,
        awayScore: 0,
        // Top of the first quarter, clock untouched.
        period: 1,
        clockSeconds: 900,
      },
    },
    {
      name: "mid-game",
      now: at(SIM_GAME_DURATION_MS / 2),
      expected: {
        status: GAME_STATUS.IN_PROGRESS,
        homeScore: 0,
        awayScore: 0,
        // Halfway through the window is the top of the third quarter.
        period: 3,
        clockSeconds: 900,
      },
    },
    {
      name: "halfway through the second quarter",
      now: at(PERIOD_MS * 1.5),
      expected: {
        status: GAME_STATUS.IN_PROGRESS,
        homeScore: 0,
        awayScore: 0,
        period: 2,
        clockSeconds: 450,
      },
    },
    {
      name: "one millisecond before the game ends",
      now: at(SIM_GAME_DURATION_MS - 1),
      expected: {
        status: GAME_STATUS.IN_PROGRESS,
        homeScore: 0,
        awayScore: 0,
        // Still the fourth quarter, with the clock all but expired — `ceil`
        // keeps it off 0:00 until the instant the period actually ends.
        period: 4,
        clockSeconds: 1,
      },
    },
    {
      name: "exactly at the end of the game window",
      now: at(SIM_GAME_DURATION_MS),
      expected: {
        status: GAME_STATUS.FINAL,
        homeScore: 24,
        awayScore: 17,
        period: null,
        clockSeconds: null,
      },
    },
    {
      name: "long after the game",
      now: at(30 * 24 * 60 * 60 * 1000),
      expected: {
        status: GAME_STATUS.FINAL,
        homeScore: 24,
        awayScore: 17,
        period: null,
        clockSeconds: null,
      },
    },
  ])("$name", ({ now, expected }) => {
    expect(projectFixtureGame(fixture(), now)).toEqual(expected);
  });

  it("holds the in-progress score stable across the whole window", () => {
    const early = projectFixtureGame(fixture(), at(1));
    const late = projectFixtureGame(fixture(), at(SIM_GAME_DURATION_MS - 1));
    // Scores only: the game clock deliberately *does* move with the simulated
    // clock (DATA-8), which is what makes an advancing simulator exercise the
    // live-state ingestion path.
    expect(early.homeScore).toEqual(late.homeScore);
    expect(early.awayScore).toEqual(late.awayScore);
    expect(early.status).toEqual(late.status);
  });

  it("is deterministic — the same instant always projects the same clock", () => {
    const now = at(PERIOD_MS * 2.25);
    expect(projectFixtureGame(fixture(), now)).toEqual(projectFixtureGame(fixture(), now));
  });

  it("counts the clock down monotonically within a period", () => {
    const readings = [0, 0.25, 0.5, 0.75].map(
      (share) => projectFixtureGame(fixture(), at(PERIOD_MS * (2 + share))).clockSeconds,
    );
    expect(readings).toEqual([900, 675, 450, 225]);
  });

  // A cancelled or postponed game is announced, never played — the clock must
  // not walk it through scheduled → in_progress → final.
  it.each([SIM_FINAL_STATUS.CANCELLED, SIM_FINAL_STATUS.POSTPONED])(
    "reports %s at every instant, with no scores",
    (finalStatus) => {
      const game = fixture({ finalStatus, finalHomeScore: null, finalAwayScore: null });
      for (const now of [
        at(-1000),
        at(0),
        at(SIM_GAME_DURATION_MS / 2),
        at(SIM_GAME_DURATION_MS),
      ]) {
        expect(projectFixtureGame(game, now)).toEqual({
          status: finalStatus,
          homeScore: null,
          awayScore: null,
          period: null,
          clockSeconds: null,
        });
      }
    },
  );

  it("carries a final game's null scores through rather than inventing them", () => {
    const game = fixture({ finalHomeScore: null, finalAwayScore: null });
    expect(projectFixtureGame(game, at(SIM_GAME_DURATION_MS))).toEqual({
      status: GAME_STATUS.FINAL,
      homeScore: null,
      awayScore: null,
      period: null,
      clockSeconds: null,
    });
  });
});

describe("SimulatedProvider", () => {
  const snapshot: SimFixtureSnapshot = {
    seasonYear: 2026,
    weeks: [
      {
        weekType: WEEK_TYPE.REGULAR,
        weekNumber: 1,
        label: "Week 1",
        startsAt: new Date("2026-09-10T00:00:00.000Z"),
        endsAt: new Date("2026-09-16T00:00:00.000Z"),
      },
    ],
    games: [
      fixture({ providerGameId: "sim-1", weekNumber: 1 }),
      fixture({ providerGameId: "sim-2", weekNumber: 2, homeTeamAbbr: "NYG" }),
      fixture({
        providerGameId: "sim-3",
        weekType: WEEK_TYPE.POSTSEASON,
        weekNumber: 1,
        homeTeamAbbr: "KC",
      }),
    ],
    teams: [
      {
        providerTeamId: "21",
        abbreviation: "PHI",
        name: "Eagles",
        location: "Philadelphia",
        logoLightUrl: null,
        logoDarkUrl: null,
      },
    ],
  };

  function makeProvider(now: Date, reader = async () => snapshot) {
    return new SimulatedProvider(reader, new FixedClock(now));
  }

  it("serves the scenario's season structure", async () => {
    const provider = makeProvider(at(-1000));
    await expect(provider.fetchNflSeasonStructure(2026)).resolves.toEqual({
      seasonYear: 2026,
      weeks: snapshot.weeks,
    });
  });

  // Mirrors EspnProvider's "season not published" shape (ADR-0009) rather than
  // throwing: a loaded scenario owns exactly one season.
  it("reports no weeks for a season the scenario does not cover", async () => {
    const provider = makeProvider(at(-1000));
    await expect(provider.fetchNflSeasonStructure(2024)).resolves.toEqual({
      seasonYear: 2024,
      weeks: [],
    });
  });

  it("returns no games for a season the scenario does not cover", async () => {
    const provider = makeProvider(at(-1000));
    await expect(provider.fetchNflWeekGames(2024, WEEK_TYPE.REGULAR, 1)).resolves.toEqual([]);
  });

  it("filters to the requested week, discriminating on week type", async () => {
    const provider = makeProvider(at(-1000));
    const regular = await provider.fetchNflWeekGames(2026, WEEK_TYPE.REGULAR, 1);
    const postseason = await provider.fetchNflWeekGames(2026, WEEK_TYPE.POSTSEASON, 1);
    expect(regular.map((game) => game.providerGameId)).toEqual(["sim-1"]);
    expect(postseason.map((game) => game.providerGameId)).toEqual(["sim-3"]);
  });

  it("projects games through the clock and carries the fixture spread", async () => {
    const before = await makeProvider(at(-1)).fetchNflWeekGames(2026, WEEK_TYPE.REGULAR, 1);
    const after = await makeProvider(at(SIM_GAME_DURATION_MS)).fetchNflWeekGames(
      2026,
      WEEK_TYPE.REGULAR,
      1,
    );
    expect(before[0]).toMatchObject({
      status: GAME_STATUS.SCHEDULED,
      homeScore: null,
      awayScore: null,
      spread: -3.5,
      homeTeamProviderId: "21",
      awayTeamProviderId: "6",
    });
    expect(after[0]).toMatchObject({
      status: GAME_STATUS.FINAL,
      homeScore: 24,
      awayScore: 17,
      spread: -3.5,
    });
  });

  // A sync job fetches week by week; every read within it must see one snapshot.
  it("reads fixtures once per instance no matter how many calls it serves", async () => {
    let reads = 0;
    const provider = makeProvider(at(0), async () => {
      reads += 1;
      return snapshot;
    });
    await provider.fetchNflSeasonStructure(2026);
    await provider.fetchNflWeekGames(2026, WEEK_TYPE.REGULAR, 1);
    await provider.fetchNflWeekGames(2026, WEEK_TYPE.REGULAR, 2);
    await provider.fetchNflTeams();
    expect(reads).toBe(1);
  });

  it("serves the scenario's teams", async () => {
    await expect(makeProvider(at(0)).fetchNflTeams()).resolves.toEqual(snapshot.teams);
  });
});
