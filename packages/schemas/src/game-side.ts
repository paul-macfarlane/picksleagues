/**
 * The two sides of a game, mode-agnostic: the matchup line, the simulated
 * provider, and the stats context all name a side without a pick in sight.
 * `PICKEM_PICK_SIDE` is this same set under the name the stored pick uses, so
 * a pick's side and a game's side can never be two vocabularies.
 */
export const GAME_SIDE = {
  HOME: "home",
  AWAY: "away",
} as const;

export type GameSide = (typeof GAME_SIDE)[keyof typeof GAME_SIDE];
