import { describe, expect, it } from "vitest";
import {
  GAME_STATUS,
  SURVIVOR_EVERYONE_OUT,
  SURVIVOR_PUSH_TIE_RESOLUTION,
  type GameStatus,
  type PickOutcome,
  type SurvivorEveryoneOut,
  type SurvivorPushTieResolution,
} from "@picksleagues/schemas";
import {
  settleSurvivorWeek,
  type SurvivorGameResult,
  type SurvivorPickInput,
  type SurvivorScoringSettings,
  type SurvivorTransition,
} from "./survivor";

/**
 * The spec §Game Mode 2 rule set is this file's test plan (arch §Automated
 * Testing — "a spec rule without a test case is a review failure"). Raw
 * literals are asserted deliberately: they pin the contract, so editing a
 * constant's value fails here loudly.
 *
 * There is no against-the-spread half to this matrix. Survivor grades one
 * question against one input (ADR-0026), and a provider week move is not a case
 * of its own either — ADR-0019 removed `moved` from the status set, so a real
 * move arrives as an admin `cancelled` override and grades by the cancellation
 * rows below.
 */

const GAME_ID = "game-1";
const HOME_TEAM = "team-home";
const AWAY_TEAM = "team-away";
const MEMBER = "member-1";

/**
 * A member who always survives, present in most tables so the everyone-out
 * revival rule does not fire and mask the transition under test — with a lone
 * alive member, every elimination is also a revival.
 */
const CONTROL_MEMBER = "member-control";
const CONTROL_GAME = "game-control";
const CONTROL_TEAM = "team-control";
const CONTROL_OPPONENT = "team-control-opponent";

function pick(overrides: Partial<SurvivorPickInput> = {}): SurvivorPickInput {
  return { pickId: "pick-1", memberId: MEMBER, gameId: GAME_ID, teamId: HOME_TEAM, ...overrides };
}

function result(overrides: Partial<SurvivorGameResult> = {}): SurvivorGameResult {
  return {
    gameId: GAME_ID,
    status: GAME_STATUS.FINAL,
    homeTeamId: HOME_TEAM,
    awayTeamId: AWAY_TEAM,
    homeScore: 24,
    awayScore: 17,
    ...overrides,
  };
}

const controlPick: SurvivorPickInput = {
  pickId: "pick-control",
  memberId: CONTROL_MEMBER,
  gameId: CONTROL_GAME,
  teamId: CONTROL_TEAM,
};

const controlResult: SurvivorGameResult = {
  gameId: CONTROL_GAME,
  status: GAME_STATUS.FINAL,
  homeTeamId: CONTROL_TEAM,
  awayTeamId: CONTROL_OPPONENT,
  homeScore: 21,
  awayScore: 3,
};

function settings(
  pushTieResolution: SurvivorPushTieResolution = SURVIVOR_PUSH_TIE_RESOLUTION.ADVANCE,
  everyoneOut: SurvivorEveryoneOut = SURVIVOR_EVERYONE_OUT.REVIVE,
): SurvivorScoringSettings {
  return { pushTieResolution, everyoneOut };
}

