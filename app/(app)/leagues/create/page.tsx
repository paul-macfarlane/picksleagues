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

type CreateLeagueData =
  | {
      kind: "ready";
      selectablePhases: Phase[];
      defaultStart: Phase;
      defaultEnd: Phase;
    }
  | { kind: "no-nfl" }
  | { kind: "no-startable-weeks" };

async function loadCreateLeagueData(): Promise<CreateLeagueData> {
  try {
    const sportsLeague = await getSportsLeagueByAbbreviation("NFL");
    const now = await getAppNow();
    const seasons = await getSeasonsBySportsLeague(sportsLeague.id);
    const currentSeason = selectCurrentSeason(seasons, now);
    if (!currentSeason) return { kind: "no-nfl" };
    const phases = await getPhasesBySeason(currentSeason.id);
    if (phases.length === 0) return { kind: "no-nfl" };
    const ordered = [...phases].sort(comparePhasesByOrdinal);
    const selectablePhases = ordered.filter(
      (p) => p.pickLockTime.getTime() > now.getTime(),
    );
    if (selectablePhases.length === 0) return { kind: "no-startable-weeks" };
    const defaultStart = selectablePhases[0];
    // Prefer the last regular-season week (the common "Week 1 → Week 18"
    // default) but only if it's still selectable; otherwise fall back to
    // the last selectable phase of any type.
    const lastSelectableRegular = [...selectablePhases]
      .reverse()
      .find((p) => p.seasonType === "regular");
    const defaultEnd =
      lastSelectableRegular ?? selectablePhases[selectablePhases.length - 1];
    return {
      kind: "ready",
      selectablePhases,
      defaultStart,
      defaultEnd,
    };
  } catch (err) {
    if (err instanceof NotFoundError) return { kind: "no-nfl" };
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
      {data.kind === "ready" ? (
        <CreateLeagueForm
          selectablePhases={data.selectablePhases}
          defaultStartPhase={data.defaultStart}
          defaultEndPhase={data.defaultEnd}
        />
      ) : data.kind === "no-startable-weeks" ? (
        <p className="rounded-md border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
          Every week this season has already started. New leagues can be created
          once the next season is synced.
        </p>
      ) : (
        <p className="rounded-md border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
          NFL isn&apos;t set up yet. Leagues can be created once the NFL setup
          has run.
        </p>
      )}
    </div>
  );
}
