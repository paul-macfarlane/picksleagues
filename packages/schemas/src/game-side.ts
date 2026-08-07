/**
 * Which side of a game something refers to. Mode-agnostic on purpose: spreads
 * are stored home-relative (arch §Spread strategy), so every surface that
 * renders or scores one has to say which end it means, whatever the mode's
 * picks are made of. Pick'em picks a side and Survivor picks a team, but both
 * read the same number off the same game.
 *
 * Distinct from `PICKEM_PICK_SIDE`, which is the wire value of a *Pick'em
 * pick* and is registered as an OpenAPI component. Its members are the same two
 * strings, so a `PickemPickSide` is usable wherever a `GameSide` is asked for —
 * what this set adds is a name Survivor and March Madness can use without
 * importing Pick'em's vocabulary to say "the away team".
 */
export const GAME_SIDE = {
  HOME: "home",
  AWAY: "away",
} as const;

export type GameSide = (typeof GAME_SIDE)[keyof typeof GAME_SIDE];
