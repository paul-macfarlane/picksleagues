import { and, eq, gt } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { leagueSeasons, sportSeasons } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import { LEAGUE_STATUS } from "@picksleagues/schemas";

/**
 * The one writer of `league_seasons.status` after an instance is minted
 * (ADR-0030). The column is a **materialized derivation**, on the same terms as
 * `pickem_standings` and `survivor_state` (arch D10): settlement recomputes it
 * inside the transaction that recomputes everything else, and it is written in
 * both directions, so an override that un-finals a game reopens the season and
 * no state survives that a full recompute wouldn't reproduce.
 *
 * That two-way property is what the six readers of `concluded` depend on — both
 * pick services, the join path, the invite explainer, discovery, and the
 * commissioner cap all refuse or hide on it, and every one of those refusals has
 * to lift again when the data that caused it is corrected.
 */

/**
 * Applies `concluded ⇔ superseded ∨ modeDecided` to one instance (ADR-0030).
 *
 * Pass `modeDecided` from the settlement that just ran — Pick'em's range having
 * played out, or Survivor's replay having finished its range or stopped on the
 * sole-survivor reduction. Renewal passes `false`: it has no mode answer and
 * needs none, because the newer instance it inserted moments earlier in the same
 * transaction makes the superseded arm true on its own.
 *
 * **Call it inside the caller's transaction.** Settlement's write must commit or
 * roll back with the results it describes, or a rolled-back rebuild leaves a
 * season marked finished on state that was never written.
 */
export async function applyLeagueSeasonConclusion(
  tx: Db,
  clock: Clock,
  leagueSeasonId: string,
  modeDecided: boolean,
): Promise<void> {
  const [instance] = await tx
    .select({
      leagueId: leagueSeasons.leagueId,
      status: leagueSeasons.status,
      seasonYear: sportSeasons.year,
    })
    .from(leagueSeasons)
    .innerJoin(sportSeasons, eq(sportSeasons.id, leagueSeasons.seasonId))
    .where(eq(leagueSeasons.id, leagueSeasonId));
  if (!instance) return;

  const decided = modeDecided || (await isSuperseded(tx, instance.leagueId, instance.seasonYear));
  const status = decided ? LEAGUE_STATUS.CONCLUDED : LEAGUE_STATUS.ACTIVE;
  // Nothing changed, so nothing is written: settling twice must land on
  // identical state, `updated_at` included (arch D10 — the incremental path is
  // an optimization over the sweep, never a source of churn it wouldn't produce).
  if (instance.status === status) return;

  await tx
    .update(leagueSeasons)
    .set({ status, updatedAt: clock.now() })
    .where(eq(leagueSeasons.id, leagueSeasonId));
}

/**
 * Whether the league has moved past this instance — a newer one exists, so by
 * ADR-0009's derived-current rule this is not the league's current season and
 * cannot be the one being played.
 *
 * This is the arm that retires what the mode rules cannot reach: a season whose
 * schedule was never fully ingested, or whose last week holds a game stuck in
 * `postponed`, would otherwise stay `active` and be recomputed by the nightly
 * sweep forever, years after its league moved on.
 */
async function isSuperseded(tx: Db, leagueId: string, seasonYear: number): Promise<boolean> {
  const [newer] = await tx
    .select({ id: leagueSeasons.id })
    .from(leagueSeasons)
    .innerJoin(sportSeasons, eq(sportSeasons.id, leagueSeasons.seasonId))
    .where(and(eq(leagueSeasons.leagueId, leagueId), gt(sportSeasons.year, seasonYear)))
    .limit(1);
  return newer !== undefined;
}
