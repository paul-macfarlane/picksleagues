import { type AdminGame } from "@picksleagues/schemas";

/**
 * An admin game as members see it: every field override-resolved (arch D15
 * precedence, the `effective_*` columns). "What is the app currently saying
 * about this game" is the question every admin surface opens with, so the
 * matchup line and its state read this, and the provider values stay beside
 * it in the row's fields.
 */
export function adminGameEffective(game: AdminGame) {
  return {
    status: game.effectiveStatus,
    kickoffAt: game.effectiveKickoffAt,
    awayScore: game.effectiveAwayScore,
    homeScore: game.effectiveHomeScore,
    awayTeam: game.awayTeam,
    homeTeam: game.homeTeam,
    period: game.effectivePeriod,
    clockSeconds: game.effectiveClockSeconds,
  };
}