describe("settleSurvivorWeek — grading one member's pick", () => {
  const cases: Array<{
    name: string;
    teamId: string;
    status?: GameStatus;
    homeScore?: number | null;
    awayScore?: number | null;
    pushTieResolution?: SurvivorPushTieResolution;
    outcome: PickOutcome;
    teamConsumed: boolean;
    transition: SurvivorTransition;
  }> = [
    {
      name: "rode the home side and it won → correct, advance, team consumed",
      teamId: HOME_TEAM,
      homeScore: 24,
      awayScore: 17,
      outcome: "correct",
      teamConsumed: true,
      transition: "advanced",
    },
    {
      name: "rode the away side and it won → correct, advance, team consumed",
      teamId: AWAY_TEAM,
      homeScore: 17,
      awayScore: 24,
      outcome: "correct",
      teamConsumed: true,
      transition: "advanced",
    },
    {
      name: "rode the home side and it lost → incorrect, eliminated, team consumed",
      teamId: HOME_TEAM,
      homeScore: 17,
      awayScore: 24,
      outcome: "incorrect",
      teamConsumed: true,
      transition: "eliminated",
    },
    {
      name: "rode the away side and it lost → incorrect, eliminated, team consumed",
      teamId: AWAY_TEAM,
      homeScore: 24,
      awayScore: 17,
      outcome: "incorrect",
      teamConsumed: true,
      transition: "eliminated",
    },
    {
      name: "won by one → correct",
      teamId: HOME_TEAM,
      homeScore: 21,
      awayScore: 20,
      outcome: "correct",
      teamConsumed: true,
      transition: "advanced",
    },
    {
      name: "tie, advance-and-consume → push, advance, team consumed",
      teamId: HOME_TEAM,
      homeScore: 20,
      awayScore: 20,
      pushTieResolution: SURVIVOR_PUSH_TIE_RESOLUTION.ADVANCE,
      outcome: "push",
      teamConsumed: true,
      transition: "advanced",
    },
    {
      name: "tie, eliminate → push, eliminated, team consumed",
      teamId: HOME_TEAM,
      homeScore: 20,
      awayScore: 20,
      pushTieResolution: SURVIVOR_PUSH_TIE_RESOLUTION.ELIMINATE,
      outcome: "push",
      teamConsumed: true,
      transition: "eliminated",
    },
    {
      name: "cancelled game, advance setting → push, survives, team returned",
      teamId: HOME_TEAM,
      status: GAME_STATUS.CANCELLED,
      pushTieResolution: SURVIVOR_PUSH_TIE_RESOLUTION.ADVANCE,
      outcome: "push",
      teamConsumed: false,
      transition: "advanced",
    },
    {
      // The cancellation rule is unconditional (spec §Game Mode 2 — Cancelled
      // game): the tie setting rules on a game that was played, and this one
      // never was.
      name: "cancelled game, eliminate setting → still push, still survives, team returned",
      teamId: HOME_TEAM,
      status: GAME_STATUS.CANCELLED,
      pushTieResolution: SURVIVOR_PUSH_TIE_RESOLUTION.ELIMINATE,
      outcome: "push",
      teamConsumed: false,
      transition: "advanced",
    },
  ];

  // Defaults are applied here rather than left to `result()`'s own: spreading an
  // explicitly-undefined key overwrites the default it was meant to fall back to.
  it.each(cases)(
    "$name",
    ({
      teamId,
      status = GAME_STATUS.FINAL,
      homeScore = null,
      awayScore = null,
      pushTieResolution = SURVIVOR_PUSH_TIE_RESOLUTION.ADVANCE,
      outcome,
      teamConsumed,
      transition,
    }) => {
      const settlement = settleSurvivorWeek(
        [MEMBER, CONTROL_MEMBER],
        [pick({ teamId }), controlPick],
        [result({ status, homeScore, awayScore }), controlResult],
        settings(pushTieResolution),
      );

      expect(settlement.unsettled).toEqual([]);
      expect(settlement.outcomes).toContainEqual({
        pickId: "pick-1",
        memberId: MEMBER,
        gameId: GAME_ID,
        outcome,
        teamConsumed,
      });
      expect(settlement.transitions).toContainEqual({ memberId: MEMBER, transition });
      expect(settlement.transitions).toContainEqual({
        memberId: CONTROL_MEMBER,
        transition: "advanced",
      });
      expect(settlement.aliveMemberIds).toEqual(
        transition === "eliminated" ? [CONTROL_MEMBER] : [MEMBER, CONTROL_MEMBER],
      );
    },
  );
});

