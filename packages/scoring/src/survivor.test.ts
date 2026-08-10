import { describe, expect, it } from "vitest";
import { GAME_STATUS, type GameStatus, type PickOutcome } from "@picksleagues/schemas";
import {
  settleSurvivorWeek,
  settleSurvivorWeekProvisionally,
  type SurvivorGameResult,
  type SurvivorPickInput,
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

describe("settleSurvivorWeek — grading one member's pick", () => {
  const cases: Array<{
    name: string;
    teamId: string;
    status?: GameStatus;
    homeScore?: number | null;
    awayScore?: number | null;
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
      // Fixed rather than configurable (ADR-0033): a tie always advances, and
      // the team is spent because the game was played.
      name: "tie → push, advance, team consumed",
      teamId: HOME_TEAM,
      homeScore: 20,
      awayScore: 20,
      outcome: "push",
      teamConsumed: true,
      transition: "advanced",
    },
    {
      // The cancellation rule hands the team back (spec §Game Mode 2 —
      // Cancelled game): unlike a tie, this game was never played.
      name: "cancelled game → push, survives, team returned",
      teamId: HOME_TEAM,
      status: GAME_STATUS.CANCELLED,
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
      outcome,
      teamConsumed,
      transition,
    }) => {
      const settlement = settleSurvivorWeek(
        [MEMBER, CONTROL_MEMBER],
        [pick({ teamId }), controlPick],
        [result({ status, homeScore, awayScore }), controlResult],
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
    );

    expect(settlement.transitions).toEqual([
      { memberId: MEMBER, transition: "advanced" },
      { memberId: CONTROL_MEMBER, transition: "advanced" },
      { memberId: "member-3", transition: "eliminated" },
    ]);
  });

  it("does not eliminate a member who was already out — a missed pick is only a rule for the alive", () => {
    const settlement = settleSurvivorWeek([CONTROL_MEMBER], [controlPick], [controlResult]);

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
   * the spec's rule applies "regardless of elimination cause", so wrong picks
   * and a missed pick have to reach the same answer. (A fatal tie left the
   * cause list with ADR-0033: ties always advance now.)
   */
  const emptyingWeeks: Array<{
    name: string;
    alive: string[];
    picks: SurvivorPickInput[];
    results: SurvivorGameResult[];
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
  ];

  it.each(emptyingWeeks)("revives everyone when $name", ({ alive, picks, results }) => {
    const settlement = settleSurvivorWeek(alive, picks, results);

    expect(settlement.transitions).toEqual(
      alive.map((memberId) => ({ memberId, transition: "revived" })),
    );
    expect(settlement.aliveMemberIds).toEqual(alive);
  });

  it("restores the life only — teams the busting picks spent stay spent", () => {
    const settlement = settleSurvivorWeek(
      ["a", "b"],
      [loser("a", "pick-a"), loser("b", "pick-b")],
      [losingResult],
    );

    expect(settlement.outcomes.every((row) => row.teamConsumed)).toBe(true);
  });

  it("is inert when one member survived", () => {
    const settlement = settleSurvivorWeek(
      ["a", CONTROL_MEMBER],
      [loser("a", "pick-a"), controlPick],
      [losingResult, controlResult],
    );

    expect(settlement.transitions).toEqual([
      { memberId: "a", transition: "eliminated" },
      { memberId: CONTROL_MEMBER, transition: "advanced" },
    ]);
    expect(settlement.aliveMemberIds).toEqual([CONTROL_MEMBER]);
  });

  it("does not fire on an empty alive set — nobody entered, so nobody came back", () => {
    const settlement = settleSurvivorWeek([], [], [result()]);

    expect(settlement).toEqual({
      outcomes: [],
      transitions: [],
      aliveMemberIds: [],
      unsettled: [],
    });
  });
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
    );

    expect(settlement.unsettled).toEqual([{ gameId: GAME_ID, reason: "not_yet_played" }]);
    expect(settlement.transitions).toEqual([]);
  });

  it("surfaces a final game with no scores rather than grading against a missing number", () => {
    const settlement = settleSurvivorWeek(
      [MEMBER, CONTROL_MEMBER],
      [pick(), controlPick],
      [result({ homeScore: null, awayScore: null }), controlResult],
    );

    expect(settlement.unsettled).toEqual([{ gameId: GAME_ID, reason: "final_without_scores" }]);
    expect(settlement.outcomes).toEqual([]);
  });

  it("lets a scoreless final nobody live picked pass — it decides nothing", () => {
    const settlement = settleSurvivorWeek(
      [CONTROL_MEMBER],
      [controlPick],
      [result({ homeScore: null, awayScore: null }), controlResult],
    );

    expect(settlement.unsettled).toEqual([]);
    expect(settlement.transitions).toEqual([{ memberId: CONTROL_MEMBER, transition: "advanced" }]);
  });

  it("does not treat a cancelled game as incomplete", () => {
    const settlement = settleSurvivorWeek(
      [MEMBER],
      [pick()],
      [result({ status: GAME_STATUS.CANCELLED, homeScore: null, awayScore: null })],
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
      const settlement = settleSurvivorWeek(alive, week.picks, week.results);
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
    ] as const;

  it("returns the same settlement for the same inputs (arch D10 — settlement is a derivation)", () => {
    const [alive, picks, results] = args();

    expect(settleSurvivorWeek(alive, picks, results)).toEqual(
      settleSurvivorWeek(alive, picks, results),
    );
  });

  it("mutates none of its inputs", () => {
    const [alive, picks, results] = args();
    const before: unknown = JSON.parse(JSON.stringify({ alive, picks, results }));

    settleSurvivorWeek(alive, picks, results);

    expect({ alive, picks, results }).toEqual(before);
  });
});

