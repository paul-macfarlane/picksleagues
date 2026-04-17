import Image from "next/image";
import Link from "next/link";
import { UsersIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { LeagueWithMemberCount } from "@/data/leagues";
import {
  PICK_TYPE_LABELS,
  SEASON_FORMAT_LABELS,
} from "@/lib/validators/leagues";

export function LeagueCard({ league }: { league: LeagueWithMemberCount }) {
  return (
    <Link
      href={`/leagues/${league.id}`}
      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
    >
      <Card className="h-full transition-colors hover:border-primary/50">
        <CardContent className="flex items-center gap-4 p-4">
          <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-muted">
            {league.imageUrl ? (
              <Image
                src={league.imageUrl}
                alt=""
                fill
                sizes="56px"
                className="object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-muted-foreground">
                {league.name.slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>
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
              {SEASON_FORMAT_LABELS[league.seasonFormat]}
            </p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
