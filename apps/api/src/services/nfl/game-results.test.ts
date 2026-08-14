import { describe, expect, it } from "vitest";
import { GAME_STATUS, type GameStatus } from "@picksleagues/schemas";
import { buildNflTeamGameLog, type ResolvedLogGame } from "./game-results";

const CURRENT = 2026;

/** A log game between `home` and `away`; kickoff spaced by week so ordering is real. */
function logGame(
  overrides: Partial<ResolvedLogGame> & {
    week: number;
    status: GameStatus;
    home?: string;
    away?: string;
  },
): ResolvedLogGame {
  const { week, home = "HOM", away = "AWY", ...rest } = overrides;
  return {
    seasonYear: CURRENT,
    weekLabel: `Week ${week}`,
    kickoffAt: new Date(Date.UTC(2026, 8, 7 + week * 7)),
    homeTeamId: home,
    awayTeamId: away,
    homeAbbr: home,
    awayAbbr: away,
    homeScore: null,
    awayScore: null,
    ...rest,
  };
}

describe("buildNflTeamGameLog", () => {
  it("serves started games newest first, from the team's perspective", () => {
    const rows = [
      logGame({ week: 1, status: GAME_STATUS.FINAL, homeScore: 27, awayScore: 20 }),
      logGame({
        week: 2,
        status: GAME_STATUS.FINAL,
        home: "OTH",
        away: "HOM",
        homeScore: 14,
        awayScore: 31,
      }),
      logGame({ week: 3, status: GAME_STATUS.SCHEDULED }),
    ];
    const log = buildNflTeamGameLog(rows, "HOM", CURRENT);
    expect(log).toEqual({
      seasonYear: CURRENT,
      entries: [
        {
          weekLabel: "Week 2",
          opponentAbbr: "OTH",
          atHome: false,
          final: true,
          teamScore: 31,
          opponentScore: 14,
          result: "W",
        },
        {
          weekLabel: "Week 1",
          opponentAbbr: "AWY",
          atHome: true,
          final: true,
          teamScore: 27,
          opponentScore: 20,
          result: "W",
        },
      ],
    });
  });

  it("grades losses and ties from the team's side of the score", () => {
    const rows = [
      logGame({ week: 1, status: GAME_STATUS.FINAL, homeScore: 20, awayScore: 27 }),
      logGame({ week: 2, status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 24 }),
    ];
    const entries = buildNflTeamGameLog(rows, "HOM", CURRENT)!.entries;
    expect(entries.map((entry) => entry.result)).toEqual(["T", "L"]);
    const awayEntries = buildNflTeamGameLog(rows, "AWY", CURRENT)!.entries;
    expect(awayEntries.map((entry) => entry.result)).toEqual(["T", "W"]);
  });

  it("serves an in-progress game as a live entry: no result, scores as they stand", () => {
    const rows = [
      logGame({ week: 1, status: GAME_STATUS.IN_PROGRESS, homeScore: 10, awayScore: 3 }),
    ];
    const [entry] = buildNflTeamGameLog(rows, "HOM", CURRENT)!.entries;
    expect(entry).toMatchObject({ final: false, result: null, teamScore: 10, opponentScore: 3 });
  });

  it("gives a final missing a score no result — a dash, never an invented outcome", () => {
    const rows = [logGame({ week: 1, status: GAME_STATUS.FINAL, homeScore: 21, awayScore: null })];
    const [entry] = buildNflTeamGameLog(rows, "HOM", CURRENT)!.entries;
    expect(entry).toMatchObject({ final: true, result: null });
  });

  it("excludes scheduled, postponed, and cancelled games", () => {
    const rows = [
      logGame({ week: 1, status: GAME_STATUS.SCHEDULED }),
      logGame({ week: 2, status: GAME_STATUS.POSTPONED }),
      logGame({ week: 3, status: GAME_STATUS.CANCELLED }),
    ];
    expect(buildNflTeamGameLog(rows, "HOM", CURRENT)).toBeNull();
  });

  it("falls back to the prior season only while the current has no started games (ADR-0040)", () => {
    const prior = logGame({
      week: 17,
      status: GAME_STATUS.FINAL,
      seasonYear: CURRENT - 1,
      homeScore: 30,
      awayScore: 13,
    });
    const currentScheduled = logGame({ week: 1, status: GAME_STATUS.SCHEDULED });
    expect(buildNflTeamGameLog([prior, currentScheduled], "HOM", CURRENT)).toMatchObject({
      seasonYear: CURRENT - 1,
    });

    const currentStarted = logGame({
      week: 1,
      status: GAME_STATUS.IN_PROGRESS,
      homeScore: 0,
      awayScore: 0,
    });
    const log = buildNflTeamGameLog([prior, currentScheduled, currentStarted], "HOM", CURRENT)!;
    expect(log.seasonYear).toBe(CURRENT);
    expect(log.entries).toHaveLength(1);
  });

  it("is null for a team with nothing started in either season", () => {
    expect(buildNflTeamGameLog([], "HOM", CURRENT)).toBeNull();
    const otherTeams = [logGame({ week: 1, status: GAME_STATUS.FINAL, home: "A", away: "B" })];
    expect(buildNflTeamGameLog(otherTeams, "HOM", CURRENT)).toBeNull();
  });
});
