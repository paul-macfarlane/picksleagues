import { describe, expect, it } from "vitest";
import {
  GAME_STATUS,
  PICK_TYPE,
  PICKEM_PICK_SIDE,
  PICKEM_PUSH_TIE_RESOLUTION,
  type GameStatus,
  type PickOutcome,
  type PickemPickSide,
  type PickType,
  type PickemPushTieResolution,
} from "@picksleagues/schemas";
import {
  PICKEM_UNSETTLED_REASON,
  pickMargin,
  settlePickemWeek,
  type PickemGameResult,
  type PickemPickInput,
} from "./pickem";

/**
 * The spec §Game Mode 1 scoring/tiebreaker/cancellation matrix is this file's
 * test plan (arch §Automated Testing — "a spec rule without a test case is a
 * review failure"). Raw literals are asserted deliberately: they pin the wire
 * contract, so editing a constant's value fails here loudly.
 */

const GAME_ID = "game-1";

function pick(overrides: Partial<PickemPickInput> = {}): PickemPickInput {
  return {
    pickId: "pick-1",
    memberId: "member-1",
    gameId: GAME_ID,
    side: PICKEM_PICK_SIDE.HOME,
    spreadAtPick: null,
    ...overrides,
  };
}

function result(overrides: Partial<PickemGameResult> = {}): PickemGameResult {
  return {
    gameId: GAME_ID,
    status: GAME_STATUS.FINAL,
    homeScore: 24,
    awayScore: 17,
    ...overrides,
  };
}

function settings(
  pickType: PickType,
  pushTieResolution: PickemPushTieResolution = PICKEM_PUSH_TIE_RESOLUTION.HALF_POINT,
) {
  return { pickType, pushTieResolution };
}

describe("settlePickemWeek — straight up", () => {
  const cases: Array<{
    name: string;
    side: PickemPickSide;
    homeScore: number;
    awayScore: number;
    outcome: PickOutcome;
    points: number;
    differential: number;
  }> = [
    {
      name: "home pick, home wins by 7 → correct, +7 differential",
      side: PICKEM_PICK_SIDE.HOME,
      homeScore: 24,
      awayScore: 17,
      outcome: "correct",
      points: 1,
      differential: 7,
    },
    {
      name: "away pick, home wins by 7 → incorrect, -7 differential",
      side: PICKEM_PICK_SIDE.AWAY,
      homeScore: 24,
      awayScore: 17,
      outcome: "incorrect",
      points: 0,
      differential: -7,
    },
    {
      name: "away pick, away wins by 10 → correct, +10 differential",
      side: PICKEM_PICK_SIDE.AWAY,
      homeScore: 13,
      awayScore: 23,
      outcome: "correct",
      points: 1,
      differential: 10,
    },
    {
      name: "home pick, away wins by 10 → incorrect, -10 differential",
      side: PICKEM_PICK_SIDE.HOME,
      homeScore: 13,
      awayScore: 23,
      outcome: "incorrect",
      points: 0,
      differential: -10,
    },
    {
      name: "home pick, one-point win → correct, +1 differential",
      side: PICKEM_PICK_SIDE.HOME,
      homeScore: 21,
      awayScore: 20,
      outcome: "correct",
      points: 1,
      differential: 1,
    },
  ];

  it.each(cases)("$name", ({ side, homeScore, awayScore, outcome, points, differential }) => {
    const { outcomes, unsettled } = settlePickemWeek(
      [pick({ side })],
      [result({ homeScore, awayScore })],
      settings(PICK_TYPE.STRAIGHT_UP),
    );

    expect(unsettled).toEqual([]);
    expect(outcomes).toEqual([
      { pickId: "pick-1", memberId: "member-1", gameId: GAME_ID, outcome, points, differential },
    ]);
  });

  it("ignores a spread carried on a straight-up pick", () => {
    // A league switched to SU (or a stale row) must not have its grading bent
    // by a leftover number — SU never consults the spread.
    const { outcomes } = settlePickemWeek(
      [pick({ side: PICKEM_PICK_SIDE.HOME, spreadAtPick: -14 })],
      [result({ homeScore: 24, awayScore: 17 })],
      settings(PICK_TYPE.STRAIGHT_UP),
    );

    expect(outcomes[0]).toMatchObject({ outcome: "correct", points: 1, differential: 7 });
  });
});

