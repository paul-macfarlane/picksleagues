import { PicksLeagueMyPicksForm } from "@/app/(main)/picks-leagues/[...leagueIdSubPaths]/my-picks/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GamePickStatuses, getGamePickStatus } from "@/shared/picksLeaguePicks";
import {
  DBWeeklyPickDataByUserGame,
  getCurrentDBSportLeagueWeek,
  getUserDBWeeklyPickData,
} from "@/db/sportLeagueWeeks";
import { SportLeagueGameStatuses } from "@/models/sportLeagueGames";
import { PicksLeagueGameBox } from "@/app/(main)/picks-leagues/[...leagueIdSubPaths]/GameBox";
import { PicksLeaguePickTypes } from "@/models/picksLeagues";

export interface PicksLeagueMyPicksTabProps {
  picksLeagueId: string;
  sportsLeagueId: string;
  picksPerWeek: number;
  userId: string;
  pickType: PicksLeaguePickTypes;
}

export async function PicksLeagueMyPicksTab({
  picksLeagueId,
  sportsLeagueId,
  picksPerWeek,
  userId,
  pickType,
}: PicksLeagueMyPicksTabProps) {
  // todo also allow for week id to come from query params, default to current week
  const currentDBWeek = await getCurrentDBSportLeagueWeek(sportsLeagueId);
  if (!currentDBWeek) {
    return (
      <Card className="mx-auto w-full max-w-4xl">
        <CardHeader>
          <CardTitle>No Pick Data</CardTitle>
          <CardDescription>
            There are no picks to make this week.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const picksData = await getUserDBWeeklyPickData(
    picksLeagueId,
    currentDBWeek.id,
    userId,
  );
  if (!picksData) {
    return (
      <Card className="mx-auto w-full max-w-4xl">
        <CardHeader>
          <CardTitle>No Week Data</CardTitle>
          <CardDescription>
            There are no games to pick this week.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const picksMade = picksData.games.findIndex((game) => !!game.userPick) !== -1;
  if (picksMade) {
    picksData.games = picksData.games.filter((game) => !!game.userPick);
  } else {
    const now = new Date();
    picksData.games = picksData.games.filter((game) => game.startTime > now);
  }

  const requiredAmountOfPicks = Math.min(picksPerWeek, picksData.games.length);

  const correctPickCount = picksData.games.filter(
    (game) => getGamePickStatus(game, game.userPick) === GamePickStatuses.WIN,
  ).length;
  const gamesComplete = picksData.games.filter(
    (game) => game.status === SportLeagueGameStatuses.FINAL,
  ).length;
  const gamesYetToPlay = picksData.games.filter(
    (game) => game.period === 0,
  ).length;
  const gamesInProgress = picksData.games.filter(
    (game) => game.status !== SportLeagueGameStatuses.FINAL && game.period > 0,
  ).length;

  // todo need the ability to toggle between current and previous weeks at some point

  return (
    <Card className="mx-auto w-full max-w-4xl">
      <CardHeader>
        <CardTitle>{picksData.name} Picks</CardTitle>

        {picksMade && <span>View your picks for this week.</span>}

        {!picksMade && (
          <div className="flex flex-col gap-2">
            <span>Make your picks for this week&#39;s games.</span>

            <ul className={"list-inside list-disc space-y-1 text-sm"}>
              <li>You can make picks for games that have not started yet.</li>
              <li>
                You can only make picks for games that have not started yet.
              </li>
              <li>You must pick all games at once.</li>
              <li>You cannot change your picks once they are made.</li>
              <li>Good luck!</li>
            </ul>
          </div>
        )}
      </CardHeader>

      {!picksMade && picksData.games.length === 0 && (
        <CardContent>
          <span>There are no more picks that can be made this week.</span>
        </CardContent>
      )}

      {!picksMade && picksData.games.length > 0 && (
        <PicksLeagueMyPicksForm
          picksLeagueId={picksLeagueId}
          requiredAmountOfPicks={requiredAmountOfPicks}
          games={picksData.games}
          pickType={pickType}
        />
      )}

      {picksMade && (
        <PicksList
          games={picksData.games.map((game) => ({
            ...game,
            userPick: game.userPick!,
          }))}
          correctPickCount={correctPickCount}
          gamesComplete={gamesComplete}
          gamesInProgress={gamesInProgress}
          gamesYetToPlay={gamesYetToPlay}
          pickType={pickType}
        />
      )}
    </Card>
  );
}

interface PicksListProps {
  games: DBWeeklyPickDataByUserGame[];
  correctPickCount: number;
  gamesComplete: number;
  gamesInProgress: number;
  gamesYetToPlay: number;
  pickType: PicksLeaguePickTypes;
}

function PicksList({
  games,
  correctPickCount,
  gamesComplete,
  gamesInProgress,
  gamesYetToPlay,
  pickType,
}: PicksListProps) {
  return (
    <CardContent className={"space-y-4"}>
      <ul className="list-inside list-disc">
        <li>
          {correctPickCount}/{gamesComplete} Picks Correct
        </li>
        <li>{gamesInProgress} In Progress</li>
        <li>{gamesYetToPlay} Yet to Play</li>
      </ul>

      {games.map((game) => (
        <PicksLeagueGameBox key={game.id} game={game} pickType={pickType} />
      ))}
    </CardContent>
  );
}
