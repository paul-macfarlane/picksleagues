import {
  getESPNEventScoreFromRefUrl,
  getESPNEventsFromRefUrl,
  getESPNEventStatusFromRefUrl,
} from "@/integrations/espn/sportLeagueGames";
import { getCurrentDBSportWeeks } from "@/db/sportWeeks";
import { upsertDBSportGames } from "@/db/sportGames";
import { getDBSportTeamByEspnId } from "@/db/sportTeams";
import { db } from "@/db/client";
import {
  DBOddsProvider,
  getDBOddsProviderByEspnId,
  upsertDBOddsProviders,
  upsertDBSportGameOdds,
  UpsertDBSportGameOdds,
} from "@/db/sportGameOdds";
import { getESPNEventOddsFromRefUrl } from "@/integrations/espn/sportLeagueOdds";
import { NextRequest } from "next/server";

// todo this is functional but slow (~10s per run with active games), look into optimizing
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json(
      { message: "Unauthorized" },
      {
        status: 401,
      },
    );
  }

  try {
    await db.transaction(async (tx) => {
      const dbSportWeeks = await getCurrentDBSportWeeks(tx);
      if (!dbSportWeeks.length) {
        console.warn("No active sport weeks found.");
        return;
      }

      for (const dbSportWeek of dbSportWeeks) {
        if (!dbSportWeek.espnEventsRef) {
          console.warn(`No ESPN event ref found for week ${dbSportWeek.id}`);
          continue;
        }

        const espnEventsForWeek = await getESPNEventsFromRefUrl(
          dbSportWeek.espnEventsRef,
        );
        for (const espnEvent of espnEventsForWeek) {
          if (!espnEvent.competitions.length) {
            console.warn(
              `No competitions found for event ${espnEvent.id} in week ${dbSportWeek.id}`,
            );
            continue;
          }

          const espnEventStatus = await getESPNEventStatusFromRefUrl(
            espnEvent.competitions[0].status.$ref,
          );

          const espnHomeTeam = espnEvent.competitions[0].competitors.find(
            (c) => c.homeAway === "home",
          );
          if (!espnHomeTeam) {
            console.warn(
              `No home team found for event ${espnEvent.id} in week ${dbSportWeek.id}`,
            );
            continue;
          }

          const espnAwayTeam = espnEvent.competitions[0].competitors.find(
            (c) => c.homeAway === "away",
          );
          if (!espnAwayTeam) {
            console.warn(
              `No away team found for event ${espnEvent.id} in week ${dbSportWeek.id}`,
            );
            continue;
          }

          const homeDBSportTeam = await getDBSportTeamByEspnId(
            espnHomeTeam.id,
            tx,
          );
          if (!homeDBSportTeam) {
            console.warn(
              `No home team found in db for event ${espnEvent.id} in week ${dbSportWeek.id}`,
            );
            continue;
          }

          const awayDBSportTeam = await getDBSportTeamByEspnId(
            espnAwayTeam.id,
            tx,
          );
          if (!awayDBSportTeam) {
            console.warn(
              `No away team found in db for event ${espnEvent.id} in week ${dbSportWeek.id}`,
            );
            continue;
          }

          const espnHomeTeamScore = await getESPNEventScoreFromRefUrl(
            espnHomeTeam.score.$ref,
          );
          const espnAwayTeamScore = await getESPNEventScoreFromRefUrl(
            espnAwayTeam.score.$ref,
          );

          const [dbSportsGame] = await upsertDBSportGames(
            [
              {
                weekId: dbSportWeek.id,
                startTime: new Date(espnEvent.date),
                status: espnEventStatus.type.name,
                clock: espnEventStatus.displayClock,
                period: espnEventStatus.period,
                homeTeamId: homeDBSportTeam.id,
                homeTeamScore: espnHomeTeamScore.value,
                awayTeamId: awayDBSportTeam.id,
                awayTeamScore: espnAwayTeamScore.value,
                espnEventId: espnEvent.id,
              },
            ],
            tx,
          );
          if (espnEventStatus.period > 0) {
            console.log(
              `Game ${dbSportsGame.id} for event ${espnEvent.id} has started, no longer updating odds.`,
            );
            continue;
          }

          const oddList = await getESPNEventOddsFromRefUrl(
            espnEvent.competitions[0].odds.$ref,
          );
          const oddsUpserts: UpsertDBSportGameOdds[] = [];
          for (const oddsData of oddList) {
            let dbOddsProvider = await getOddsProviderByEspnIdCached(
              oddsData.provider.id,
            );
            if (!dbOddsProvider) {
              dbOddsProvider = (
                await upsertDBOddsProviders(
                  [
                    {
                      name: oddsData.provider.name,
                      espnId: oddsData.provider.id,
                    },
                  ],
                  tx,
                )
              )[0];
            }

            const favoriteDBTeamId = oddsData.awayTeamOdds.favorite
              ? awayDBSportTeam.id
              : homeDBSportTeam.id;
            const underDogDBTeamId = oddsData.awayTeamOdds.favorite
              ? homeDBSportTeam.id
              : awayDBSportTeam.id;
            oddsUpserts.push({
              gameId: dbSportsGame.id,
              providerId: dbOddsProvider.id!,
              favoriteTeamId: favoriteDBTeamId,
              underDogTeamId: underDogDBTeamId,
              spread: oddsData.spread,
              overUnder: oddsData.overUnder,
            });
          }

          await upsertDBSportGameOdds(oddsUpserts, tx);
        }
      }
    });
  } catch (e) {
    console.error(e);
  }

  return Response.json({
    success: true,
  });
}

let oddsProviderCache: Map<string, DBOddsProvider> = new Map();
let lastRefreshedOddsProviderCache: Date = new Date(0);

async function getOddsProviderByEspnIdCached(
  espnId: string,
): Promise<DBOddsProvider | null> {
  if (
    new Date().getTime() - lastRefreshedOddsProviderCache.getTime() >
    1000 * 60
  ) {
    oddsProviderCache = new Map();
    lastRefreshedOddsProviderCache = new Date();
  }

  if (oddsProviderCache.has(espnId)) {
    return oddsProviderCache.get(espnId) ?? null;
  }

  const provider = await getDBOddsProviderByEspnId(espnId);
  if (!provider) {
    return null;
  }

  oddsProviderCache.set(espnId, provider);
  return provider;
}
