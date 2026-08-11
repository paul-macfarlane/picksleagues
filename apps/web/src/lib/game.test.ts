import { describe, expect, it } from "vitest";
import { GAME_STATUS, PICK_OUTCOME, type GameStatus } from "@picksleagues/schemas";
import {
  isClosedToPicks,
  survivorPickGrade,
  survivorProvisionalOutcome,
  survivorRevivalStillPossible,
} from "./game";

describe("isClosedToPicks", () => {
  it.each([
    {
      name: "an unlocked, playable game is still open",
      game: { locked: false, pickable: true },
      expected: false,
    },
    { name: "kickoff closes it", game: { locked: true, pickable: true }, expected: true },
    {
      name: "a cancelled game closes it",
      game: { locked: false, pickable: false },
      expected: true,
    },
    {
      name: "both at once still closes it",
      game: { locked: true, pickable: false },
      expected: true,
    },
  ])("$name", ({ game, expected }) => {
    expect(isClosedToPicks(game)).toBe(expected);
  });
});

// Must mirror settlement's per-pick mapping exactly (`gradePick` in
// packages/scoring/src/survivor.ts) — a derived verdict the settled grade later
// contradicts is worse than the silence it replaced.
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
