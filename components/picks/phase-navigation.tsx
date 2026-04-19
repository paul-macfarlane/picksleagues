import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Phase } from "@/lib/db/schema/sports";
import { phaseLabel } from "@/lib/nfl/leagues";
import { cn } from "@/lib/utils";

export function PhaseNavigation({
  basePath,
  currentPhase,
  prevPhase,
  nextPhase,
}: {
  basePath: string;
  currentPhase: Phase;
  prevPhase: Phase | null;
  nextPhase: Phase | null;
}) {
  return (
    <nav
      aria-label="Phase navigation"
      className="flex items-center justify-between gap-2"
    >
      <Button
        asChild={!!prevPhase}
        variant="ghost"
        size="sm"
        disabled={!prevPhase}
        className={cn("gap-1", !prevPhase && "pointer-events-none opacity-40")}
      >
        {prevPhase ? (
          <Link href={`${basePath}?phase=${prevPhase.id}`}>
            <ChevronLeft className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only">
              {phaseLabel(prevPhase.seasonType, prevPhase.weekNumber)}
            </span>
          </Link>
        ) : (
          <span>
            <ChevronLeft className="h-4 w-4" />
          </span>
        )}
      </Button>
      <div className="text-center text-sm font-semibold">
        {phaseLabel(currentPhase.seasonType, currentPhase.weekNumber)}
      </div>
      <Button
        asChild={!!nextPhase}
        variant="ghost"
        size="sm"
        disabled={!nextPhase}
        className={cn("gap-1", !nextPhase && "pointer-events-none opacity-40")}
      >
        {nextPhase ? (
          <Link href={`${basePath}?phase=${nextPhase.id}`}>
            <span className="sr-only sm:not-sr-only">
              {phaseLabel(nextPhase.seasonType, nextPhase.weekNumber)}
            </span>
            <ChevronRight className="h-4 w-4" />
          </Link>
        ) : (
          <span>
            <ChevronRight className="h-4 w-4" />
          </span>
        )}
      </Button>
    </nav>
  );
}
