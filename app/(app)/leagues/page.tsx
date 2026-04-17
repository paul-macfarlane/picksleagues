import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";

import { LeagueCard } from "@/components/leagues/league-card";
import { Button } from "@/components/ui/button";
import { getLeaguesForUser } from "@/data/leagues";
import { getSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Leagues",
};

export default async function LeaguesPage() {
  const session = await getSession();
  const leagues = await getLeaguesForUser(session.user.id);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your leagues</h1>
          <p className="text-sm text-muted-foreground">
            Leagues you&apos;ve joined or created.
          </p>
        </div>
        <Button asChild>
          <Link href="/leagues/create">
            <PlusIcon className="size-4" />
            New league
          </Link>
        </Button>
      </header>

      {leagues.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {leagues.map((league) => (
            <li key={league.id}>
              <LeagueCard league={league} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed p-10 text-center">
      <p className="text-sm text-muted-foreground">
        You haven&apos;t joined a league yet.
      </p>
      <Button asChild>
        <Link href="/leagues/create">Create your first league</Link>
      </Button>
    </div>
  );
}
