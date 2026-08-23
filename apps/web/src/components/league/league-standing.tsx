import type { LeagueResponse, LeagueSummary } from "@picksleagues/schemas";
import { LEAGUE_MODE, SURVIVOR_MEMBER_STATUS } from "@picksleagues/schemas";
import { leagueHasStarted } from "@/lib/league";
import { sharedRankLabel } from "@/lib/standings";
import { Figures, type Figure } from "@/components/figures";

/**
 * The viewer's place in a league as display numerals (ADR-0043 §1): the eyebrow
 * names the figure and the numeral sits directly under it. One component for
 * the league band and the hub card so the two never disagree about what the
 * viewer's standing is called or how a tie reads.
 *
 * What the slot holds is the mode's own answer — rank and record for Pick'em,
 * alive-or-out and who is left for Survivor (no rank, ADR-0016) — and before
 * the league has kicked off it holds the roster size instead: a "T-1 · 0-0-0"
 * on a league nobody has picked in yet reads as a standing that isn't one.
 * `now` comes from `useAppNow()`, the same clock every pre-start label reads.
 */
export function LeagueStanding({
  league,
  now,
  className,
  numeralClassName = "text-3xl",
}: {
  league: Pick<LeagueResponse | LeagueSummary, "mode" | "startsAt"> & {
    memberCount: number;
    myPickemStanding: LeagueResponse["myPickemStanding"];
    mySurvivorStanding: LeagueResponse["mySurvivorStanding"];
  };
  now: Date;
  className?: string;
  numeralClassName?: string;
}) {
  return (
    <Figures
      figures={standingFigures(league, now)}
      numeralClassName={numeralClassName}
      className={className}
      data-testid="league-standing"
    />
  );
}

function standingFigures(
  league: Parameters<typeof LeagueStanding>[0]["league"],
  now: Date,
): Figure[] {
  const roster: Figure = {
    label: "Members",
    value: `${league.memberCount}`,
    testId: "league-standing-members",
  };
  if (!leagueHasStarted(league, now)) return [roster];

  if (league.mode === LEAGUE_MODE.PICKEM && league.myPickemStanding) {
    const mine = league.myPickemStanding;
    return [
      {
        label: `Rank of ${league.memberCount}`,
        value: sharedRankLabel(mine.rank, mine.rankShared),
        testId: "league-standing-rank",
      },
      {
        label: "Record",
        value: `${mine.wins}-${mine.losses}-${mine.pushes}`,
        testId: "league-standing-record",
      },
    ];
  }

  if (league.mode === LEAGUE_MODE.SURVIVOR && league.mySurvivorStanding) {
    const mine = league.mySurvivorStanding;
    // "Out" rather than "Eliminated" for the same reason the board says it: a
    // band-sized numeral has room for one short word, and the long one is the
    // verdict the board beneath spells out.
    const status = mine.isWinner
      ? mine.aliveCount > 1
        ? "Co-winner"
        : "Winner"
      : mine.status === SURVIVOR_MEMBER_STATUS.ALIVE
        ? "Alive"
        : "Out";
    return [
      { label: "Status", value: status, testId: "league-standing-status" },
      {
        label: "Still in",
        value: `${mine.aliveCount} of ${league.memberCount}`,
        testId: "league-standing-alive",
      },
    ];
  }

  // March Madness, until epic 07 gives it a standing.
  return [roster];
}
