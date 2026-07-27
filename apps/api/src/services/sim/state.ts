import { asc, count, desc, eq } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { getSimState, setSimState, simFixtureGames, simScenarios } from "@picksleagues/db";
import { latestCompletedNflSeasonYear, nflSeasonYearFor, type Clock } from "@picksleagues/core";
import {
  ERROR_CODE,
  SIM_SCENARIO_SOURCE,
  type SimClockState,
  type SimScenario,
  type SimStateResponse,
} from "@picksleagues/schemas";
import { materializeDefinition, writeScenario } from "./definition";
import { listLibraryEntries, SIM_SCENARIO_LIBRARY } from "./scenarios";
import { readRealNow, simClockStateFrom } from "./clock";

type ScenarioRow = typeof simScenarios.$inferSelect;

function serializeScenario(row: ScenarioRow, gameCount: number): SimScenario {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    sport: row.sport,
    seasonYear: row.seasonYear,
    source: row.source,
    startsAt: row.startsAt.toISOString(),
    gameCount,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Every stored scenario with its fixture count — the count is the signal an
 * operator actually needs, since a scenario row with zero games is a load that
 * failed halfway rather than a scenario that is ready.
 */
async function listScenarios(db: Db): Promise<SimScenario[]> {
  const rows = await db
    .select({
      scenario: simScenarios,
      gameCount: count(simFixtureGames.id),
    })
    .from(simScenarios)
    .leftJoin(simFixtureGames, eq(simFixtureGames.scenarioId, simScenarios.id))
    .groupBy(simScenarios.id)
    .orderBy(desc(simScenarios.updatedAt), asc(simScenarios.slug));

  return rows.map((row) => serializeScenario(row.scenario, row.gameCount));
}

/**
 * The whole simulator panel in one read: clock, what's loaded, what's loadable.
 *
 * `clockOverride` is how a handler that just moved the clock reports the state
 * it wrote. The request's `Clock` was resolved from the previous offset, so
 * deriving `now` from it here would contradict the offset now in the database.
 */
export async function readSimState(
  db: Db,
  clock: Clock,
  clockOverride?: SimClockState,
): Promise<SimStateResponse> {
  const [{ offsetMs, activeScenarioId }, scenarios] = await Promise.all([
    getSimState(db),
    listScenarios(db),
  ]);

  const clockState = clockOverride ?? simClockStateFrom(clock.now().getTime() - offsetMs, offsetMs);

  return {
    clock: clockState,
    activeScenario: scenarios.find((scenario) => scenario.id === activeScenarioId) ?? null,
    scenarios,
    library: listLibraryEntries(),
    // Against real time, matching `isReplayableSeasonYear`'s own basis (replay.ts):
    // a loaded replay parks the simulated clock inside the season it imported, so
    // deriving this from simulated now would hide that season from the panel. Must
    // stay the same function `isReplayableSeasonYear` guards against, so the
    // picker's default is always accepted by the import guard.
    latestReplayableSeasonYear: latestCompletedNflSeasonYear(new Date(clockState.realNow)),
  };
}

export type LoadScenarioResult =
  | { ok: true; state: SimStateResponse }
  | { ok: false; reason: typeof ERROR_CODE.SCENARIO_NOT_FOUND };

/**
 * Loads a scenario by slug and makes it the active data source (SIM-3).
 *
 * A library slug is (re)materialized from its code definition against the
 * current real instant, so its relative kickoffs always land in the operator's
 * near future. A stored scenario — chiefly an imported replay (SIM-6) — is used
 * as-is; its fixtures are real historical timestamps and must not be shifted.
 *
 * Loading always positions the clock at the scenario's `startsAt` (ADR-0012):
 * that is what makes a past season replayable and a library week pickable.
 *
 * Loading deliberately does **not** clear already-ingested sports data, because
 * it can't: `league_seasons` references `sport_seasons` with RESTRICT (ADR-0008),
 * so seasons cannot be dropped while leagues reference them. A scenario whose
 * season year collides with a real ingested season would therefore merge its
 * games into that season row on the next sync. The operator workflow is
 * `POST /sim/reset { scope: "environment" }` first — it deletes league rows
 * before sports data, in the one order that satisfies those FKs — then load.
 * Simulated games stay identifiable regardless: their `provider_game_id` is
 * slug-prefixed.
 */
export async function loadScenario(
  db: Db,
  clock: Clock,
  slug: string,
): Promise<LoadScenarioResult> {
  const definition = SIM_SCENARIO_LIBRARY[slug];
  // Anchoring to real rather than simulated time is what stops repeated loads
  // from compounding the previous shift.
  const { realNowMs } = await readRealNow(db, clock);
  const realNow = new Date(realNowMs);

  let scenarioId: string;
  let startsAt: Date;

  if (definition) {
    // Season year derived from the last kickoff rather than the anchor: library
    // kickoffs run days past it, and `nflSeasonYearFor` flips on Aug 1. A
    // scenario loaded in late July would otherwise be stamped with the previous
    // season while its games sit in the next one — the sync jobs, deriving the
    // year from the clock once the operator advances into those games, would
    // then ask the provider for a season the scenario doesn't cover and every
    // job would silently no-op.
    const lastKickoff = definition.games.reduce(
      (latest, game) => Math.max(latest, game.kickoffAtOffsetMs),
      0,
    );
    const materialized = materializeDefinition(
      definition,
      realNow,
      nflSeasonYearFor(new Date(realNow.getTime() + lastKickoff)),
      SIM_SCENARIO_SOURCE.LIBRARY,
    );
    scenarioId = await writeScenario(db, clock, materialized);
    startsAt = materialized.startsAt;
  } else {
    const [stored] = await db
      .select({ id: simScenarios.id, startsAt: simScenarios.startsAt })
      .from(simScenarios)
      .where(eq(simScenarios.slug, slug));
    if (!stored) {
      return { ok: false, reason: ERROR_CODE.SCENARIO_NOT_FOUND };
    }
    scenarioId = stored.id;
    startsAt = stored.startsAt;
  }

  // One statement: a scenario left active against the previous offset would put
  // a replay past every kickoff, which is the exact state loading exists to avoid.
  const nextOffsetMs = Math.trunc(startsAt.getTime() - realNow.getTime());
  await setSimState(db, { activeScenarioId: scenarioId, offsetMs: nextOffsetMs });

  // Reports the offset just written, not the one this request's Clock carries.
  return {
    ok: true,
    state: await readSimState(db, clock, simClockStateFrom(realNow.getTime(), nextOffsetMs)),
  };
}