describe("settlePickemWeek — against the spread", () => {
  // Spreads are home-relative: negative means the home side is favored.
  const cases: Array<{
    name: string;
    side: PickemPickSide;
    spread: number;
    homeScore: number;
    awayScore: number;
    outcome: PickOutcome;
    points: number;
    differential: number;
  }> = [
    {
      name: "home favored by 6, wins by 14 → covers, +8 differential",
      side: PICKEM_PICK_SIDE.HOME,
      spread: -6,
      homeScore: 27,
      awayScore: 13,
      outcome: "correct",
      points: 1,
      differential: 8,
    },
    {
      name: "home favored by 10, wins by 3 → fails to cover, -7 differential",
      side: PICKEM_PICK_SIDE.HOME,
      spread: -10,
      homeScore: 20,
      awayScore: 17,
      outcome: "incorrect",
      points: 0,
      differential: -7,
    },
    {
      name: "away pick against a 10-point favorite that wins by 3 → covers, +7 differential",
      side: PICKEM_PICK_SIDE.AWAY,
      spread: -10,
      homeScore: 20,
      awayScore: 17,
      outcome: "correct",
      points: 1,
      differential: 7,
    },
    {
      name: "home underdog by 3 loses by 1 → covers, +2 differential",
      side: PICKEM_PICK_SIDE.HOME,
      spread: 3,
      homeScore: 20,
      awayScore: 21,
      outcome: "correct",
      points: 1,
      differential: 2,
    },
    {
      name: "away pick laying 3 wins by 1 → fails to cover, -2 differential",
      side: PICKEM_PICK_SIDE.AWAY,
      spread: 3,
      homeScore: 20,
      awayScore: 21,
      outcome: "incorrect",
      points: 0,
      differential: -2,
    },
    {
      name: "half-point spread can never push — home favored by 3.5, wins by 3",
      side: PICKEM_PICK_SIDE.HOME,
      spread: -3.5,
      homeScore: 24,
      awayScore: 21,
      outcome: "incorrect",
      points: 0,
      differential: -0.5,
    },
    {
      name: "half-point spread, away side of the same game covers by 0.5",
      side: PICKEM_PICK_SIDE.AWAY,
      spread: -3.5,
      homeScore: 24,
      awayScore: 21,
      outcome: "correct",
      points: 1,
      differential: 0.5,
    },
    {
      name: "pick'em line (spread 0), home wins → covers by the margin",
      side: PICKEM_PICK_SIDE.HOME,
      spread: 0,
      homeScore: 24,
      awayScore: 17,
      outcome: "correct",
      points: 1,
      differential: 7,
    },
    {
      name: "pick'em line (spread 0), tied score → push",
      side: PICKEM_PICK_SIDE.HOME,
      spread: 0,
      homeScore: 17,
      awayScore: 17,
      outcome: "push",
      points: 0.5,
      differential: 0,
    },
  ];

  it.each(cases)(
    "$name",
    ({ side, spread, homeScore, awayScore, outcome, points, differential }) => {
      const { outcomes, unsettled } = settlePickemWeek(
        [pick({ side, spreadAtPick: spread })],
        [result({ homeScore, awayScore })],
        settings(PICK_TYPE.AGAINST_THE_SPREAD),
      );

      expect(unsettled).toEqual([]);
      expect(outcomes).toEqual([
        { pickId: "pick-1", memberId: "member-1", gameId: GAME_ID, outcome, points, differential },
      ]);
    },
  );
});

/** Every push/tie resolution and the points it awards (spec §Pick'em Scoring). */
const PUSH_RESOLUTIONS: Array<{ resolution: PickemPushTieResolution; points: number }> = [
  { resolution: PICKEM_PUSH_TIE_RESOLUTION.HALF_POINT, points: 0.5 },
  { resolution: PICKEM_PUSH_TIE_RESOLUTION.ZERO_POINTS, points: 0 },
  { resolution: PICKEM_PUSH_TIE_RESOLUTION.FULL_POINT, points: 1 },
];

