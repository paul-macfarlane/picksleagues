import type { Metadata } from "next";

import { CreateLeagueForm } from "@/components/leagues/create-league-form";
import { getPhasesBySeason } from "@/data/phases";
import { getSeasonsBySportsLeague } from "@/data/seasons";
import { getSportsLeagueByAbbreviation } from "@/data/sports";
import type { Phase } from "@/lib/db/schema/sports";
import { NotFoundError } from "@/lib/errors";
import { comparePhasesByOrdinal, selectCurrentSeason } from "@/lib/nfl/leagues";
import { getAppNow } from "@/lib/simulator";

export const metadata: Metadata = {
  title: "Create league",
};

type CreateLeagueData = {
  phases: Phase[];
  defaultStart: Phase;
  defaultEnd: Phase;
} | null;

async function loadCreateLeagueData(): Promise<CreateLeagueData> {
  try {
    const sportsLeague = await getSportsLeagueByAbbreviation("NFL");
    const now = await getAppNow();
    const seasons = await getSeasonsBySportsLeague(sportsLeague.id);
    const currentSeason = selectCurrentSeason(seasons, now);
    if (!currentSeason) return null;
    const phases = await getPhasesBySeason(currentSeason.id);
    if (phases.length === 0) return null;
    const ordered = [...phases].sort(comparePhasesByOrdinal);
    const defaultStart =
      ordered.find((p) => p.pickLockTime.getTime() > now.getTime()) ??
      ordered[0];
    const lastRegular = [...ordered]
      .reverse()
      .find((p) => p.seasonType === "regular");
    const defaultEnd = lastRegular ?? ordered[ordered.length - 1];
    return { phases: ordered, defaultStart, defaultEnd };
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

export default async function CreateLeaguePage() {
  const data = await loadCreateLeagueData();

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Create a league</h1>
        <p className="text-sm text-muted-foreground">
          You&apos;ll become the first commissioner. You can invite members
          after.
        </p>
      </header>
      {data ? (
        <CreateLeagueForm
          phases={data.phases}
          defaultStartPhase={data.defaultStart}
          defaultEndPhase={data.defaultEnd}
        />
      ) : (
        <p className="rounded-md border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
          NFL isn&apos;t set up yet. Leagues can be created once the NFL setup
          has run.
        </p>
      )}
    </div>
  );
}