describe("settleSurvivorWeek — missed picks", () => {
  it("eliminates an alive member who submitted nothing, writing no outcome row", () => {
    const settlement = settleSurvivorWeek(
      [MEMBER, CONTROL_MEMBER],
      [controlPick],
      [result(), controlResult],
      settings(),
    );

    expect(settlement.transitions).toContainEqual({ memberId: MEMBER, transition: "eliminated" });
    expect(settlement.outcomes.map((row) => row.memberId)).toEqual([CONTROL_MEMBER]);
    expect(settlement.aliveMemberIds).toEqual([CONTROL_MEMBER]);
  });

  it("eliminates a member who missed the week even though others picked", () => {
    const settlement = settleSurvivorWeek(
      [MEMBER, CONTROL_MEMBER, "member-3"],
      [pick(), controlPick],
      [result(), controlResult],
      settings(),
    );

    expect(settlement.transitions).toEqual([
      { memberId: MEMBER, transition: "advanced" },
      { memberId: CONTROL_MEMBER, transition: "advanced" },
      { memberId: "member-3", transition: "eliminated" },
    ]);
  });

  it("does not eliminate a member who was already out — a missed pick is only a rule for the alive", () => {
    const settlement = settleSurvivorWeek(
      [CONTROL_MEMBER],
      [controlPick],
      [controlResult],
      settings(),
    );

    expect(settlement.transitions).toEqual([{ memberId: CONTROL_MEMBER, transition: "advanced" }]);
    expect(settlement.aliveMemberIds).toEqual([CONTROL_MEMBER]);
  });
});

describe("settleSurvivorWeek — no zombie grading", () => {
  // A member eliminated in an earlier week may still hold a pick for this one:
  // the endpoint accepts picks until the elimination settles (ADR-0025). It
  // grades to nothing and consumes nothing.
  it.each([
    { name: "a winning pick", homeScore: 24, awayScore: 17 },
    { name: "a losing pick", homeScore: 17, awayScore: 24 },
  ])("ignores $name by a member who is already out", ({ homeScore, awayScore }) => {
    const settlement = settleSurvivorWeek(
      [CONTROL_MEMBER],
      [pick(), controlPick],
      [result({ homeScore, awayScore }), controlResult],
      settings(),
    );

    expect(settlement.outcomes.map((row) => row.memberId)).toEqual([CONTROL_MEMBER]);
    expect(settlement.transitions).toEqual([{ memberId: CONTROL_MEMBER, transition: "advanced" }]);
  });
});

describe("settleSurvivorWeek — everyone eliminated in the same week", () => {
  const loser = (memberId: string, pickId: string): SurvivorPickInput => ({
    pickId,
    memberId,
    gameId: GAME_ID,
    teamId: HOME_TEAM,
  });
  const losingResult = result({ homeScore: 17, awayScore: 24 });

  /**
   * One emptying week per row, differing only in what busted the alive set —
   * the spec's rule applies "regardless of elimination cause", so wrong picks,
   * a missed pick, and a fatal tie all have to reach the same answer. Each row
   * is run against both values of the Everyone Out setting (ADR-0028), which is
   * the only thing that decides what the week does with them.
   */
  const emptyingWeeks: Array<{
    name: string;
    alive: string[];
    picks: SurvivorPickInput[];
    results: SurvivorGameResult[];
    pushTieResolution?: SurvivorPushTieResolution;
  }> = [
    {
      name: "every member busted on a wrong pick",
      alive: ["a", "b"],
      picks: [loser("a", "pick-a"), loser("b", "pick-b")],
      results: [losingResult],
    },
    {
      name: "one busted and one missed the week",
      alive: ["a", "b"],
      picks: [loser("a", "pick-a")],
      results: [losingResult],
    },
    {
      name: "one busted and one drew a fatal tie",
      alive: ["a", "b"],
      picks: [
        loser("a", "pick-a"),
        { ...loser("b", "pick-b"), gameId: CONTROL_GAME, teamId: CONTROL_TEAM },
      ],
      results: [losingResult, { ...controlResult, homeScore: 10, awayScore: 10 }],
      pushTieResolution: SURVIVOR_PUSH_TIE_RESOLUTION.ELIMINATE,
    },
  ];

  it.each(emptyingWeeks)(
    "revives everyone under the default when $name",
    ({ alive, picks, results, pushTieResolution }) => {
      const settlement = settleSurvivorWeek(
        alive,
        picks,
        results,
        settings(pushTieResolution, SURVIVOR_EVERYONE_OUT.REVIVE),
      );

      expect(settlement.transitions).toEqual(
        alive.map((memberId) => ({ memberId, transition: "revived" })),
      );
      expect(settlement.aliveMemberIds).toEqual(alive);
    },
  );

  it.each(emptyingWeeks)(
    "leaves everyone eliminated under co-win when $name",
    ({ alive, picks, results, pushTieResolution }) => {
      const settlement = settleSurvivorWeek(
        alive,
        picks,
        results,
        settings(pushTieResolution, SURVIVOR_EVERYONE_OUT.CO_WIN),
      );

      // They lost, so settlement says so; naming them co-winners is the season
      // state's answer, derived from this very elimination (ADR-0028).
      expect(settlement.transitions).toEqual(
        alive.map((memberId) => ({ memberId, transition: "eliminated" })),
      );
      expect(settlement.aliveMemberIds).toEqual([]);
    },
  );

  it.each([SURVIVOR_EVERYONE_OUT.REVIVE, SURVIVOR_EVERYONE_OUT.CO_WIN])(
    "spends the teams the busting picks used under %s",
    (everyoneOut) => {
      const settlement = settleSurvivorWeek(
        ["a", "b"],
        [loser("a", "pick-a"), loser("b", "pick-b")],
        [losingResult],
        settings(undefined, everyoneOut),
      );

      expect(settlement.outcomes.every((row) => row.teamConsumed)).toBe(true);
    },
  );

  it.each([SURVIVOR_EVERYONE_OUT.REVIVE, SURVIVOR_EVERYONE_OUT.CO_WIN])(
    "is inert when one member survived, under %s",
    (everyoneOut) => {
      const settlement = settleSurvivorWeek(
        ["a", CONTROL_MEMBER],
        [loser("a", "pick-a"), controlPick],
        [losingResult, controlResult],
        settings(undefined, everyoneOut),
      );

      expect(settlement.transitions).toEqual([
        { memberId: "a", transition: "eliminated" },
        { memberId: CONTROL_MEMBER, transition: "advanced" },
      ]);
      expect(settlement.aliveMemberIds).toEqual([CONTROL_MEMBER]);
    },
  );

  it.each([SURVIVOR_EVERYONE_OUT.REVIVE, SURVIVOR_EVERYONE_OUT.CO_WIN])(
    "does not fire on an empty alive set under %s — nobody entered, so nobody came back",
    (everyoneOut) => {
      const settlement = settleSurvivorWeek([], [], [result()], settings(undefined, everyoneOut));

      expect(settlement).toEqual({
        outcomes: [],
        transitions: [],
        aliveMemberIds: [],
        unsettled: [],
      });
    },
  );
});

