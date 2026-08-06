import type { LeagueResponse } from "@picksleagues/schemas";
import { useDeleteLeague } from "@/api/leagues";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Commissioner-only — the route only renders this component when the viewer
// is a commissioner (role axis), so there's no internal role check left to
// make (Leave league lives on the Members tab now, visible to every member —
// see members-section.tsx). Rendering survives the window closing (Decision
// 4): only the Delete trigger disables, with an inline reason, so the
// commissioner can see they once had the power rather than the section
// silently disappearing.
export function DangerZoneSection({
  league,
  started,
}: {
  league: LeagueResponse;
  started: boolean;
}) {
  const deleteLeague = useDeleteLeague(league.id);

  return (
    <Card className="ring-destructive/30">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {started && (
          <p id="delete-league-reason" className="text-sm text-muted-foreground">
            Deleting is locked once the league starts.
          </p>
        )}
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                variant="destructive"
                className="w-full justify-center"
                disabled={started || deleteLeague.isPending}
                aria-describedby={started ? "delete-league-reason" : undefined}
              />
            }
          >
            Delete league
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {league.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes the league, its settings, members, and invites. This
                can&apos;t be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteLeague.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={deleteLeague.isPending}
                onClick={() => deleteLeague.mutate()}
              >
                Delete league
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
