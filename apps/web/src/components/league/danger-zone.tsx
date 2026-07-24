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
// can perform LEAGUE_ACTION.DELETE_LEAGUE, so there's no internal role check
// left to make (Leave league lives on the Members tab now, visible to every
// member — see members-section.tsx).
export function DangerZoneSection({ league }: { league: LeagueResponse }) {
  const deleteLeague = useDeleteLeague(league.id);

  return (
    <Card className="ring-destructive/30">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
      </CardHeader>
      <CardContent>
        <AlertDialog>
          <AlertDialogTrigger
            render={<Button variant="destructive" className="w-full justify-center" />}
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