describe("settleSurvivorWeekProvisionally — a certain loss lands before the week does", () => {
  /**
   * ADR-0028's safety rule is the whole matrix below: a member goes out early
   * **only** while some member who entered the week alive holds a graded pick
   * that does not eliminate them, because that is exactly what makes the
   * everyone-out revival impossible for the week.
   */
  const OPEN_GAME = "game-open";
  const OPEN_HOME = "team-open-home";
  const OPEN_AWAY = "team-open-away";

  /** A game of the same week that has not been played — what makes the week partial. */
  const openResult: SurvivorGameResult = {
    gameId: OPEN_GAME,
    status: GAME_STATUS.SCHEDULED,
    homeTeamId: OPEN_HOME,
    awayTeamId: OPEN_AWAY,
    homeScore: null,
    awayScore: null,
  };

  const openPick = (memberId: string): SurvivorPickInput => ({
    pickId: `pick-open-${memberId}`,
    memberId,
    gameId: OPEN_GAME,
    teamId: OPEN_HOME,
  });

  /** On `result()`, where home wins: `HOME_TEAM` survives and `AWAY_TEAM` busts. */
  const gradedPick = (memberId: string, teamId: string): SurvivorPickInput => ({
    pickId: `pick-graded-${memberId}`,
    memberId,
    gameId: GAME_ID,
    teamId,
  });

  const controlPickBy = (memberId: string): SurvivorPickInput => ({
    ...controlPick,
    pickId: `pick-control-${memberId}`,
    memberId,
  });

  const cases: Array<{
    name: string;
    alive: string[];
    picks: SurvivorPickInput[];
    results: SurvivorGameResult[];
    eliminated: string[];
  }> = [
    {
      name: "a confirmed survivor makes the confirmed loser final",
      alive: ["a", "b"],
      picks: [gradedPick("a", HOME_TEAM), gradedPick("b", AWAY_TEAM)],
      results: [result(), openResult],
      eliminated: ["b"],
    },
    {
      name: "nobody is confirmed safe yet, so the confirmed loser stays in",
      alive: ["a", "b"],
      picks: [openPick("a"), gradedPick("b", AWAY_TEAM)],
      results: [result(), openResult],
      eliminated: [],
    },
    {
      name: "a member with no pick is never provisional — the open game is still theirs to take",
      alive: ["a", "b", "c"],
      picks: [gradedPick("a", HOME_TEAM), gradedPick("b", AWAY_TEAM)],
      results: [result(), openResult],
      eliminated: ["b"],
    },
    {
      name: "a cancelled game confirms its picker safe",
      alive: ["a", "b"],
      picks: [controlPickBy("a"), gradedPick("b", AWAY_TEAM)],
      results: [
        result(),
        { ...controlResult, status: GAME_STATUS.CANCELLED, homeScore: null, awayScore: null },
        openResult,
      ],
      eliminated: ["b"],
    },
    {
      // Ties always advance (ADR-0033), so a tied final is a confirmed
      // survivor exactly as a win is.
      name: "a tie confirms its picker safe",
      alive: ["a", "b"],
      picks: [controlPickBy("a"), gradedPick("b", AWAY_TEAM)],
      results: [result(), { ...controlResult, homeScore: 10, awayScore: 10 }, openResult],
      eliminated: ["b"],
    },
    {
      name: "a winning pick by a member who is already out confirms nothing — they are not in the revival set",
      alive: ["b"],
      picks: [gradedPick("zombie", HOME_TEAM), gradedPick("b", AWAY_TEAM)],
      results: [result(), openResult],
      eliminated: [],
    },
    {
      name: "a final with no scores is not a grade, and neither confirms nor eliminates its picker",
      alive: ["a", "b", "c"],
      picks: [controlPickBy("a"), gradedPick("b", AWAY_TEAM), gradedPick("c", HOME_TEAM)],
      results: [result(), { ...controlResult, homeScore: null, awayScore: null }, openResult],
      eliminated: ["b"],
    },
    {
      name: "the week where every graded pick busts — the revival case, which must never go early",
      alive: ["a", "b"],
      picks: [gradedPick("a", AWAY_TEAM), gradedPick("b", AWAY_TEAM)],
      results: [result(), openResult],
      eliminated: [],
    },
    {
      name: "a week nobody has picked yet",
      alive: ["a", "b"],
      picks: [],
      results: [openResult],
      eliminated: [],
    },
    {
      name: "an empty alive set",
      alive: [],
      picks: [],
      results: [result()],
      eliminated: [],
    },
  ];

  it.each(cases)("$name", ({ alive, picks, results, eliminated }) => {
    expect(settleSurvivorWeekProvisionally(alive, picks, results)).toEqual({
      eliminatedMemberIds: eliminated,
    });
  });

  it("puts out nobody the completed week does not also put out (ADR-0028 — a superset, never a contradiction)", () => {
    const alive = ["a", "b", "c"];
    const picks = [gradedPick("a", HOME_TEAM), gradedPick("b", AWAY_TEAM), openPick("c")];

    const provisional = settleSurvivorWeekProvisionally(alive, picks, [result(), openResult]);
    expect(provisional.eliminatedMemberIds).toEqual(["b"]);

    // The open game lands, and it busts c as well — the completed week decides
    // strictly more than the provisional pass did, and reverses none of it.
    const complete = settleSurvivorWeek(alive, picks, [
      result(),
      { ...openResult, status: GAME_STATUS.FINAL, homeScore: 3, awayScore: 10 },
    ]);
    const eliminatedByWeek = complete.transitions
      .filter((row) => row.transition === "eliminated")
      .map((row) => row.memberId);

    expect(eliminatedByWeek).toEqual(["b", "c"]);
    for (const memberId of provisional.eliminatedMemberIds) {
      expect(eliminatedByWeek).toContain(memberId);
    }
  });

  it("returns the same answer for the same inputs and mutates none of them (arch D10)", () => {
    const alive = ["a", "b"];
    const picks = [gradedPick("a", HOME_TEAM), gradedPick("b", AWAY_TEAM)];
    const results = [result(), openResult];
    const before: unknown = JSON.parse(JSON.stringify({ alive, picks, results }));

    expect(settleSurvivorWeekProvisionally(alive, picks, results)).toEqual(
      settleSurvivorWeekProvisionally(alive, picks, results),
    );
    expect({ alive, picks, results }).toEqual(before);
  });

  it("surfaces the same loader and write-path bugs the complete grade does", () => {
    expect(() =>
      settleSurvivorWeekProvisionally([MEMBER], [pick({ gameId: "game-missing" })], [result()]),
    ).toThrow(/absent from the supplied results/);

    expect(() =>
      settleSurvivorWeekProvisionally([MEMBER], [pick({ teamId: "team-elsewhere" })], [result()]),
    ).toThrow(/not playing in game/);

    expect(() =>
      settleSurvivorWeekProvisionally(
        [MEMBER],
        [pick(), pick({ pickId: "pick-2", gameId: CONTROL_GAME, teamId: CONTROL_TEAM })],
        [result(), controlResult],
      ),
    ).toThrow(/more than one pick/);
  });
});

