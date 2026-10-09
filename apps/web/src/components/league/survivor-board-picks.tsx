import { RotateCcwIcon } from "lucide-react";
import type {
  PickOutcome,
  SlateTeam,
  SurvivorStandingsMember,
  SurvivorStandingsPick,
  SurvivorStandingsPickGame,
} from "@picksleagues/schemas";
import { useAppNow } from "@/lib/app-clock";
import { cn } from "@/lib/utils";
import { gameStateLabel } from "@/lib/game";
import { survivorPickGrade } from "@/lib/survivor-game";
import { PickOutcomeBadge, pickOutcomeAccentClassName } from "@/components/league/pick-outcome";
import { rowClassName, rowRuleClassName } from "@/components/row";
import { StatusPill } from "@/components/status-pill";
import { TeamLogo } from "@/components/team-logo";

/** `gameStateLabel`'s shape, built from the pick's game block + the shared team lookup. */
function gameStateInput(game: SurvivorStandingsPickGame, teams: ReadonlyMap<string, SlateTeam>) {
  return {
    status: game.status,
    kickoffAt: game.kickoffAt,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    period: game.period,
    clockSeconds: game.clockSeconds,
    homeTeam: { abbreviation: teams.get(game.homeTeamId)?.abbreviation ?? "—" },
    awayTeam: { abbreviation: teams.get(game.awayTeamId)?.abbreviation ?? "—" },
  };
}

// A revived loss is not the red of a loss that ended someone: the member is
// still in, and the score line beside it already says the pick lost. Grey, the
// push's rule — a verdict without a hue.
const REVIVED_ACCENT_CLASS_NAME = "border-l-border";

/** A pick's grade badge, or the Revived tag in its place when the revival saved it. */
function PickVerdict({ grade, revived }: { grade: PickOutcome | null; revived: boolean }) {
  if (revived) {
    return (
      <StatusPill data-testid="survivor-pick-revived">
        <RotateCcwIcon aria-hidden="true" className="size-3" />
        Revived
      </StatusPill>
    );
  }
  return grade ? <PickOutcomeBadge outcome={grade} /> : null;
}

/**
 * The member's current-week pick, live: team, game state, and the settled or
 * derived verdict. A pick that exists but is withheld renders as the fact that
 * it exists — the league sees they're in without seeing who they took (spec
 * §Pick Visibility; the server sent no team and no game for it). No pick at
 * all renders as exactly that: "nobody has picked yet" is one of the answers
 * the glance exists to give.
 */
export function CurrentWeekPick({
  pick,
  teams,
  revived,
}: {
  pick: SurvivorStandingsPick | null;
  teams: ReadonlyMap<string, SlateTeam>;
  revived: boolean;
}) {
  const now = useAppNow();
  const team = pick?.teamId ? teams.get(pick.teamId) : null;
  const grade = pick ? survivorPickGrade(pick) : null;

  return (
    <div
      data-testid="survivor-current-pick"
      // The same identity attributes the history entries carry, so a journey
      // can address "this member's pick for week N" without caring which of
      // the two homes (row level vs history) the board gave it.
      data-week={pick?.weekId}
      data-team={team?.abbreviation}
      // The row tier's left rule and outcome colour (ADR-0043 §2), the same
      // frame as every other pick row in the app (FB-42), so this week's pick
      // and the history entries below read as one list rather than two designs
      // — and no box, since this already sits inside the member's row.
      className={cn(
        "flex flex-col gap-1 py-2 text-sm",
        rowRuleClassName,
        revived ? REVIVED_ACCENT_CLASS_NAME : pickOutcomeAccentClassName(grade),
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          <span className="type-eyebrow">This week</span>
          {team && (
            <>
              <TeamLogo logoLightUrl={team.logoLightUrl} logoDarkUrl={team.logoDarkUrl} size="sm" />
              {team.abbreviation}
            </>
          )}
        </span>
        <PickVerdict grade={grade} revived={revived} />
      </div>
      <p className="text-xs text-muted-foreground">
        {team && pick?.game
          ? gameStateLabel(gameStateInput(pick.game, teams), now)
          : pick
            ? "In — hidden until kickoff"
            : "No pick in yet"}
      </p>
    </div>
  );
}

/**
 * The member's season, behind a native disclosure: eighteen weeks open by
 * default would bury the twelve rows around it, and `details`/`summary` is
 * keyboard-operable and announced without any of the state a custom one needs.
 */
export function PickHistory({
  member,
  teams,
  weekLabels,
  revivedWeekIds,
  excludeWeekId,
}: {
  member: SurvivorStandingsMember;
  teams: ReadonlyMap<string, SlateTeam>;
  weekLabels: ReadonlyMap<string, string>;
  revivedWeekIds: ReadonlySet<string>;
  /** The week the row-level section already shows, or null to list everything. */
  excludeWeekId: string | null;
}) {
  const now = useAppNow();
  const picks = member.picks.filter((pick) => pick.weekId !== excludeWeekId);
  if (picks.length === 0) return null;

  return (
    <details className="group">
      <summary className="type-eyebrow touch-hit cursor-pointer list-none outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        Pick history ({picks.length})
      </summary>
      <ul className="mt-2 flex flex-col">
        {picks.map((pick) => {
          const team = pick.teamId ? teams.get(pick.teamId) : null;
          // Settled or derived (FB-25), same as everywhere else on the board.
          const grade = survivorPickGrade(pick);
          const revived = revivedWeekIds.has(pick.weekId);
          return (
            <li
              key={pick.weekId}
              data-testid="survivor-history-entry"
              data-week={pick.weekId}
              data-team={team?.abbreviation}
              className={cn(
                "flex flex-col gap-1 text-sm",
                rowClassName,
                rowRuleClassName,
                revived ? REVIVED_ACCENT_CLASS_NAME : pickOutcomeAccentClassName(grade),
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <span className="type-eyebrow">{weekLabels.get(pick.weekId)}</span>
                  {team && (
                    <>
                      <TeamLogo
                        logoLightUrl={team.logoLightUrl}
                        logoDarkUrl={team.logoDarkUrl}
                        size="sm"
                      />
                      {team.abbreviation}
                    </>
                  )}
                </span>
                <PickVerdict grade={grade} revived={revived} />
              </div>
              {/* The score, which this row used to omit while the "This week"
                  block above it showed one — the same pick reading differently
                  depending on which of its two homes you found it in (FB-43).
                  A withheld pick still names nothing: its game would narrow it
                  to two teams (spec §Pick Visibility), which is why the server
                  sends no game block for one. */}
              <p className="text-xs text-muted-foreground">
                {team && pick.game
                  ? gameStateLabel(gameStateInput(pick.game, teams), now)
                  : "Hidden until kickoff"}
              </p>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
