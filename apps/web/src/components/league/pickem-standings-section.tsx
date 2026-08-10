import { PickemStandingsTable } from "@/components/league/pickem-standings-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Pick'em's standings on League home: the season-cumulative board, and only it
 * (ADR-0035 amended spec §Screens' weekly/season toggle away). Weekly boards
 * still exist — League Picks has its own week selector and shows a week in more
 * detail than this page could, so a second scope control here was a second way
 * to ask the same question on the page least suited to answering it.
 */
export function PickemStandingsSection({ leagueId }: { leagueId: string }) {
  return (
    // Addressed by testid rather than by a card whose title happens to read
    // "Standings".
    <Card data-testid="standings-card">
      <CardHeader>
        <CardTitle>Standings</CardTitle>
        <CardDescription>Cumulative points across the season.</CardDescription>
      </CardHeader>
      <CardContent>
        <PickemStandingsTable leagueId={leagueId} />
      </CardContent>
    </Card>
  );
}
