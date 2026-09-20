import { describe, expect, it } from "vitest";
import { GAME_STATUS, WEEK_TYPE, type GameStatus } from "@picksleagues/schemas";
import { buildNflTeamSchedule, type ResolvedScheduleGame } from "./game-schedule";

const CURRENT = 2026;

/** A log game between `home` and `away`; kickoff spaced by week so ordering is real. */
function logGame(
  overrides: Partial<ResolvedScheduleGame> & {
    week: number;
    status: GameStatus;
    home?: string;
    away?: string;
  },
): ResolvedScheduleGame {
  const { week, home = "HOM", away = "AWY", ...rest } = overrides;
  return {
    seasonYear: CURRENT,
    weekType: WEEK_TYPE.REGULAR,
    weekNumber: week,
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

describe("buildNflTeamSchedule", () => {
  it("serves the available season schedule in kickoff order, from the team's perspective", () => {
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
    const log = buildNflTeamSchedule([...rows].reverse(), "HOM", CURRENT);
    expect(log).toMatchObject({
      seasonYear: CURRENT,
      entries: [
        { weekLabel: "Week 1", opponentAbbr: "AWY", atHome: true, status: "final", result: "W" },
        { weekLabel: "Week 2", opponentAbbr: "OTH", atHome: false, status: "final", result: "W" },
        {
          weekLabel: "Week 3",
          opponentAbbr: "AWY",
          atHome: true,
          status: "scheduled",
          result: null,
        },
      ],
    });
  });

  it("grades losses and ties from the team's side of the score", () => {
    const rows = [
      logGame({ week: 1, status: GAME_STATUS.FINAL, homeScore: 20, awayScore: 27 }),
      logGame({ week: 2, status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 24 }),
    ];
    const entries = buildNflTeamSchedule(rows, "HOM", CURRENT)!.entries;
    expect(entries.filter((entry) => entry.kind === "game").map((entry) => entry.result)).toEqual([
      "L",
      "T",
    ]);
    const awayEntries = buildNflTeamSchedule(rows, "AWY", CURRENT)!.entries;
    expect(
      awayEntries.filter((entry) => entry.kind === "game").map((entry) => entry.result),
    ).toEqual(["W", "T"]);
  });

  it("serves an in-progress game as a live entry: no result, scores as they stand", () => {
    const rows = [
      logGame({ week: 1, status: GAME_STATUS.IN_PROGRESS, homeScore: 10, awayScore: 3 }),
    ];
    const [entry] = buildNflTeamSchedule(rows, "HOM", CURRENT)!.entries;
    expect(entry).toMatchObject({
      status: "in_progress",
      result: null,
      teamScore: 10,
      opponentScore: 3,
    });
  });

  it("gives a final missing a score no result — a dash, never an invented outcome", () => {
    const rows = [logGame({ week: 1, status: GAME_STATUS.FINAL, homeScore: 21, awayScore: null })];
    const [entry] = buildNflTeamSchedule(rows, "HOM", CURRENT)!.entries;
    expect(entry).toMatchObject({ status: "final", result: null });
  });

  it("includes scheduled, postponed, and cancelled fixtures", () => {
    const rows = [
      logGame({ week: 1, status: GAME_STATUS.SCHEDULED }),
      logGame({ week: 2, status: GAME_STATUS.POSTPONED }),
      logGame({ week: 3, status: GAME_STATUS.CANCELLED }),
    ];
    expect(buildNflTeamSchedule(rows, "HOM", CURRENT)).toMatchObject({
      entries: [
        { weekLabel: "Week 1", status: "scheduled" },
        { weekLabel: "Week 2", status: "postponed" },
        { weekLabel: "Week 3", status: "cancelled" },
      ],
    });
  });

  it("inserts a bye only when 17 distinct regular-season games prove the missing week", () => {
    const rows = Array.from({ length: 18 }, (_unused, index) => index + 1)
      .filter((week) => week !== 7)
      .map((week) => logGame({ week, status: GAME_STATUS.SCHEDULED }));

    const schedule = buildNflTeamSchedule(rows, "HOM", CURRENT)!;
    expect(schedule.entries).toHaveLength(18);
    expect(schedule.entries[6]).toEqual({ kind: "bye", weekLabel: "Week 7" });
    expect(schedule.entries[7]).toMatchObject({ kind: "game", weekLabel: "Week 8" });
  });

  it("does not mistake a partial or ambiguous schedule for a bye", () => {
    const partial = Array.from({ length: 16 }, (_unused, index) =>
      logGame({ week: index + 1, status: GAME_STATUS.SCHEDULED }),
    );
    expect(buildNflTeamSchedule(partial, "HOM", CURRENT)!.entries).toHaveLength(16);

    const duplicateWeek = [
      ...Array.from({ length: 16 }, (_unused, index) =>
        logGame({ week: index + 1, status: GAME_STATUS.SCHEDULED }),
      ),
      logGame({ week: 16, status: GAME_STATUS.SCHEDULED, away: "DUP" }),
    ];
    expect(buildNflTeamSchedule(duplicateWeek, "HOM", CURRENT)!.entries).toHaveLength(17);
  });

  it("falls back to the prior season only while the current has no ingested schedule (ADR-0040)", () => {
    const prior = logGame({
      week: 17,
      status: GAME_STATUS.FINAL,
      seasonYear: CURRENT - 1,
      homeScore: 30,
      awayScore: 13,
    });
    expect(buildNflTeamSchedule([prior], "HOM", CURRENT)).toMatchObject({
      seasonYear: CURRENT - 1,
    });
    const currentScheduled = logGame({ week: 1, status: GAME_STATUS.SCHEDULED });
    expect(buildNflTeamSchedule([prior, currentScheduled], "HOM", CURRENT)).toMatchObject({
      seasonYear: CURRENT,
      entries: [{ weekLabel: "Week 1", status: "scheduled" }],
    });

    const currentStarted = logGame({
      week: 1,
      status: GAME_STATUS.IN_PROGRESS,
      homeScore: 0,
      awayScore: 0,
    });
    const log = buildNflTeamSchedule([prior, currentScheduled, currentStarted], "HOM", CURRENT)!;
    expect(log.seasonYear).toBe(CURRENT);
    expect(log.entries).toHaveLength(2);
  });

  it("is null for a team with no available schedule in either season", () => {
    expect(buildNflTeamSchedule([], "HOM", CURRENT)).toBeNull();
    const otherTeams = [logGame({ week: 1, status: GAME_STATUS.FINAL, home: "A", away: "B" })];
    expect(buildNflTeamSchedule(otherTeams, "HOM", CURRENT)).toBeNull();
  });
});
