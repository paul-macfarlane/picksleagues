import type { Db } from "@picksleagues/db";
import { isUniqueViolation, leagueSeasons } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  ERROR_CODE,
  LEAGUE_ACTION,
  LEAGUE_STATUS,
  type LeagueResponse,
} from "@picksleagues/schemas";
import { applyLeagueSeasonConclusion } from "./conclusion";
import { lockLeagueRow, lockLeagueSeasonRow } from "./locks";
import { authorizeLeagueAction, type LeagueActionRefusal } from "./authz";
import {
  getLeagueWithCurrentSeason,
  latestSeasonForSport,
  readAndSerializeLeague,
  sportForMode,
} from "./current-season";

export type RenewLeagueSeasonResult =
  | { ok: true; league: LeagueResponse }
  | LeagueActionRefusal
  | { ok: false; reason: typeof ERROR_CODE.NO_NEWER_SEASON };

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
    if (!current) return { ok: false, reason: ERROR_CODE.LEAGUE_NOT_FOUND };
    const { league, season } = current;

    const latest = await latestSeasonForSport(tx, sportForMode(league.mode));
    // Strictly greater — the current instance already being on the latest
    // season is the common no-op, not an error condition worth its own reason.
    if (!latest || latest.year <= season.seasonYear) {
      return { ok: false, reason: ERROR_CODE.NO_NEWER_SEASON };
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
        return { ok: false, reason: ERROR_CODE.NO_NEWER_SEASON };
      }
      throw error;
    }

    // The instance just superseded is over, whatever its own weeks say
    // (ADR-0030). No mode answer is passed because none is needed: the row
    // inserted above makes the superseded arm true on its own. This is what
    // retires a season the mode rule can never conclude — one whose schedule was
    // never fully ingested — from the nightly sweep the moment the league moves
    // on, rather than leaving it recomputed forever.
    //
    // Behind the same row lock every settler takes, so a rebuild of the prior
    // instance in flight right now cannot read its own snapshot of the status
    // and overwrite this one: without it that rebuild would see no newer season
    // (its snapshot predates the INSERT above) and write `active` back.
    await lockLeagueSeasonRow(tx, season.id);
    await applyLeagueSeasonConclusion(tx, clock, season.id, false);

    return null;
  });
  if (refusal) return refusal;

  // Serialize the new current instance (now the latest year) post-commit —
  // the new instance drives status/seasonYear/settings/startsAt, and
  // `renewable` is now false (bound to the latest).
  const league = await readAndSerializeLeague(db, leagueId, userId);
  if (!league) throw new Error("Renewed league unreadable immediately after renewal.");
  return { ok: true, league };
}
