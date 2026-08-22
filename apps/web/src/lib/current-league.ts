import type { LeagueSummary } from "@picksleagues/schemas";

const LAST_LEAGUE_STORAGE_KEY = "picksleagues:last-league";

/**
 * Which league the phone tab bar's "League" tab opens (MOB-2): the one last
 * visited on this device, else the first the member belongs to. Device
 * state, not server state — the same member on two phones may well be
 * following two different leagues, and a server-side "current league" would
 * ping-pong between them. The stored id is never trusted on its own: it is
 * resolved against the member's live league list, so a league they left (or
 * another account's league on a shared device) falls through to the default.
 */
export function resolveCurrentLeague(
  leagues: readonly LeagueSummary[],
  rememberedId: string | null,
): LeagueSummary | undefined {
  return leagues.find((league) => league.id === rememberedId) ?? leagues[0];
}

// Guarded like every other device preference: storage throws in some private
// modes, and a nav bar must not take the shell down with it.
export function readRememberedLeague(): string | null {
  try {
    return localStorage.getItem(LAST_LEAGUE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function rememberLeague(leagueId: string): void {
  try {
    localStorage.setItem(LAST_LEAGUE_STORAGE_KEY, leagueId);
  } catch {
    // The tab simply keeps opening the first league.
  }
}
