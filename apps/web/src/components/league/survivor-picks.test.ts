import { describe, expect, it } from "vitest";
import { heldSurvivorSelection } from "./survivor-picks";

/**
 * Which pick the sheet would actually save. Survivor's write path allows a pick
 * to be replaced right up to its game's kickoff and refuses it (`pick_locked`)
 * afterwards, so a local selection that outlives its game's kickoff is an offer
 * the API can no longer honour — and the honest answer at that moment is the
 * pick the member already has on record, not the dead one.
 *
 * Only the resolution rule is pinned here. Whether the resulting team is drawn
 * fat or dimmed is presentation, and is deliberately not tested.
 */
describe("heldSurvivorSelection", () => {
  const OPEN = { id: "open", locked: false, pickable: true };
  const LOCKED = { id: "locked", locked: true, pickable: true };
  const CANCELLED = { id: "cancelled", locked: false, pickable: false };
  const GAMES = [OPEN, LOCKED, CANCELLED];

  const SAVED = { gameId: "locked", teamId: "saved-team" };

  it("falls back to the saved pick when nothing has been selected", () => {
    expect(heldSurvivorSelection(GAMES, null, SAVED)).toEqual(SAVED);
  });

  it("is null when there is neither a selection nor a saved pick", () => {
    expect(heldSurvivorSelection(GAMES, null, null)).toBeNull();
  });

  it("holds a selection whose game can still take it", () => {
    const draft = { gameId: "open", teamId: "open-team" };

    expect(heldSurvivorSelection(GAMES, draft, SAVED)).toEqual(draft);
  });

  it("drops a selection whose game kicked off after it was made", () => {
    expect(heldSurvivorSelection(GAMES, { gameId: "locked", teamId: "other" }, SAVED)).toEqual(
      SAVED,
    );
  });

  it("drops a selection whose game stopped being playable", () => {
    expect(heldSurvivorSelection(GAMES, { gameId: "cancelled", teamId: "other" }, null)).toBeNull();
  });

  it("drops a selection on a game that is no longer in the slate", () => {
    expect(heldSurvivorSelection(GAMES, { gameId: "gone", teamId: "other" }, null)).toBeNull();
  });
});