describe("settleSurvivorWeek — the whole slate is cancelled", () => {
  // Two spec rules colliding in one week: the cancellation returns every
  // picker's team, and the member who never picked is still eliminated for it.
  it("returns every picker's team and still eliminates the member who missed the week", () => {
    const cancelled = result({ status: GAME_STATUS.CANCELLED, homeScore: null, awayScore: null });
    const settlement = settleSurvivorWeek(
      ["a", "b", "c"],
      [
        { pickId: "pick-a", memberId: "a", gameId: GAME_ID, teamId: HOME_TEAM },
        { pickId: "pick-b", memberId: "b", gameId: GAME_ID, teamId: AWAY_TEAM },
      ],
      [cancelled],
      settings(SURVIVOR_PUSH_TIE_RESOLUTION.ELIMINATE),
    );

    expect(settlement.outcomes).toEqual([
      {
        pickId: "pick-a",
        memberId: "a",
        gameId: GAME_ID,
        outcome: "push",
        teamConsumed: false,
      },
      {
        pickId: "pick-b",
        memberId: "b",
        gameId: GAME_ID,
        outcome: "push",
        teamConsumed: false,
      },
    ]);
    expect(settlement.transitions).toEqual([
      { memberId: "a", transition: "advanced" },
      { memberId: "b", transition: "advanced" },
      { memberId: "c", transition: "eliminated" },
    ]);
    expect(settlement.aliveMemberIds).toEqual(["a", "b"]);
  });
});

