import Link from "next/link";
import { PlusIcon } from "lucide-react";

import { LeagueCard } from "@/components/leagues/league-card";
import { Button } from "@/components/ui/button";
import { getLeaguesForUser } from "@/data/leagues";
import { getSession } from "@/lib/auth";

const HOME_LEAGUE_PREVIEW_LIMIT = 3;

export default async function HomePage() {
  const session = await getSession();
  const leagues = await getLeaguesForUser(session.user.id);
  const previewLeagues = leagues.slice(0, HOME_LEAGUE_PREVIEW_LIMIT);
  const hasMoreLeagues = leagues.length > HOME_LEAGUE_PREVIEW_LIMIT;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome{session.user.name ? `, ${session.user.name}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">
          Pick up where you left off or jump into a league.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">My leagues</h2>
          {hasMoreLeagues ? (
            <Link
              href="/leagues"
              className="text-sm font-medium text-primary hover:underline"
            >
              View all
            </Link>
          ) : null}
        </div>

        {previewLeagues.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">
              You haven&apos;t joined a league yet.
            </p>
            <Button asChild>
              <Link href="/leagues/create">
                <PlusIcon className="size-4" />
                Create a league
              </Link>
            </Button>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {previewLeagues.map((league) => (
              <li key={league.id}>
                <LeagueCard league={league} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
