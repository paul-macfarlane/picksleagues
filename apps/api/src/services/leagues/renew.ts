import { desc, eq, max } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { isUniqueViolation, leagueSeasons, sportSeasons } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  LEAGUE_ACTION,
  LEAGUE_MODE,
  LEAGUE_STATUS,
  SPORT,
  type LeagueMode,
  type LeagueResponse,
  type Sport,
} from "@picksleagues/schemas";
import { lockLeagueRow } from "./locks";
import { authorizeLeagueAction } from "./authz";
import { getLeagueWithCurrentSeason } from "./current-season";
import { leagueStartAt } from "./start";
import { loadMembers, serializeLeague } from "./serialize";

/** The sport whose seasons a mode's leagues bind to (create + renewal). */
export function sportForMode(mode: LeagueMode): Sport {
  return mode === LEAGUE_MODE.MARCH_MADNESS ? SPORT.NCAAMB : SPORT.NFL;
}

/**
 * The greatest ingested `sport_seasons.year` for one sport, or null when the
 * sport has no seasons yet. Single-league serializers use this to derive
 * `renewable`; renewal itself re-reads the row inside its lock.
 */
export async function latestSeasonYearForSport(db: Db, sport: Sport): Promise<number | null> {
  const [row] = await db
    .select({ latest: max(sportSeasons.year) })
    .from(sportSeasons)
    .where(eq(sportSeasons.sport, sport));
  return row?.latest ?? null;
}

/**
 * The greatest ingested year per sport in one query — the multi-league list
 * (`listMyLeagues`) resolves every league's `renewable` from this map instead
 * of a per-league lookup (no N+1).
 */
export async function latestSeasonYearBySport(db: Db): Promise<Map<Sport, number>> {
  const rows = await db
    .select({ sport: sportSeasons.sport, latest: max(sportSeasons.year) })
    .from(sportSeasons)
    .groupBy(sportSeasons.sport);
  return new Map(rows.filter((r) => r.latest !== null).map((r) => [r.sport, r.latest as number]));
}

/** A newer season exists for the sport than the instance's bound year. */
export function isRenewable(latestYear: number | null, currentYear: number): boolean {
  return latestYear !== null && latestYear > currentYear;
}

export type RenewLeagueSeasonResult =
  | { ok: true; league: LeagueResponse }
  | { ok: false; reason: "league_not_found" | "not_commissioner" | "no_newer_season" };

/**
 * Explicit renewal (ADR-0009): a commissioner mints the league's next season
 * instance, copying the current instance's settings verbatim. The INSERT runs
 * inside a transaction that takes `lockLeagueRow` FIRST (SF-1 evaluator
 * advisory): every membership-mutating tx validates against the current
 * instance under this lock, so serializing renewal against them keeps an
 * unlocked renewal from committing alongside a join it should have refused.
 *
 * No commissioner-cap check: renewal doesn't change how many leagues exist, and
 * the cap counts a league once by its current instance
 * (`countActiveCommissionerships`), so minting a newer instance can't push the
 * count up.
 */
export async function renewLeagueSeason(
  db: Db,
  clock: Clock,
  leagueId: string,
  userId: string,
): Promise<RenewLeagueSeasonResult> {
  const now = clock.now();

  const refusal = await db.transaction(async (tx): Promise<RenewLeagueSeasonResult | null> => {
    await lockLeagueRow(tx, leagueId);

    const gate = await authorizeLeagueAction(tx, leagueId, userId, LEAGUE_ACTION.RENEW_SEASON);
    if (!gate.ok) return gate;

    // Read the current instance under the lock (ADR-0009): the newer-season
    // guard and the unique-constraint backstop must see the same serialized
    // snapshot every join/settings mutation does.
    const current = await getLeagueWithCurrentSeason(tx, leagueId);
    if (!current) return { ok: false, reason: "league_not_found" };
    const { league, season } = current;

    const [latest] = await tx
      .select()
      .from(sportSeasons)
      .where(eq(sportSeasons.sport, sportForMode(league.mode)))
      .orderBy(desc(sportSeasons.year))
      .limit(1);
    // Strictly greater — the current instance already being on the latest
    // season is the common no-op, not an error condition worth its own reason.
    if (!latest || latest.year <= season.seasonYear) {
      return { ok: false, reason: "no_newer_season" };
    }

    try {
      await tx.insert(leagueSeasons).values({
        leagueId,
        seasonId: latest.id,
        // Copied verbatim (ADR-0009) — a per-season snapshot, editable pre-start
        // like any settings.
        settings: season.settings,
        status: LEAGUE_STATUS.ACTIVE,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      // Two concurrent renewals: the loser hits unique(league_id, season_id).
      // Same refusal as an already-latest league — the season it would mint now
      // exists, so there's no newer season left to add.
      if (isUniqueViolation(error, "league_seasons_league_season_unique")) {
        return { ok: false, reason: "no_newer_season" };
      }
      throw error;
    }

    return null;
  });
  if (refusal) return refusal;

  // Serialize the new current instance (now the latest year) post-commit, the
  // same path createLeague takes — the new instance drives status/seasonYear/
  // settings/startsAt, and `renewable` is now false (bound to the latest).
  const updated = await getLeagueWithCurrentSeason(db, leagueId);
  if (!updated) throw new Error("Renewed league unreadable immediately after renewal.");
  const { league, season } = updated;
  const startsAt = await leagueStartAt(
    db,
    { mode: league.mode, seasonId: season.seasonId },
    season.settings,
  );
  const members = await loadMembers(db, leagueId);
  const latestYear = await latestSeasonYearForSport(db, sportForMode(league.mode));
  return {
    ok: true,
    league: serializeLeague(
      league,
      season.status,
      season.seasonYear,
      season.settings,
      startsAt,
      members,
      userId,
      isRenewable(latestYear, season.seasonYear),
    ),
  };
}
