import { PickemStandingsTable } from "@/components/league/pickem-standings-table";
import { Section } from "@/components/section";

/**
 * Pick'em's standings on League home: the season-cumulative board, and only it
 * (ADR-0035 amended spec §Screens' weekly/season toggle away). Weekly boards
 * still exist — League Picks has its own week selector and shows a week in more
 * detail than this page could, so a second scope control here was a second way
 * to ask the same question on the page least suited to answering it.
 */
export function PickemStandingsSection({ leagueId }: { leagueId: string }) {
  return (
    // Addressed by testid rather than by a section whose title happens to read
    // "Standings".
    <Section
      data-testid="standings-card"
      title="Standings"
      description="Cumulative points across the season."
    >
      <PickemStandingsTable leagueId={leagueId} />
    </Section>
  );
}
