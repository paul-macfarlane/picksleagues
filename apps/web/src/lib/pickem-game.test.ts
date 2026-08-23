import { describe, expect, it } from "vitest";
import {
  GAME_STATUS,
  PICK_OUTCOME,
  PICK_TYPE,
  PICKEM_PICK_SIDE,
  type GameStatus,
  type PickemPickSide,
} from "@picksleagues/schemas";
import { settlePickemWeek } from "@picksleagues/scoring";
import { pickemPickGrade } from "./pickem-game";

describe("pickemPickGrade", () => {
  const game = (
    status: GameStatus,
    homeScore: number | null = null,
    awayScore: number | null = null,
  ) => ({ status, homeScore, awayScore });
  const pick = (side: PickemPickSide, spreadAtPick: number | null = null) => ({
    side,
    spreadAtPick,
    outcome: null,
  });

  const cases = [
    {
      name: "scheduled game is undecided",
      game: game(GAME_STATUS.SCHEDULED),
      pick: pick(PICKEM_PICK_SIDE.HOME),
      pickType: PICK_TYPE.STRAIGHT_UP,
      expected: null,
    },
    {
      name: "in-progress game is undecided — the standing label covers it",
      game: game(GAME_STATUS.IN_PROGRESS, 14, 7),
      pick: pick(PICKEM_PICK_SIDE.HOME),
      pickType: PICK_TYPE.STRAIGHT_UP,
      expected: null,
    },
    {
      name: "postponed game is undecided — it plays later",
      game: game(GAME_STATUS.POSTPONED),
      pick: pick(PICKEM_PICK_SIDE.HOME),
      pickType: PICK_TYPE.STRAIGHT_UP,
      expected: null,
    },
    {
      name: "final without scores is undecided — a provider fault, not a verdict",
      game: game(GAME_STATUS.FINAL),
      pick: pick(PICKEM_PICK_SIDE.HOME),
      pickType: PICK_TYPE.STRAIGHT_UP,
      expected: null,
    },
    {
      name: "cancelled game pushes (spec §Cancellations & Postponements)",
      game: game(GAME_STATUS.CANCELLED),
      pick: pick(PICKEM_PICK_SIDE.AWAY),
      pickType: PICK_TYPE.STRAIGHT_UP,
      expected: PICK_OUTCOME.PUSH,
    },
    {
      name: "SU final win",
      game: game(GAME_STATUS.FINAL, 27, 17),
      pick: pick(PICKEM_PICK_SIDE.HOME),
      pickType: PICK_TYPE.STRAIGHT_UP,
      expected: PICK_OUTCOME.CORRECT,
    },
    {
      name: "SU final loss",
      game: game(GAME_STATUS.FINAL, 27, 17),
      pick: pick(PICKEM_PICK_SIDE.AWAY),
      pickType: PICK_TYPE.STRAIGHT_UP,
      expected: PICK_OUTCOME.INCORRECT,
    },
    {
      name: "SU final tie pushes",
      game: game(GAME_STATUS.FINAL, 20, 20),
      pick: pick(PICKEM_PICK_SIDE.HOME),
      pickType: PICK_TYPE.STRAIGHT_UP,
      expected: PICK_OUTCOME.PUSH,
    },
    {
      name: "ATS: favourite wins the game but not the number",
      game: game(GAME_STATUS.FINAL, 24, 21),
      pick: pick(PICKEM_PICK_SIDE.HOME, -3.5),
      pickType: PICK_TYPE.AGAINST_THE_SPREAD,
      expected: PICK_OUTCOME.INCORRECT,
    },
    {
      name: "ATS: underdog covers in a loss",
      game: game(GAME_STATUS.FINAL, 24, 21),
      pick: pick(PICKEM_PICK_SIDE.AWAY, -3.5),
      pickType: PICK_TYPE.AGAINST_THE_SPREAD,
      expected: PICK_OUTCOME.CORRECT,
    },
    {
      name: "ATS: landing exactly on the number pushes",
      game: game(GAME_STATUS.FINAL, 24, 21),
      pick: pick(PICKEM_PICK_SIDE.HOME, -3),
      pickType: PICK_TYPE.AGAINST_THE_SPREAD,
      expected: PICK_OUTCOME.PUSH,
    },
    {
      name: "ATS pick with no spread has nothing to measure against",
      game: game(GAME_STATUS.FINAL, 24, 21),
      pick: pick(PICKEM_PICK_SIDE.HOME, null),
      pickType: PICK_TYPE.AGAINST_THE_SPREAD,
      expected: null,
    },
  ];

  it.each(cases)("$name", ({ game, pick, pickType, expected }) => {
    expect(pickemPickGrade(game, pick, pickType)).toBe(expected);
  });

  it("prefers the settled outcome over the derivation", () => {
    // A contradiction that can't occur in practice — pinned so the precedence
    // (settled wins) is a tested contract rather than an accident of ordering,
    // same as `survivorPickGrade`'s test.
    expect(
      pickemPickGrade(
        game(GAME_STATUS.FINAL, 27, 17),
        { side: PICKEM_PICK_SIDE.HOME, spreadAtPick: null, outcome: PICK_OUTCOME.PUSH },
        PICK_TYPE.STRAIGHT_UP,
      ),
    ).toBe(PICK_OUTCOME.PUSH);
  });

  // The derivation's whole warrant (spec §Settled pick margin) is that the
  // grade replacing it can never disagree — so every decidable case above is
  // also run through settlement itself. Undecidable cases stay out: settlement
  // leaves them unsettled, and an ATS pick without a spread makes it throw
  // (that's a write-path bug there, merely nothing-to-show here).
  it.each(cases.filter((c) => c.expected !== null))(
    "agrees with settlement: $name",
    ({ game, pick, pickType, expected }) => {
      const settled = settlePickemWeek(
        [
          {
            pickId: "p1",
            memberId: "m1",
            gameId: "g1",
            side: pick.side,
            spreadAtPick: pick.spreadAtPick,
          },
        ],
        [{ gameId: "g1", ...game }],
        { pickType },
      );
      expect(settled.outcomes[0]?.outcome).toBe(expected);
    },
  );
});