describe("settleSurvivorWeek — loader and write-path bugs are surfaced, not graded around", () => {
  it("throws when a pick references a game absent from the results", () => {
    expect(() =>
      settleSurvivorWeek([MEMBER], [pick({ gameId: "game-missing" })], [result()]),
    ).toThrow(/absent from the supplied results/);
  });

  it("throws for an absent game even when the picker is already out", () => {
    expect(() => settleSurvivorWeek([], [pick({ gameId: "game-missing" })], [result()])).toThrow(
      /absent from the supplied results/,
    );
  });

  it("throws when a pick rides a team that is not in its game", () => {
    expect(() =>
      settleSurvivorWeek([MEMBER], [pick({ teamId: "team-elsewhere" })], [result()]),
    ).toThrow(/not playing in game/);
  });

  it("throws when one member holds two picks for the week", () => {
    expect(() =>
      settleSurvivorWeek(
        [MEMBER],
        [pick(), pick({ pickId: "pick-2", gameId: CONTROL_GAME, teamId: CONTROL_TEAM })],
        [result(), controlResult],
      ),
    ).toThrow(/more than one pick/);
  });

  it("throws for a duplicate held by a member who is already out — same broken write", () => {
    expect(() =>
      settleSurvivorWeek(
        [],
        [pick(), pick({ pickId: "pick-2", gameId: CONTROL_GAME, teamId: CONTROL_TEAM })],
        [result(), controlResult],
      ),
    ).toThrow(/more than one pick/);
  });
});