describe("settleSurvivorWeek — an incomplete week grades to nothing", () => {
  const blocked: Array<{ name: string; status: GameStatus }> = [
    { name: "still scheduled", status: GAME_STATUS.SCHEDULED },
    { name: "in progress", status: GAME_STATUS.IN_PROGRESS },
    { name: "postponed", status: GAME_STATUS.POSTPONED },
  ];

  it.each(blocked)("holds the week open on a game that is $name", ({ status }) => {
    const settlement = settleSurvivorWeek(
      [MEMBER, CONTROL_MEMBER],
      [pick(), controlPick],
      [result({ status, homeScore: null, awayScore: null }), controlResult],
      settings(),
    );

    expect(settlement.unsettled).toEqual([{ gameId: GAME_ID, reason: "not_yet_played" }]);
    expect(settlement.outcomes).toEqual([]);
    expect(settlement.transitions).toEqual([]);
    // The entering alive set passes through untouched, so a caller threading
    // weeks in order cannot lose members to a week that did not settle.
    expect(settlement.aliveMemberIds).toEqual([MEMBER, CONTROL_MEMBER]);
  });

  it("holds the week open on an unpicked game — a member with no pick can still make one", () => {
    const settlement = settleSurvivorWeek(
      [MEMBER, CONTROL_MEMBER],
      [controlPick],
      [result({ status: GAME_STATUS.SCHEDULED, homeScore: null, awayScore: null }), controlResult],
      settings(),
    );

    expect(settlement.unsettled).toEqual([{ gameId: GAME_ID, reason: "not_yet_played" }]);
    expect(settlement.transitions).toEqual([]);
  });

  it("surfaces a final game with no scores rather than grading against a missing number", () => {
    const settlement = settleSurvivorWeek(
      [MEMBER, CONTROL_MEMBER],
      [pick(), controlPick],
      [result({ homeScore: null, awayScore: null }), controlResult],
      settings(),
    );

    expect(settlement.unsettled).toEqual([{ gameId: GAME_ID, reason: "final_without_scores" }]);
    expect(settlement.outcomes).toEqual([]);
  });

  it("lets a scoreless final nobody live picked pass — it decides nothing", () => {
    const settlement = settleSurvivorWeek(
      [CONTROL_MEMBER],
      [controlPick],
      [result({ homeScore: null, awayScore: null }), controlResult],
      settings(),
    );

    expect(settlement.unsettled).toEqual([]);
    expect(settlement.transitions).toEqual([{ memberId: CONTROL_MEMBER, transition: "advanced" }]);
  });

  it("does not treat a cancelled game as incomplete", () => {
    const settlement = settleSurvivorWeek(
      [MEMBER],
      [pick()],
      [result({ status: GAME_STATUS.CANCELLED, homeScore: null, awayScore: null })],
      settings(),
    );

    expect(settlement.unsettled).toEqual([]);
    expect(settlement.outcomes).toHaveLength(1);
  });

  it("reports one entry per blocking game, however many members picked it", () => {
    const settlement = settleSurvivorWeek(
      ["a", "b"],
      [
        { pickId: "pick-a", memberId: "a", gameId: GAME_ID, teamId: HOME_TEAM },
        { pickId: "pick-b", memberId: "b", gameId: GAME_ID, teamId: AWAY_TEAM },
      ],
      [result({ homeScore: null, awayScore: null })],
      settings(),
    );

    expect(settlement.unsettled).toEqual([{ gameId: GAME_ID, reason: "final_without_scores" }]);
  });
});

