import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { simFixtureGames, simFixtureTeams, simFixtureWeeks, simScenarios } from "@picksleagues/db";
import type { Clock, SimFixtureGameRow, SimFixtureSnapshot } from "@picksleagues/core";
import { projectFixtureGame } from "@picksleagues/core";
import {
  ERROR_CODE,
  SIM_FINAL_STATUS,
  type SimFixtureGame,
  type UpdateSimFixtureGameRequest,
  type WeekType,
} from "@picksleagues/schemas";

/**
 * Loads everything the `SimulatedProvider` serves for one scenario. Called
 * lazily, once per request that actually reaches the provider — a season is a
 * few hundred rows, so it is one read rather than a query per week.
 *
 * A scenario with no rows yields an empty season, which the provider reports the
 * same way ESPN reports an unpublished one. That is the honest answer for a
 * scenario whose fixtures were deleted out from under an active load.
 */
export async function readSimFixtureSnapshot(
  db: Db,
  scenarioId: string,
): Promise<SimFixtureSnapshot> {
  const [scenario] = await db
    .select({ seasonYear: simScenarios.seasonYear })
    .from(simScenarios)
    .where(eq(simScenarios.id, scenarioId));

  const [weeks, games, teams] = await Promise.all([
    db
      .select()
      .from(simFixtureWeeks)
      .where(eq(simFixtureWeeks.scenarioId, scenarioId))
      .orderBy(asc(simFixtureWeeks.startsAt)),
    db
      .select()
      .from(simFixtureGames)
      .where(eq(simFixtureGames.scenarioId, scenarioId))
      .orderBy(asc(simFixtureGames.kickoffAt)),
    db
      .select()
      .from(simFixtureTeams)
      .where(eq(simFixtureTeams.scenarioId, scenarioId))
      .orderBy(asc(simFixtureTeams.abbreviation)),
  ]);

  return {
    seasonYear: scenario?.seasonYear ?? 0,
    weeks: weeks.map((week) => ({
      weekType: week.weekType,
      weekNumber: week.weekNumber,
      label: week.label,
      startsAt: week.startsAt,
      endsAt: week.endsAt,
    })),
    games: games.map(toFixtureRow),
    teams: teams.map((team) => ({
      providerTeamId: team.providerTeamId,
      abbreviation: team.abbreviation,
      name: team.name,
      location: team.location,
      logoLightUrl: team.logoLightUrl,
      logoDarkUrl: team.logoDarkUrl,
    })),
  };
}

type FixtureGameRow = typeof simFixtureGames.$inferSelect;

/** Narrows a stored fixture row to the provider-facing shape (`SimFixtureGameRow`). */
function toFixtureRow(row: FixtureGameRow): SimFixtureGameRow {
  return {
    providerGameId: row.providerGameId,
    weekType: row.weekType,
    weekNumber: row.weekNumber,
    homeTeamAbbr: row.homeTeamAbbr,
    homeTeamName: row.homeTeamName,
    homeTeamProviderId: row.homeTeamProviderId,
    awayTeamAbbr: row.awayTeamAbbr,
    awayTeamName: row.awayTeamName,
    awayTeamProviderId: row.awayTeamProviderId,
    kickoffAt: row.kickoffAt,
    spread: row.spread,
    finalStatus: row.finalStatus,
    finalHomeScore: row.finalHomeScore,
    finalAwayScore: row.finalAwayScore,
  };
}

/**
 * Serializes a fixture with both its stored terminal truth and what the provider
 * reports at the current simulated instant. The projection is serialized rather
 * than left to the client so the clock rule (ADR-0012) has exactly one home.
 */
function serializeFixtureGame(row: FixtureGameRow, clock: Clock): SimFixtureGame {
  const projected = projectFixtureGame(toFixtureRow(row), clock.now());

  return {
    id: row.id,
    scenarioId: row.scenarioId,
    providerGameId: row.providerGameId,
    weekType: row.weekType,
    weekNumber: row.weekNumber,
    homeTeamAbbr: row.homeTeamAbbr,
    homeTeamName: row.homeTeamName,
    awayTeamAbbr: row.awayTeamAbbr,
    awayTeamName: row.awayTeamName,
    kickoffAt: row.kickoffAt.toISOString(),
    spread: row.spread,
    finalStatus: row.finalStatus,
    finalHomeScore: row.finalHomeScore,
    finalAwayScore: row.finalAwayScore,
    projectedStatus: projected.status,
    projectedHomeScore: projected.homeScore,
    projectedAwayScore: projected.awayScore,
  };
}

