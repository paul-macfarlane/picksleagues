import { describe, expect, it } from "vitest";
import { GAME_STATUS, PICK_TYPE } from "@picksleagues/schemas";
import {
  clockLabel,
  gameStateAsOfLabel,
  gameStateLabel,
  isClosedToPicks,
  periodLabel,
  pickMarginLabel,
  pickRowState,
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
      name: "a cancelled/moved game closes it",
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

describe("pickRowState", () => {
  it.each([
    {
      name: "unplayable overrides a selection",
      game: { pickable: false, locked: false },
      hasSelection: true,
      expected: "unplayable",
    },
    {
      name: "locked overrides a selection",
      game: { pickable: true, locked: true },
      hasSelection: true,
      expected: "locked",
    },
    {
      name: "an unlocked, pickable game with a selection reads as picked",
      game: { pickable: true, locked: false },
      hasSelection: true,
      expected: "picked",
    },
    {
      name: "an unlocked, pickable game with no selection is open",
      game: { pickable: true, locked: false },
      hasSelection: false,
      expected: "open",
    },
    {
      name: "unplayable takes priority over locked",
      game: { pickable: false, locked: true },
      hasSelection: false,
      expected: "unplayable",
    },
  ])("$name", ({ game, hasSelection, expected }) => {
    expect(pickRowState(game, hasSelection)).toBe(expected);
  });
});

describe("gameStateLabel", () => {
  const KICKOFF = "2026-09-13T17:00:00.000Z";
  // Away first, matching the order the label renders and the score arrives in.
  const TEAMS = { awayTeam: { abbreviation: "NE" }, homeTeam: { abbreviation: "SEA" } };

  it("shows the kickoff time only while the game is still scheduled", () => {
    const label = gameStateLabel({
      status: GAME_STATUS.SCHEDULED,
      kickoffAt: KICKOFF,
      awayScore: null,
      homeScore: null,
      ...TEAMS,
    });

    expect(label.startsWith("Kickoff ")).toBe(true);
    // Locale/timezone-dependent beyond the prefix, so the assertion pins the
    // shape rather than a formatted instant.
    expect(label).not.toContain("Scheduled");
  });

  it.each([
    {
      name: "an in-progress game shows the status and the live score",
      status: GAME_STATUS.IN_PROGRESS,
      awayScore: 14,
      homeScore: 7,
      expected: "In progress · NE 14 – SEA 7",
    },
    {
      name: "a final game shows the status and the final score",
      status: GAME_STATUS.FINAL,
      awayScore: 20,
      homeScore: 24,
      expected: "Final · NE 20 – SEA 24",
    },
    {
      name: "a started game with no score yet shows the status alone",
      status: GAME_STATUS.IN_PROGRESS,
      awayScore: null,
      homeScore: null,
      expected: "In progress",
    },
    {
      name: "a zero-zero game shows the score, not an empty string",
      status: GAME_STATUS.IN_PROGRESS,
      awayScore: 0,
      homeScore: 0,
      expected: "In progress · NE 0 – SEA 0",
    },
    {
      name: "a cancelled game shows why it will push",
      status: GAME_STATUS.CANCELLED,
      awayScore: null,
      homeScore: null,
      expected: "Cancelled",
    },
  ])("$name", ({ status, awayScore, homeScore, expected }) => {
    expect(gameStateLabel({ status, kickoffAt: KICKOFF, awayScore, homeScore, ...TEAMS })).toBe(
      expected,
    );
  });

  it.each([
    { period: 1, expected: "Q1" },
    { period: 4, expected: "Q4" },
    { period: 5, expected: "OT" },
    { period: 6, expected: "OT2" },
    { period: 7, expected: "OT3" },
  ])("periodLabel renders period $period as $expected", ({ period, expected }) => {
    expect(periodLabel(period)).toBe(expected);
  });

  it.each([
    { seconds: 754, expected: "12:34" },
    { seconds: 65, expected: "1:05" },
    { seconds: 0, expected: "0:00" },
    { seconds: 59, expected: "0:59" },
  ])("clockLabel renders $seconds seconds as $expected", ({ seconds, expected }) => {
    expect(clockLabel(seconds)).toBe(expected);
  });

  it.each([
    {
      name: "period and clock both present renders the live clock ahead of the score",
      status: GAME_STATUS.IN_PROGRESS,
      period: 3,
      clockSeconds: 754,
      awayScore: 10,
      homeScore: 24,
      expected: "Q3 12:34 · NE 10 – SEA 24",
    },
    {
      name: "an overtime game renders OT rather than a fifth quarter",
      status: GAME_STATUS.IN_PROGRESS,
      period: 5,
      clockSeconds: 65,
      awayScore: 20,
      homeScore: 20,
      expected: "OT 1:05 · NE 20 – SEA 20",
    },
    {
      name: "period with no clock falls back to the plain status line",
      status: GAME_STATUS.IN_PROGRESS,
      period: 3,
      clockSeconds: null,
      awayScore: 10,
      homeScore: 24,
      expected: "In progress · NE 10 – SEA 24",
    },
    {
      name: "clock with no period falls back to the plain status line",
      status: GAME_STATUS.IN_PROGRESS,
      period: null,
      clockSeconds: 754,
      awayScore: 10,
      homeScore: 24,
      expected: "In progress · NE 10 – SEA 24",
    },
    {
      name: "neither period nor clock falls back to the plain status line",
      status: GAME_STATUS.IN_PROGRESS,
      period: null,
      clockSeconds: null,
      awayScore: 10,
      homeScore: 24,
      expected: "In progress · NE 10 – SEA 24",
    },
    {
      name: "a live game with no score yet omits the score after the clock",
      status: GAME_STATUS.IN_PROGRESS,
      period: 1,
      clockSeconds: 900,
      awayScore: null,
      homeScore: null,
      expected: "Q1 15:00",
    },
  ])("$name", ({ status, period, clockSeconds, awayScore, homeScore, expected }) => {
    expect(
      gameStateLabel({
        status,
        kickoffAt: KICKOFF,
        awayScore,
        homeScore,
        period,
        clockSeconds,
        ...TEAMS,
      }),
    ).toBe(expected);
  });
});

describe("gameStateAsOfLabel", () => {
  const STATE_AS_OF = "2026-09-13T18:21:00.000Z";

  it("shows the qualified stamp while the game is in progress", () => {
    const label = gameStateAsOfLabel({ status: GAME_STATUS.IN_PROGRESS, stateAsOf: STATE_AS_OF });
    expect(label?.startsWith("as of ")).toBe(true);
  });

  it.each([GAME_STATUS.SCHEDULED, GAME_STATUS.FINAL, GAME_STATUS.CANCELLED])(
    "is null while the game is %s",
    (status) => {
      expect(gameStateAsOfLabel({ status, stateAsOf: STATE_AS_OF })).toBeNull();
    },
  );
});

/**
 * A provisional reading, so the phrasing is the point: a magnitude the member
 * can act on, never a verdict word that would read as settled. Pinned here
 * because the copy is the whole safeguard — see `pickMarginLabel`.
 */
describe("pickMarginLabel", () => {
  it.each([
    { margin: 7.5, pickType: PICK_TYPE.AGAINST_THE_SPREAD, expected: "covering by 7.5" },
    { margin: -2.5, pickType: PICK_TYPE.AGAINST_THE_SPREAD, expected: "short by 2.5" },
    // A whole-number spread landed on exactly: the app's own word for it, so the
    // reading and the grade that may follow use one vocabulary.
    { margin: 0, pickType: PICK_TYPE.AGAINST_THE_SPREAD, expected: "pushing" },
    { margin: 4, pickType: PICK_TYPE.STRAIGHT_UP, expected: "up 4" },
    { margin: -2, pickType: PICK_TYPE.STRAIGHT_UP, expected: "down 2" },
    { margin: 0, pickType: PICK_TYPE.STRAIGHT_UP, expected: "tied" },
  ])("renders $margin in a $pickType league as $expected", ({ margin, pickType, expected }) => {
    expect(pickMarginLabel(margin, pickType)).toBe(expected);
  });

  it.each([PICK_TYPE.AGAINST_THE_SPREAD, PICK_TYPE.STRAIGHT_UP])(
    "never states a verdict in a %s league",
    (pickType) => {
      for (const margin of [7.5, 0, -7.5]) {
        const label = pickMarginLabel(margin, pickType);
        expect(label).not.toMatch(/correct|incorrect|winning|losing|won|lost/i);
      }
    },
  );
});
