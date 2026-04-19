import Link from "next/link";
import { ChevronRightIcon, UsersIcon } from "lucide-react";

import { LeagueAvatar } from "@/components/leagues/league-avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { LeagueWithMemberCount } from "@/data/leagues";
import { formatLeagueRange } from "@/lib/nfl/leagues";
import { PICK_TYPE_LABELS } from "@/lib/validators/leagues";

export function LeagueCard({ league }: { league: LeagueWithMemberCount }) {
  return (
    <Link
      href={`/leagues/${league.id}`}
      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
    >
      <Card className="h-full transition-colors hover:border-primary/50 active:bg-muted/60">
        <CardContent className="flex items-center gap-4 p-4">
          <LeagueAvatar
            name={league.name}
            imageUrl={league.imageUrl}
            size="lg"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h3 className="truncate text-base font-semibold">{league.name}</h3>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary" className="font-normal">
                {PICK_TYPE_LABELS[league.pickType]}
              </Badge>
              <span>{league.picksPerPhase} picks / week</span>
              <span className="flex items-center gap-1">
                <UsersIcon className="size-3" aria-hidden />
                {league.memberCount}/{league.size}
              </span>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {formatLeagueRange(league)}
            </p>
          </div>
          <ChevronRightIcon
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </CardContent>
      </Card>
    </Link>
  );
}