describe("settlePickemWeek — pushes and ties", () => {
  it.each(PUSH_RESOLUTIONS)(
    "ATS exact push awards $points under $resolution",
    ({ resolution, points }) => {
      // Home favored by 3 and wins by exactly 3.
      const { outcomes } = settlePickemWeek(
        [pick({ side: PICKEM_PICK_SIDE.HOME, spreadAtPick: -3 })],
        [result({ homeScore: 24, awayScore: 21 })],
        settings(PICK_TYPE.AGAINST_THE_SPREAD, resolution),
      );

      expect(outcomes[0]).toMatchObject({ outcome: "push", points, differential: 0 });
    },
  );

  it.each(PUSH_RESOLUTIONS)("SU tie awards $points under $resolution", ({ resolution, points }) => {
    const { outcomes } = settlePickemWeek(
      [pick({ side: PICKEM_PICK_SIDE.HOME })],
      [result({ homeScore: 20, awayScore: 20 })],
      settings(PICK_TYPE.STRAIGHT_UP, resolution),
    );

    expect(outcomes[0]).toMatchObject({ outcome: "push", points, differential: 0 });
  });

  it("pushes the away side of the same ATS push", () => {
    const { outcomes } = settlePickemWeek(
      [pick({ side: PICKEM_PICK_SIDE.AWAY, spreadAtPick: -3 })],
      [result({ homeScore: 24, awayScore: 21 })],
      settings(PICK_TYPE.AGAINST_THE_SPREAD),
    );

    expect(outcomes[0]).toMatchObject({ outcome: "push", differential: 0 });
  });
});

describe("settlePickemWeek — cancellations, moves, postponements", () => {
  const unplayedPushStatuses: GameStatus[] = [GAME_STATUS.CANCELLED, GAME_STATUS.MOVED];

  // `full_point` is the resolution that made the cancelled-game write-path bug
  // (freely pickable, minting guaranteed points) maximally exploitable — a
  // member could lock in a cancelled game for a full point with zero risk.
  it.each(
    unplayedPushStatuses.flatMap((status) =>
      PUSH_RESOLUTIONS.map(({ resolution, points }) => ({ status, resolution, points })),
    ),
  )(
    "a $status game resolves as a push worth $points under $resolution",
    ({ status, resolution, points }) => {
      const { outcomes, unsettled } = settlePickemWeek(
        [pick()],
        [result({ status, homeScore: null, awayScore: null })],
        settings(PICK_TYPE.STRAIGHT_UP, resolution),
      );

      expect(unsettled).toEqual([]);
      expect(outcomes[0]).toMatchObject({ outcome: "push", points, differential: 0 });
    },
  );

  it("a cancelled ATS game pushes without needing a spread", () => {
    const { outcomes } = settlePickemWeek(
      [pick({ spreadAtPick: null })],
      [result({ status: GAME_STATUS.CANCELLED, homeScore: null, awayScore: null })],
      settings(PICK_TYPE.AGAINST_THE_SPREAD),
    );

    expect(outcomes[0]).toMatchObject({ outcome: "push" });
  });

  const notYetPlayed: GameStatus[] = [
    GAME_STATUS.SCHEDULED,
    GAME_STATUS.IN_PROGRESS,
    GAME_STATUS.POSTPONED,
  ];

  it.each(notYetPlayed)("a %s game produces no result yet", (status) => {
    const { outcomes, unsettled } = settlePickemWeek(
      [pick()],
      [result({ status, homeScore: null, awayScore: null })],
      settings(PICK_TYPE.STRAIGHT_UP),
    );

    expect(outcomes).toEqual([]);
    expect(unsettled).toEqual([
      { pickId: "pick-1", gameId: GAME_ID, reason: PICKEM_UNSETTLED_REASON.NOT_YET_PLAYED },
    ]);
  });

  it("a postponed game settles normally once it is played", () => {
    // Spec: postponed within the same week resolves normally when played —
    // the same pick row, graded on the next sweep.
    const { outcomes, unsettled } = settlePickemWeek(
      [pick()],
      [result({ status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 17 })],
      settings(PICK_TYPE.STRAIGHT_UP),
    );

    expect(unsettled).toEqual([]);
    expect(outcomes[0]).toMatchObject({ outcome: "correct", points: 1 });
  });

  it("an in-progress game is never graded against its partial score", () => {
    const { outcomes, unsettled } = settlePickemWeek(
      [pick()],
      [result({ status: GAME_STATUS.IN_PROGRESS, homeScore: 0, awayScore: 0 })],
      settings(PICK_TYPE.STRAIGHT_UP),
    );

    expect(outcomes).toEqual([]);
    expect(unsettled[0]?.reason).toBe(PICKEM_UNSETTLED_REASON.NOT_YET_PLAYED);
  });
});

