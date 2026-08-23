import { describe, expect, it } from "vitest";
import { GAME_STATUS, PICK_OUTCOME, type GameStatus } from "@picksleagues/schemas";
import {
  survivorPickGrade,
  survivorProvisionalOutcome,
  survivorRevivalStillPossible,
  survivorWeeksSurvived,
} from "./survivor-game";

describe("survivorProvisionalOutcome", () => {
  const HOME = { id: "home" };
  const AWAY = { id: "away" };
  const game = (
    status: GameStatus,
    homeScore: number | null = null,
    awayScore: number | null = null,
  ) => ({
    status,
    homeScore,
    awayScore,
    homeTeam: HOME,
    awayTeam: AWAY,
  });

  it.each([
    {
      name: "scheduled game is undecided",
      game: game(GAME_STATUS.SCHEDULED),
      teamId: "home",
      expected: null,
    },
    {
      name: "in-progress game is undecided",
      game: game(GAME_STATUS.IN_PROGRESS, 14, 7),
      teamId: "home",
      expected: null,
    },
    {
      name: "postponed game is undecided — it plays later",
      game: game(GAME_STATUS.POSTPONED),
      teamId: "home",
      expected: null,
    },
    {
      name: "final without scores is undecided — a provider fault, not a verdict",
      game: game(GAME_STATUS.FINAL),
      teamId: "home",
      expected: null,
    },
    {
      name: "final win",
      game: game(GAME_STATUS.FINAL, 27, 17),
      teamId: "home",
      expected: PICK_OUTCOME.CORRECT,
    },
    {
      name: "final loss",
      game: game(GAME_STATUS.FINAL, 27, 17),
      teamId: "away",
      expected: PICK_OUTCOME.INCORRECT,
    },
    {
      name: "final tie is a push — the member advances (ADR-0033)",
      game: game(GAME_STATUS.FINAL, 20, 20),
      teamId: "home",
      expected: PICK_OUTCOME.PUSH,
    },
    {
      name: "cancelled game pushes — the member survives",
      game: game(GAME_STATUS.CANCELLED),
      teamId: "away",
      expected: PICK_OUTCOME.PUSH,
    },
  ])("$name", ({ game, teamId, expected }) => {
    expect(survivorProvisionalOutcome(game, teamId)).toBe(expected);
  });
});

describe("survivorRevivalStillPossible", () => {
  const finalGame = (homeScore: number, awayScore: number) => ({
    status: GAME_STATUS.FINAL,
    homeScore,
    awayScore,
    homeTeamId: "home",
    awayTeamId: "away",
  });
  const lost = { teamId: "away", outcome: null, game: finalGame(24, 10) };
  const won = { teamId: "home", outcome: null, game: finalGame(24, 10) };
  const tied = { teamId: "home", outcome: null, game: finalGame(20, 20) };
  const pending = {
    teamId: "home",
    outcome: null,
    game: { ...finalGame(0, 0), status: GAME_STATUS.IN_PROGRESS },
  };
  const hidden = { teamId: null, outcome: null, game: null };

  it.each([
    {
      name: "everyone's pick has lost — revival still on the table",
      picks: [lost, lost],
      expected: true,
    },
    { name: "one derived win disproves it", picks: [lost, won], expected: false },
    {
      name: "a tie advances (ADR-0033), so it disproves it too",
      picks: [lost, tied],
      expected: false,
    },
    {
      name: "a settled correct outcome disproves it",
      picks: [lost, { ...hidden, teamId: "home", outcome: PICK_OUTCOME.CORRECT }],
      expected: false,
    },
    { name: "a pending game keeps it possible", picks: [lost, pending], expected: true },
    { name: "a hidden pick keeps it possible", picks: [lost, hidden], expected: true },
    { name: "a member with no pick yet keeps it possible", picks: [lost, null], expected: true },
    { name: "nobody alive at all — vacuously possible", picks: [], expected: true },
  ])("$name", ({ picks, expected }) => {
    expect(survivorRevivalStillPossible(picks)).toBe(expected);
  });
});

describe("survivorPickGrade", () => {
  it("prefers the settled outcome over the derivation", () => {
    // A contradiction that can't occur in practice — pinned so the precedence
    // (settled wins) is a tested contract rather than an accident of ordering.
    expect(
      survivorPickGrade({
        teamId: "home",
        outcome: PICK_OUTCOME.PUSH,
        game: {
          status: GAME_STATUS.FINAL,
          homeScore: 24,
          awayScore: 10,
          homeTeamId: "home",
          awayTeamId: "away",
        },
      }),
    ).toBe(PICK_OUTCOME.PUSH);
  });

  it("returns null for a withheld pick — no team, no game, no verdict", () => {
    expect(survivorPickGrade({ teamId: null, outcome: null, game: null })).toBeNull();
  });
});

describe("survivorWeeksSurvived", () => {
  it.each([
    { name: "no picks", outcomes: [], expected: 0 },
    { name: "wins count", outcomes: [PICK_OUTCOME.CORRECT, PICK_OUTCOME.CORRECT], expected: 2 },
    { name: "a push advances (ADR-0033)", outcomes: [PICK_OUTCOME.PUSH], expected: 1 },
    {
      name: "the losing week is not survived",
      outcomes: [PICK_OUTCOME.CORRECT, PICK_OUTCOME.INCORRECT],
      expected: 1,
    },
    {
      name: "an unsettled or withheld pick is not counted yet",
      outcomes: [PICK_OUTCOME.CORRECT, null],
      expected: 1,
    },
  ])("$name", ({ outcomes, expected }) => {
    expect(survivorWeeksSurvived(outcomes.map((outcome) => ({ outcome })))).toBe(expected);
  });
});