describe("settleSurvivorWeek — a threaded season", () => {
  /**
   * The prefix-ordered caller ELM-4 builds, in miniature (ADR-0025): each week
   * settles against the alive set the previous one returned.
   */
  function playSeason(
    weeks: Array<{ picks: SurvivorPickInput[]; results: SurvivorGameResult[] }>,
    startingAlive: string[],
  ) {
    let alive = startingAlive;
    const perWeek = weeks.map((week) => {
      const settlement = settleSurvivorWeek(alive, week.picks, week.results, settings());
      alive = settlement.aliveMemberIds;
      return settlement;
    });
    return { perWeek, alive };
  }

  function weekWhere(
    winners: readonly string[],
    losers: readonly string[],
    weekNumber: number,
  ): { picks: SurvivorPickInput[]; results: SurvivorGameResult[] } {
    const gameId = `game-w${weekNumber}`;
    return {
      picks: [...winners, ...losers].map((memberId) => ({
        pickId: `pick-w${weekNumber}-${memberId}`,
        memberId,
        gameId,
        // Every member picks a team in the same game; the winners ride the home
        // side, which is the side that wins below.
        teamId: winners.includes(memberId) ? `home-w${weekNumber}` : `away-w${weekNumber}`,
      })),
      results: [
        {
          gameId,
          status: GAME_STATUS.FINAL,
          homeTeamId: `home-w${weekNumber}`,
          awayTeamId: `away-w${weekNumber}`,
          homeScore: 27,
          awayScore: 10,
        },
      ],
    };
  }

  it("leaves co-winners alive at the end week, with nothing ranking them (spec §End of League)", () => {
    const { perWeek, alive } = playSeason(
      [
        weekWhere(["a", "b", "c"], ["d"], 1),
        weekWhere(["a", "b"], ["c"], 2),
        weekWhere(["a", "b"], [], 3),
      ],
      ["a", "b", "c", "d"],
    );

    expect(perWeek[0]?.transitions).toContainEqual({ memberId: "d", transition: "eliminated" });
    expect(perWeek[1]?.transitions).toContainEqual({ memberId: "c", transition: "eliminated" });
    expect([...alive].sort()).toEqual(["a", "b"]);
    // Co-winners share first place: the settlement carries no rank, score, or
    // tiebreaker to separate them.
    expect(perWeek[2]?.transitions).toEqual([
      { memberId: "a", transition: "advanced" },
      { memberId: "b", transition: "advanced" },
    ]);
  });

  it("carries a revival forward into the next week", () => {
    const { perWeek, alive } = playSeason(
      [weekWhere([], ["a", "b"], 1), weekWhere(["a"], ["b"], 2)],
      ["a", "b"],
    );

    expect(perWeek[0]?.aliveMemberIds).toEqual(["a", "b"]);
    expect(alive).toEqual(["a"]);
  });
});

describe("settleSurvivorWeek — purity", () => {
  const args = () =>
    [
      [MEMBER, CONTROL_MEMBER],
      [pick(), controlPick],
      [result(), controlResult],
      settings(),
    ] as const;

  it("returns the same settlement for the same inputs (arch D10 — settlement is a derivation)", () => {
    const [alive, picks, results, config] = args();

    expect(settleSurvivorWeek(alive, picks, results, config)).toEqual(
      settleSurvivorWeek(alive, picks, results, config),
    );
  });

  it("mutates none of its inputs", () => {
    const [alive, picks, results, config] = args();
    const before: unknown = JSON.parse(JSON.stringify({ alive, picks, results, config }));

    settleSurvivorWeek(alive, picks, results, config);

    expect({ alive, picks, results, config }).toEqual(before);
  });
});

describe("settleSurvivorWeek — loader and write-path bugs are surfaced, not graded around", () => {
  it("throws when a pick references a game absent from the results", () => {
    expect(() =>
      settleSurvivorWeek([MEMBER], [pick({ gameId: "game-missing" })], [result()], settings()),
    ).toThrow(/absent from the supplied results/);
  });

  it("throws for an absent game even when the picker is already out", () => {
    expect(() =>
      settleSurvivorWeek([], [pick({ gameId: "game-missing" })], [result()], settings()),
    ).toThrow(/absent from the supplied results/);
  });

  it("throws when a pick rides a team that is not in its game", () => {
    expect(() =>
      settleSurvivorWeek([MEMBER], [pick({ teamId: "team-elsewhere" })], [result()], settings()),
    ).toThrow(/not playing in game/);
  });

  it("throws when one member holds two picks for the week", () => {
    expect(() =>
      settleSurvivorWeek(
        [MEMBER],
        [pick(), pick({ pickId: "pick-2", gameId: CONTROL_GAME, teamId: CONTROL_TEAM })],
        [result(), controlResult],
        settings(),
      ),
    ).toThrow(/more than one pick/);
  });

  it("throws for a duplicate held by a member who is already out — same broken write", () => {
    expect(() =>
      settleSurvivorWeek(
        [],
        [pick(), pick({ pickId: "pick-2", gameId: CONTROL_GAME, teamId: CONTROL_TEAM })],
        [result(), controlResult],
        settings(),
      ),
    ).toThrow(/more than one pick/);
  });
});
