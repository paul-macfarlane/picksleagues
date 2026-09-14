import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { leagueSeasons, leagues, sportSeasons, type Db } from "@picksleagues/db";
import {
  AgentLeagueDiscoveryQuerySchema,
  AgentLeagueDiscoveryResponseSchema,
  LEAGUE_MODE,
  SPORT,
} from "@picksleagues/schemas";
import type { z } from "@hono/zod-openapi";

/** A single bounded query discovers supported NFL targets without loading member or pick data. */
export async function agentLeagueDiscovery(
  db: Db,
  query: z.output<typeof AgentLeagueDiscoveryQuerySchema>,
) {
  const rows = await db
    .select({
      leagueSeasonId: leagueSeasons.id,
      mode: leagues.mode,
      status: leagueSeasons.status,
    })
    .from(leagueSeasons)
    .innerJoin(leagues, eq(leagues.id, leagueSeasons.leagueId))
    .innerJoin(sportSeasons, eq(sportSeasons.id, leagueSeasons.seasonId))
    .where(
      and(
        eq(leagueSeasons.seasonId, query.seasonId),
        eq(sportSeasons.sport, SPORT.NFL),
        inArray(leagues.mode, [LEAGUE_MODE.PICKEM, LEAGUE_MODE.SURVIVOR]),
        query.cursor ? gt(leagueSeasons.id, query.cursor) : undefined,
      ),
    )
    .orderBy(asc(leagueSeasons.id))
    .limit(query.limit + 1);
  const items = rows.slice(0, query.limit);
  return AgentLeagueDiscoveryResponseSchema.parse({
    seasonId: query.seasonId,
    items,
    nextCursor: rows.length > query.limit ? items.at(-1)!.leagueSeasonId : null,
  });
}