describe("settlePickemWeek — provider data faults", () => {
  it.each([
    { name: "both scores missing", homeScore: null, awayScore: null },
    { name: "home score missing", homeScore: null, awayScore: 17 },
    { name: "away score missing", homeScore: 24, awayScore: null },
  ])("a final game with $name is surfaced rather than graded", ({ homeScore, awayScore }) => {
    const { outcomes, unsettled } = settlePickemWeek(
      [pick()],
      [result({ status: GAME_STATUS.FINAL, homeScore, awayScore })],
      settings(PICK_TYPE.STRAIGHT_UP),
    );

    expect(outcomes).toEqual([]);
    expect(unsettled).toEqual([
      { pickId: "pick-1", gameId: GAME_ID, reason: PICKEM_UNSETTLED_REASON.FINAL_WITHOUT_SCORES },
    ]);
  });

  it("throws when a pick references a game absent from the results", () => {
    expect(() =>
      settlePickemWeek(
        [pick({ gameId: "missing-game" })],
        [result()],
        settings(PICK_TYPE.STRAIGHT_UP),
      ),
    ).toThrow(/missing-game/);
  });

  it("throws when an ATS pick carries no spread", () => {
    expect(() =>
      settlePickemWeek([pick({ spreadAtPick: null })], [result()], {
        pickType: PICK_TYPE.AGAINST_THE_SPREAD,
        pushTieResolution: PICKEM_PUSH_TIE_RESOLUTION.HALF_POINT,
      }),
    ).toThrow(/no spread/);
  });
});

