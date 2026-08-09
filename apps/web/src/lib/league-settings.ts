import {
  LEAGUE_MODE,
  LEAGUE_SETTINGS_SCHEMAS,
  type SurvivorSettings,
  type LeagueResponse,
  type MarchMadnessSettings,
  type PickemSettings,
} from "@picksleagues/schemas";

/**
 * A league's settings as its mode's schema defines them — **parsed, never
 * cast**.
 *
 * `LeagueResponse.settings` is the `LeagueSettings` union, so reading a
 * mode-specific field needs narrowing, and `as PickemSettings` is the tempting
 * way to get it. It is the wrong way: settings JSONB evolves additively
 * (engineering rules §Data), so a row stored before a field existed carries no
 * value for it, and a cast asserts one is there. Every read that matters —
 * settlement's input loader, the settings write path — parses through
 * `LEAGUE_SETTINGS_SCHEMAS` precisely so `.default()`s materialize. A client
 * that casts instead reads `undefined` where the server reads a real default,
 * and the two silently disagree about what the league is configured as.
 *
 * `null` covers both "not this mode" and "the stored blob doesn't parse".
 * Callers must treat the second as unknown-and-unsafe rather than absent: a
 * blob the server itself wrote always parses, so a failure means something is
 * wrong that a default value would paper over.
 */
export function pickemSettingsOf(league: LeagueResponse): PickemSettings | null {
  if (league.mode !== LEAGUE_MODE.PICKEM) return null;
  const parsed = LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.PICKEM].safeParse(league.settings);
  return parsed.success ? parsed.data : null;
}

export function survivorSettingsOf(league: LeagueResponse): SurvivorSettings | null {
  if (league.mode !== LEAGUE_MODE.SURVIVOR) return null;
  const parsed = LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.SURVIVOR].safeParse(league.settings);
  return parsed.success ? parsed.data : null;
}

export function marchMadnessSettingsOf(league: LeagueResponse): MarchMadnessSettings | null {
  if (league.mode !== LEAGUE_MODE.MARCH_MADNESS) return null;
  const parsed = LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.MARCH_MADNESS].safeParse(league.settings);
  return parsed.success ? parsed.data : null;
}
