import { describe, expect, it } from "vitest";
import { GAME_STATUS } from "@picksleagues/schemas";
import { isClosedToPicks, matchupNumerals, spreadLabel } from "./game";

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

describe("matchupNumerals", () => {
  // The domain rule under the slot (ADR-0043 §5): which *number* a member is
  // looking at beside a team. The line is home-relative and flips for the
  // away side, the score is each team's own — and the switch between them is
  // the game's status, not the lock, so a locked game the score sync hasn't
  // reached still shows the number the pick is bought at.
  const scores = { awayScore: 17, homeScore: 27 };
  it.each([
    {
      name: "scheduled, line posted",
      game: { status: GAME_STATUS.SCHEDULED, awayScore: null, homeScore: null },
      spread: -3.5,
      expected: { away: "+3.5", home: "-3.5" },
    },
    {
      name: "scheduled, no line",
      game: { status: GAME_STATUS.SCHEDULED, awayScore: null, homeScore: null },
      spread: null,
      expected: { away: null, home: null },
    },
    {
      name: "in progress shows the score, not the line",
      game: { status: GAME_STATUS.IN_PROGRESS, ...scores },
      spread: -3.5,
      expected: { away: "17", home: "27" },
    },
    {
      name: "final shows the score",
      game: { status: GAME_STATUS.FINAL, ...scores },
      spread: null,
      expected: { away: "17", home: "27" },
    },
    {
      name: "in progress before any score lands shows nothing",
      game: { status: GAME_STATUS.IN_PROGRESS, awayScore: null, homeScore: null },
      spread: -3.5,
      expected: { away: null, home: null },
    },
    {
      name: "cancelled shows nothing — the line no longer decides anything",
      game: { status: GAME_STATUS.CANCELLED, awayScore: null, homeScore: null },
      spread: -3.5,
      expected: { away: null, home: null },
    },
  ])("$name", ({ game, spread, expected }) => {
    expect(matchupNumerals(game, spread)).toEqual(expected);
  });
});

describe("spreadLabel", () => {
  // The domain rule under the label: the stored spread is home-relative (spec
  // §ATS), so the away side reads the opposite sign. A surface that got this
  // backwards would show a member the wrong favorite.
  it.each([
    { name: "home favored, home side", spread: -3.5, side: "home", expected: "-3.5" },
    { name: "home favored, away side", spread: -3.5, side: "away", expected: "+3.5" },
    { name: "away favored, home side", spread: 7, side: "home", expected: "+7" },
    { name: "away favored, away side", spread: 7, side: "away", expected: "-7" },
    { name: "no line yet", spread: null, side: "home", expected: null },
  ] as const)("$name → $expected", ({ spread, side, expected }) => {
    expect(spreadLabel(spread, side)).toBe(expected);
  });

  // Neither side is giving points, so both sides read the same and neither
  // reads as a signed zero (FB-30) — the word itself is the owner's.
  it("reads an even line the same from both sides, never as ±0", () => {
    const home = spreadLabel(0, "home");
    expect(home).toBeTruthy();
    expect(home).toBe(spreadLabel(0, "away"));
    expect(home).not.toMatch(/[+-]0/);
  });
});