describe("settlePickemWeek — week shapes", () => {
  it("returns nothing for a member who submitted no picks", () => {
    expect(settlePickemWeek([], [result()], settings(PICK_TYPE.STRAIGHT_UP))).toEqual({
      outcomes: [],
      unsettled: [],
    });
  });

  it("scores only the picks submitted — unpicked slots simply do not exist", () => {
    // Spec §Missed/partial weeks: submitting fewer than Picks Per Week is
    // allowed and unpicked slots score zero by absence, not by a zero row.
    const games: PickemGameResult[] = [
      { gameId: "g1", status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 17 },
      { gameId: "g2", status: GAME_STATUS.FINAL, homeScore: 10, awayScore: 30 },
      { gameId: "g3", status: GAME_STATUS.FINAL, homeScore: 21, awayScore: 20 },
    ];
    const { outcomes } = settlePickemWeek(
      [pick({ pickId: "p1", gameId: "g1", side: PICKEM_PICK_SIDE.HOME })],
      games,
      settings(PICK_TYPE.STRAIGHT_UP),
    );

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.gameId).toBe("g1");
  });

  it("settles a short week where every member picked every available game", () => {
    // Spec §Playoff weeks / fewer-games rule: a 1-game Super Bowl week needs no
    // special casing — it is just a week with one game in it.
    const { outcomes } = settlePickemWeek(
      [
        pick({ pickId: "p1", memberId: "m1", gameId: "sb", side: PICKEM_PICK_SIDE.HOME }),
        pick({ pickId: "p2", memberId: "m2", gameId: "sb", side: PICKEM_PICK_SIDE.AWAY }),
      ],
      [{ gameId: "sb", status: GAME_STATUS.FINAL, homeScore: 31, awayScore: 28 }],
      settings(PICK_TYPE.STRAIGHT_UP),
    );

    expect(outcomes).toEqual([
      {
        pickId: "p1",
        memberId: "m1",
        gameId: "sb",
        outcome: "correct",
        points: 1,
        differential: 3,
      },
      {
        pickId: "p2",
        memberId: "m2",
        gameId: "sb",
        outcome: "incorrect",
        points: 0,
        differential: -3,
      },
    ]);
  });

  it("settles a mixed week across members, splitting settled from unsettled", () => {
    const games: PickemGameResult[] = [
      { gameId: "won", status: GAME_STATUS.FINAL, homeScore: 27, awayScore: 13 },
      { gameId: "tied", status: GAME_STATUS.FINAL, homeScore: 17, awayScore: 17 },
      { gameId: "cancelled", status: GAME_STATUS.CANCELLED, homeScore: null, awayScore: null },
      { gameId: "later", status: GAME_STATUS.SCHEDULED, homeScore: null, awayScore: null },
    ];
    const picks: PickemPickInput[] = [
      pick({ pickId: "p1", memberId: "m1", gameId: "won", side: PICKEM_PICK_SIDE.HOME }),
      pick({ pickId: "p2", memberId: "m1", gameId: "tied", side: PICKEM_PICK_SIDE.HOME }),
      pick({ pickId: "p3", memberId: "m1", gameId: "cancelled", side: PICKEM_PICK_SIDE.AWAY }),
      pick({ pickId: "p4", memberId: "m1", gameId: "later", side: PICKEM_PICK_SIDE.HOME }),
      pick({ pickId: "p5", memberId: "m2", gameId: "won", side: PICKEM_PICK_SIDE.AWAY }),
    ];

    const { outcomes, unsettled } = settlePickemWeek(picks, games, settings(PICK_TYPE.STRAIGHT_UP));

    expect(outcomes.map((o) => [o.pickId, o.outcome, o.points, o.differential])).toEqual([
      ["p1", "correct", 1, 14],
      ["p2", "push", 0.5, 0],
      ["p3", "push", 0.5, 0],
      ["p5", "incorrect", 0, -14],
    ]);
    expect(unsettled).toEqual([
      { pickId: "p4", gameId: "later", reason: PICKEM_UNSETTLED_REASON.NOT_YET_PLAYED },
    ]);
  });

  it("identical pick sets across two members tie completely — same points and same differential", () => {
    // Spec §Edge Cases: two members who picked exactly alike across a mixed
    // week (a win, a loss, a push) must land on identical totals, not merely
    // identical outcomes per game.
    const games: PickemGameResult[] = [
      { gameId: "win", status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 17 },
      { gameId: "loss", status: GAME_STATUS.FINAL, homeScore: 10, awayScore: 30 },
      { gameId: "push", status: GAME_STATUS.FINAL, homeScore: 20, awayScore: 20 },
    ];
    const picksFor = (memberId: string, prefix: string): PickemPickInput[] => [
      pick({ pickId: `${prefix}1`, memberId, gameId: "win", side: PICKEM_PICK_SIDE.HOME }),
      pick({ pickId: `${prefix}2`, memberId, gameId: "loss", side: PICKEM_PICK_SIDE.HOME }),
      pick({ pickId: `${prefix}3`, memberId, gameId: "push", side: PICKEM_PICK_SIDE.HOME }),
    ];

    const { outcomes } = settlePickemWeek(
      [...picksFor("m1", "a"), ...picksFor("m2", "b")],
      games,
      settings(PICK_TYPE.STRAIGHT_UP),
    );

    const totalsFor = (memberId: string) =>
      outcomes
        .filter((o) => o.memberId === memberId)
        .reduce(
          (acc, o) => ({
            points: acc.points + o.points,
            differential: acc.differential + o.differential,
          }),
          { points: 0, differential: 0 },
        );

    expect(totalsFor("m1")).toEqual(totalsFor("m2"));
    expect(totalsFor("m1")).toEqual({ points: 1.5, differential: -13 });
  });

  it("is a pure derivation — settling the same inputs twice is identical", () => {
    // Arch D10: pickem_pick_results must be recomputable at any time. The orchestrator
    // leans on this for the nightly sweep and on-demand rebuild.
    const games: PickemGameResult[] = [
      { gameId: "g1", status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 21 },
      { gameId: "g2", status: GAME_STATUS.CANCELLED, homeScore: null, awayScore: null },
    ];
    const picks: PickemPickInput[] = [
      pick({ pickId: "p1", gameId: "g1", side: PICKEM_PICK_SIDE.HOME, spreadAtPick: -3 }),
      pick({ pickId: "p2", gameId: "g2", side: PICKEM_PICK_SIDE.HOME, spreadAtPick: -7 }),
    ];
    const config = settings(PICK_TYPE.AGAINST_THE_SPREAD);

    expect(settlePickemWeek(picks, games, config)).toEqual(settlePickemWeek(picks, games, config));
  });

  it("does not mutate its inputs", () => {
    const picks = [pick()];
    const games = [result()];
    const snapshot = JSON.stringify({ picks, games });

    settlePickemWeek(picks, games, settings(PICK_TYPE.STRAIGHT_UP));

    expect(JSON.stringify({ picks, games })).toBe(snapshot);
  });
});

