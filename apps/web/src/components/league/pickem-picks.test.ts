import { describe, expect, it } from "vitest";
import { PICKEM_PICK_SIDE } from "@picksleagues/schemas";
import {
  hasOperableControl,
  openSelections,
  pickProgressLabel,
  visibleGames,
  weekHasNothingToShow,
} from "./pickem-picks";

/**
 * Decides whether the save bar is shown at all, so the cases below are the
 * ones where a member would otherwise be left staring at a Save button that
 * can never enable.
 */
describe("hasOperableControl", () => {
  const OPEN = { id: "open", locked: false, pickable: true };
  const OTHER_OPEN = { id: "other-open", locked: false, pickable: true };
  const LOCKED = { id: "locked", locked: true, pickable: true };
  const CANCELLED = { id: "cancelled", locked: false, pickable: false };
  const none = new Map<string, "home" | "away">();
  const holding = (id: string) => new Map([[id, PICKEM_PICK_SIDE.HOME]]);

  it("is operable below the cap while any game is open", () => {
    expect(hasOperableControl([LOCKED, OPEN], none, false)).toBe(true);
  });

  it("is dead once every game has closed", () => {
    expect(hasOperableControl([LOCKED, CANCELLED], none, false)).toBe(false);
  });

  // The reported case: later kickoffs remain, but the member is out of picks
  // and every pick they hold has locked, so no button on the page can move.
  it("is dead at the cap when no held pick is on an open game", () => {
    expect(hasOperableControl([LOCKED, OPEN, OTHER_OPEN], none, true)).toBe(false);
  });

  // Still operable at the cap: giving up this pick is what frees the slot.
  it("stays operable at the cap when a held pick is on an open game", () => {
    expect(hasOperableControl([LOCKED, OPEN], holding("open"), true)).toBe(true);
  });

  it("is dead with no games at all", () => {
    expect(hasOperableControl([], none, false)).toBe(false);
  });
});

/**
 * The editor's half of the "held pick" count. It must stay exactly
 * complementary to the retained map — a pick counted by both produced the
 * reported "8 of 5 picks", and one counted by neither would undercount just as
 * wrongly — so these cases pin the boundary rather than the arithmetic.
 */
describe("openSelections", () => {
  const OPEN = { id: "open", locked: false, pickable: true };
  const LOCKED = { id: "locked", locked: true, pickable: true };
  const CANCELLED = { id: "cancelled", locked: false, pickable: false };

  function selecting(...gameIds: string[]) {
    return new Map(gameIds.map((id) => [id, PICKEM_PICK_SIDE.HOME]));
  }

  it("keeps a selection whose game is still open", () => {
    expect([...openSelections([OPEN], selecting("open")).keys()]).toEqual(["open"]);
  });

  it("drops a selection whose game locked after it was made", () => {
    expect(openSelections([LOCKED], selecting("locked")).size).toBe(0);
  });

  it("drops a selection whose game stopped being playable", () => {
    expect(openSelections([CANCELLED], selecting("cancelled")).size).toBe(0);
  });

  // The game moved out of the week entirely (ADR-0015) — the pick is retained
  // server-side and rendered from its own list, so the editor must not also
  // hold it.
  it("drops a selection on a game that is no longer in the slate", () => {
    expect(openSelections([OPEN], selecting("gone")).size).toBe(0);
  });

  it("narrows a mixed map to only the open games, preserving each side", () => {
    const held = openSelections(
      [OPEN, LOCKED, CANCELLED],
      selecting("open", "locked", "cancelled"),
    );

    expect([...held.entries()]).toEqual([["open", PICKEM_PICK_SIDE.HOME]]);
  });
});

/**
 * Which games reach the member's own pick screen. The two failure directions
 * are opposite and both severe: hide a game the member could still switch into
 * and they are trapped (ADR-0015 replaces the whole week, so changing your mind
 * means picking a *different* game); show one they can never reach and the
 * screen keeps the clutter this was meant to remove.
 *
 * Every case below has more games than picks — the merge-gate fixture has
 * exactly as many, which is precisely why the gap between "open" and "reachable"
 * is invisible there.
 */