export async function listFixtureGames(
  db: Db,
  clock: Clock,
  filter: { scenarioId: string; weekType?: WeekType; weekNumber?: number },
): Promise<SimFixtureGame[]> {
  const conditions = [eq(simFixtureGames.scenarioId, filter.scenarioId)];
  if (filter.weekType !== undefined) {
    conditions.push(eq(simFixtureGames.weekType, filter.weekType));
  }
  if (filter.weekNumber !== undefined) {
    conditions.push(eq(simFixtureGames.weekNumber, filter.weekNumber));
  }

  const rows = await db
    .select()
    .from(simFixtureGames)
    .where(and(...conditions))
    .orderBy(asc(simFixtureGames.kickoffAt));

  return rows.map((row) => serializeFixtureGame(row, clock));
}

export type UpdateFixtureGameResult =
  | { ok: true; game: SimFixtureGame }
  | { ok: false; reason: typeof ERROR_CODE.FIXTURE_NOT_FOUND }
  | { ok: false; reason: typeof ERROR_CODE.VALIDATION; message: string };

/**
 * Hand-edits one fixture (spec §Testing: "load or hand-edit game outcomes").
 * Edits the scenario's stored truth, not the ingested `games` row — the operator
 * then re-runs the sync jobs and watches the correction flow through the same
 * ingestion path a real provider change would take.
 */
export async function updateFixtureGame(
  db: Db,
  clock: Clock,
  gameId: string,
  patch: UpdateSimFixtureGameRequest,
): Promise<UpdateFixtureGameResult> {
  const [existing] = await db.select().from(simFixtureGames).where(eq(simFixtureGames.id, gameId));
  if (!existing) {
    return { ok: false, reason: ERROR_CODE.FIXTURE_NOT_FOUND };
  }

  // A patch is partial, so coherence can only be judged on the merged row: a
  // caller can null one score while `finalStatus` stays `final` in the stored
  // row and never appears in the request.
  const merged = {
    finalStatus: patch.finalStatus ?? existing.finalStatus,
    finalHomeScore:
      patch.finalHomeScore !== undefined ? patch.finalHomeScore : existing.finalHomeScore,
    finalAwayScore:
      patch.finalAwayScore !== undefined ? patch.finalAwayScore : existing.finalAwayScore,
  };
  // `final` with a missing score would ingest as a `games` row at status final
  // with null scores — the one state ingestion guarantees cannot occur
  // (ingest-season.ts) and that settlement would have to defend against. The
  // replay importer refuses to produce it too; the hand-edit path must agree.
  if (
    merged.finalStatus === SIM_FINAL_STATUS.FINAL &&
    (merged.finalHomeScore === null || merged.finalAwayScore === null)
  ) {
    return {
      ok: false,
      reason: ERROR_CODE.VALIDATION,
      // Names only the two escapes that exist: `finalStatus` is non-nullable
      // and its other members are `cancelled`/`postponed`, so "clear the
      // status" — what this used to advise — is not something any caller can
      // express.
      message:
        "A final fixture needs both scores. Supply both, or set the status to cancelled or postponed.",
    };
  }

  const [updated] = await db
    .update(simFixtureGames)
    .set({
      ...(patch.kickoffAt !== undefined ? { kickoffAt: new Date(patch.kickoffAt) } : {}),
      ...(patch.weekType !== undefined ? { weekType: patch.weekType } : {}),
      ...(patch.weekNumber !== undefined ? { weekNumber: patch.weekNumber } : {}),
      ...(patch.spread !== undefined ? { spread: patch.spread } : {}),
      ...(patch.finalStatus !== undefined ? { finalStatus: patch.finalStatus } : {}),
      ...(patch.finalHomeScore !== undefined ? { finalHomeScore: patch.finalHomeScore } : {}),
      ...(patch.finalAwayScore !== undefined ? { finalAwayScore: patch.finalAwayScore } : {}),
      updatedAt: clock.now(),
    })
    .where(eq(simFixtureGames.id, gameId))
    .returning();

  if (!updated) {
    return { ok: false, reason: ERROR_CODE.FIXTURE_NOT_FOUND };
  }
  return { ok: true, game: serializeFixtureGame(updated, clock) };
}
