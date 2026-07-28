import { describe, expect, it } from "vitest";
import { GAME_STATUS } from "@picksleagues/schemas";
import { gameStateLabel, pickRowState } from "./game";

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

  it("shows the kickoff time only while the game is still scheduled", () => {
    const label = gameStateLabel({
      status: GAME_STATUS.SCHEDULED,
      kickoffAt: KICKOFF,
      awayScore: null,
      homeScore: null,
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
      expected: "In progress 14–7",
    },
    {
      name: "a final game shows the status and the final score",
      status: GAME_STATUS.FINAL,
      awayScore: 20,
      homeScore: 24,
      expected: "Final 20–24",
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
      expected: "In progress 0–0",
    },
    {
      name: "a cancelled game shows why it will push",
      status: GAME_STATUS.CANCELLED,
      awayScore: null,
      homeScore: null,
      expected: "Cancelled",
    },
  ])("$name", ({ status, awayScore, homeScore, expected }) => {
    expect(gameStateLabel({ status, kickoffAt: KICKOFF, awayScore, homeScore })).toBe(expected);
  });
});