describe("visibleGames", () => {
  const OPEN = { id: "open", locked: false, pickable: true };
  const OTHER_OPEN = { id: "other-open", locked: false, pickable: true };
  const LOCKED = { id: "locked", locked: true, pickable: true };
  const CANCELLED = { id: "cancelled", locked: false, pickable: false };
  const SLATE = [LOCKED, CANCELLED, OPEN, OTHER_OPEN];
  const ids = (games: { id: string }[]) => games.map((game) => game.id);
  const holding = (...gameIds: string[]) => new Set(gameIds);

  it("shows every open game while the member can still act", () => {
    expect(ids(visibleGames(SLATE, holding(), true))).toEqual(["open", "other-open"]);
  });

  it("hides a game that kicked off without the member's pick", () => {
    expect(ids(visibleGames(SLATE, holding(), true))).not.toContain("locked");
  });

  it("keeps a locked game the member did pick", () => {
    expect(ids(visibleGames(SLATE, holding("locked"), true))).toEqual([
      "locked",
      "open",
      "other-open",
    ]);
  });

  // A cancelled game is unpickable but the pick on it is retained and offers a
  // substitute (spec §Cancellations), so the row has to survive.
  it("keeps a cancelled game the member picked", () => {
    expect(ids(visibleGames(SLATE, holding("cancelled"), true))).toContain("cancelled");
  });

  // The whole point: nothing left to operate, so the screen is the week in
  // review — the member's picks and nothing else, however open the rest looks.
  it("collapses to the member's own picks once nothing can be operated", () => {
    expect(ids(visibleGames(SLATE, holding("locked"), false))).toEqual(["locked"]);
  });

  // At the cap with unlocked picks the member is still operable, so the games
  // they could switch *into* must stay. Hiding these is the trap that defeated
  // the earlier "show only my picks" proposals.
  it("keeps unpicked open games at the cap while a held pick is still unlocked", () => {
    expect(ids(visibleGames(SLATE, holding("open"), true))).toEqual([
      "open",
      "other-open",
      // "locked" and "cancelled" are unheld, so they stay hidden.
    ]);
  });

  it("shows nothing when the member picked nothing and the week has closed", () => {
    expect(visibleGames(SLATE, holding(), false)).toEqual([]);
  });
});

/**
 * Pins the sticky action bar's progress phrasing (feedback: submitting a
 * 16-game slate shouldn't require scrolling to find the count) — the exact
 * string is also asserted literally by e2e/pickem-journey.sim.spec.ts, so a
 * wording change here must be a deliberate, visible edit to both.
 */
describe("pickProgressLabel", () => {
  it("renders the held count over the cap", () => {
    expect(pickProgressLabel(4, 4)).toBe("4 of 4 picks");
  });

  it("renders zero held picks", () => {
    expect(pickProgressLabel(0, 5)).toBe("0 of 5 picks");
  });

  it("renders a partial count", () => {
    expect(pickProgressLabel(2, 5)).toBe("2 of 5 picks");
  });
});

/**
 * Found by manual regression testing (runbook Pass 5). A week whose only game
 * moved away rendered "No games synced for this week yet" and dropped the
 * editor entirely — hiding the member's own retained pick, its push, and its
 * substitute control. A pick that moved out of the week is absent from the
 * slate by definition (ADR-0015), so the slate alone can never answer this.
 */
describe("weekHasNothingToShow", () => {
  it("is empty when the slate has no games and the member holds none", () => {
    expect(weekHasNothingToShow(0, 0)).toBe(true);
  });

  it("is NOT empty when every game left the week but the member still holds a pick", () => {
    expect(weekHasNothingToShow(0, 1)).toBe(false);
  });

  it("is not empty whenever the slate has games", () => {
    expect(weekHasNothingToShow(3, 0)).toBe(false);
    expect(weekHasNothingToShow(3, 2)).toBe(false);
  });
});
