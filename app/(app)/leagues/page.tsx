import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";

import { OpenInvites } from "@/components/invites/open-invites";
import { LeagueCard } from "@/components/leagues/league-card";
import { Button } from "@/components/ui/button";
import { getPendingDirectInvitesForUser } from "@/data/invites";
import { getLeaguesForUser } from "@/data/leagues";
import { getSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Leagues",
};

export default async function LeaguesPage() {
  const session = await getSession();
  const [leagues, openInvites] = await Promise.all([
    getLeaguesForUser(session.user.id),
    getPendingDirectInvitesForUser(session.user.id, new Date()),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Welcome{session.user.name ? `, ${session.user.name}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground">
            Your leagues and pending invites, in one place.
          </p>
        </div>
        <Button asChild>
          <Link href="/leagues/create">
            <PlusIcon className="size-4" />
            New league
          </Link>
        </Button>
      </header>

      <OpenInvites invites={openInvites} />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">My leagues</h2>
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
      </section>
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