/**
 * `pickMargin` is exercised throughout `settlePickemWeek` above; these cases
 * cover it as an exported surface, because the pick UI now calls it directly to
 * show where an unfinished pick stands. Sharing this function is what keeps a
 * live "covering by 3" from ever contradicting the grade that follows it, so its
 * sign convention deserves pinning independently of settlement.
 */
describe("pickMargin", () => {
  it.each([
    {
      name: "SU home pick: positive when the home side leads",
      side: PICKEM_PICK_SIDE.HOME,
      spreadAtPick: null,
      homeScore: 21,
      awayScore: 17,
      pickType: PICK_TYPE.STRAIGHT_UP,
      expected: 4,
    },
    {
      name: "SU away pick: mirrors the home margin",
      side: PICKEM_PICK_SIDE.AWAY,
      spreadAtPick: null,
      homeScore: 21,
      awayScore: 17,
      pickType: PICK_TYPE.STRAIGHT_UP,
      expected: -4,
    },
    {
      name: "SU tie is zero on both sides",
      side: PICKEM_PICK_SIDE.HOME,
      spreadAtPick: null,
      homeScore: 20,
      awayScore: 20,
      pickType: PICK_TYPE.STRAIGHT_UP,
      expected: 0,
    },
    {
      // A home underdog getting 3.5 that wins outright by 4 beats the number by
      // 7.5 — the arithmetic a member cannot do in their head mid-game, and the
      // reason the indicator exists.
      name: "ATS home underdog winning outright beats the number by margin + spread",
      side: PICKEM_PICK_SIDE.HOME,
      spreadAtPick: 3.5,
      homeScore: 21,
      awayScore: 17,
      pickType: PICK_TYPE.AGAINST_THE_SPREAD,
      expected: 7.5,
    },
    {
      name: "ATS away side of the same game is its mirror image",
      side: PICKEM_PICK_SIDE.AWAY,
      spreadAtPick: 3.5,
      homeScore: 21,
      awayScore: 17,
      pickType: PICK_TYPE.AGAINST_THE_SPREAD,
      expected: -7.5,
    },
    {
      name: "ATS home favourite winning by less than the number is short",
      side: PICKEM_PICK_SIDE.HOME,
      spreadAtPick: -7,
      homeScore: 24,
      awayScore: 20,
      pickType: PICK_TYPE.AGAINST_THE_SPREAD,
      expected: -3,
    },
    {
      name: "ATS landing exactly on a whole number is zero — a push",
      side: PICKEM_PICK_SIDE.HOME,
      spreadAtPick: -4,
      homeScore: 24,
      awayScore: 20,
      pickType: PICK_TYPE.AGAINST_THE_SPREAD,
      expected: 0,
    },
    {
      name: "a scoreless game is zero, not null",
      side: PICKEM_PICK_SIDE.AWAY,
      spreadAtPick: null,
      homeScore: 0,
      awayScore: 0,
      pickType: PICK_TYPE.STRAIGHT_UP,
      expected: 0,
    },
  ])("$name", ({ side, spreadAtPick, homeScore, awayScore, pickType, expected }) => {
    expect(pickMargin({ side, spreadAtPick }, homeScore, awayScore, pickType)).toBe(expected);
  });

  // Nothing to compare against. Settlement treats this as a loader bug and
  // throws; a read path just renders no indicator.
  it("is null for an ATS pick with no spread", () => {
    expect(
      pickMargin(
        { side: PICKEM_PICK_SIDE.HOME, spreadAtPick: null },
        21,
        17,
        PICK_TYPE.AGAINST_THE_SPREAD,
      ),
    ).toBeNull();
  });

  // The spread is meaningless in SU (`PickemPickInput.spreadAtPick`), so a
  // stray one must not tilt the result.
  it("ignores a stray spread in a straight-up league", () => {
    expect(
      pickMargin({ side: PICKEM_PICK_SIDE.HOME, spreadAtPick: -7 }, 21, 17, PICK_TYPE.STRAIGHT_UP),
    ).toBe(4);
  });
});
