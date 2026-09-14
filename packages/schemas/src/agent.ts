import { z } from "@hono/zod-openapi";
import { GameStatusSchema } from "./game-status";
import { LeagueModeSchema } from "./league-mode";
import { LeagueStatusSchema } from "./league-status";
import { PickTypeSchema } from "./pick-type";
import { SportSchema } from "./sport";
import { WeekTypeSchema } from "./week-type";

/** Bounded diagnostic vocabulary; no exception or provider text crosses this boundary. */
export const AGENT_ANOMALY = {
  NO_SEASON: "no_season",
  NO_GAMES: "no_games",
  MISSING_SPREAD: "missing_spread",
  FINAL_WITHOUT_SCORE: "final_without_score",
  SCHEDULED_AFTER_KICKOFF: "scheduled_after_kickoff",
  UNGRADED_RESOLVED_PICKS: "ungraded_resolved_picks",
  INCONSISTENT_ROWS: "inconsistent_rows",
  MISSING_STANDINGS: "missing_standings",
  UNSUPPORTED_MODE: "unsupported_mode",
} as const;

const count = z.number().int().nonnegative();
const instant = z.iso.datetime();
const anomalies = z.array(z.enum(AGENT_ANOMALY)).max(Object.keys(AGENT_ANOMALY).length);
const weekFields = {
  weekId: z.uuid(),
  seasonId: z.uuid(),
  weekType: WeekTypeSchema,
  weekNumber: z.number().int(),
  startsAt: instant,
  endsAt: instant,
};

/** Neutral row-change timestamps deliberately make no job-success or per-feed claim. */
export const AgentWeekResponseSchema = z
  .object({
    ...weekFields,
    gameCounts: z.object({
      scheduled: count,
      in_progress: count,
      final: count,
      postponed: count,
      cancelled: count,
    }),
    missingSpreadCount: count,
    finalWithoutScoreCount: count,
    scheduledAfterKickoffCount: count,
    dataUpdatedAt: instant.nullable(),
    anomalies,
  })
  .openapi("AgentWeekResponse");

const team = z.object({ id: z.uuid(), abbreviation: z.string().max(16) });
/** Explicit game allowlist excludes provider free text, team names, locations and images. */
export const AgentGameResponseSchema = z
  .object({
    gameId: z.uuid(),
    weekId: z.uuid(),
    providerGameId: z.string().max(128),
    homeTeam: team,
    awayTeam: team,
    kickoffAt: instant,
    status: GameStatusSchema,
    homeScore: z.number().int().nullable(),
    awayScore: z.number().int().nullable(),
    period: z.number().int().nullable(),
    clockSeconds: z.number().int().nullable(),
    spread: z.number().nullable(),
    hasSpreadSource: z.boolean(),
    gameStateUpdatedAt: instant,
    anomalies,
  })
  .openapi("AgentGameResponse");

/** V1 diagnostics cover the shipped NFL modes; absent ingestion is explicit. */
export const AgentSystemResponseSchema = z
  .object({
    environment: z.enum(["local", "staging", "production"]),
    serverTime: instant,
    supportedSports: z.array(SportSchema).max(2),
    seasonId: z.uuid().nullable(),
    seasonYear: z.number().int(),
    provisional: z.boolean().nullable(),
    currentWeekId: z.uuid().nullable(),
    dataUpdatedAt: instant.nullable(),
    anomalies,
  })
  .openapi("AgentSystemResponse");

/** Independently allowlisted settings keep future JSONB fields outside the agent contract. */
export const AgentSettingsSchema = z
  .object({
    startWeek: z.object({ type: WeekTypeSchema, number: z.number().int() }),
    endWeek: z.object({ type: WeekTypeSchema, number: z.number().int() }),
    pickType: PickTypeSchema.optional(),
    picksPerWeek: z.number().int().optional(),
  })
  .openapi("AgentSettings");
const NullableAgentSettingsSchema = AgentSettingsSchema.nullable().openapi("NullableAgentSettings");

/** Counts only: no user/member/pick identifiers or per-member outcomes. */
export const AgentLeagueDiagnosticsResponseSchema = z
  .object({
    leagueSeasonId: z.uuid(),
    seasonId: z.uuid(),
    mode: LeagueModeSchema,
    status: LeagueStatusSchema,
    settings: NullableAgentSettingsSchema,
    currentWeekId: z.uuid().nullable(),
    memberCount: count,
    submittedPickCount: count,
    gradedPickCount: count,
    ungradedPickCount: count,
    ungradedResolvedPickCount: count,
    standingStateRowCount: count,
    missingStandingCount: count,
    inconsistentRowCount: count,
    duplicateRowCount: count,
    dataUpdatedAt: instant.nullable(),
    anomalies,
  })
  .openapi("AgentLeagueDiagnosticsResponse");

/** Checked means a full comparison ran, not that every comparison matched. */
export const AGENT_RECONCILIATION_STATUS = {
  CHECKED: "checked",
  UNSUPPORTED_MODE: "unsupported_mode",
} as const;

const reconciliationCounts = z.object({
  expectedCount: count,
  storedCount: count,
  missingCount: count,
  unexpectedCount: count,
  mismatchCount: count,
});

/** Aggregate replay differences; null categories were not applicable or not checked. */
export const AgentReconciliationResponseSchema = z
  .object({
    leagueSeasonId: z.uuid(),
    mode: LeagueModeSchema,
    checkedAt: instant,
    status: z.enum(AGENT_RECONCILIATION_STATUS),
    results: reconciliationCounts.nullable(),
    standings: reconciliationCounts.nullable(),
    survivorState: reconciliationCounts.nullable(),
    releasedFlagMismatchCount: count.nullable(),
  })
  .openapi("AgentReconciliationResponse");
