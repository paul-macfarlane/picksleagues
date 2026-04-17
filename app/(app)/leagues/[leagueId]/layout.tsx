import Image from "next/image";
import { notFound } from "next/navigation";

import { LeagueTabs } from "@/components/leagues/league-tabs";
import { getLeagueById } from "@/data/leagues";
import { getSession } from "@/lib/auth";
import { assertLeagueMember } from "@/lib/permissions";

export default async function LeagueLayout({
  children,
  params,
}: LayoutProps<"/leagues/[leagueId]">) {
  const { leagueId } = await params;
  const session = await getSession();
  const league = await getLeagueById(leagueId);
  if (!league) {
    notFound();
  }
  await assertLeagueMember(session.user.id, leagueId);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4">
      <header className="flex items-center gap-3">
        <div className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-muted">
          {league.imageUrl ? (
            <Image
              src={league.imageUrl}
              alt=""
              fill
              sizes="40px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-base font-semibold text-muted-foreground">
              {league.name.slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
        <h1 className="truncate text-2xl font-bold tracking-tight">
          {league.name}
        </h1>
      </header>
      <LeagueTabs leagueId={leagueId} />
      {children}
    </div>
  );
}
