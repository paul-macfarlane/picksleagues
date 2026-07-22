// A single home for the query key so every mutation across the league page's
// components invalidates (and the top-level query subscribes to) the exact
// same cache entry.
export function leagueQueryKey(leagueId: string) {
  return ["league", leagueId];
}
