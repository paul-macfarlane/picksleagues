import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { LeagueResponse } from "@picksleagues/schemas";
import { api } from "@/lib/api";
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
import { leagueQueryKey } from "@/components/league/query-key";
import { MY_LEAGUES_QUERY_KEY } from "@/lib/my-leagues";

// Commissioner-only — the route only renders this component when the viewer
// can perform LEAGUE_ACTION.DELETE_LEAGUE, so there's no internal role check
// left to make (Leave league lives on the Members tab now, visible to every
// member — see members-section.tsx).
export function DangerZoneSection({ league }: { league: LeagueResponse }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const leagueId = league.id;

  const deleteLeague = useMutation({
    mutationFn: async () => {
      const { error, response } = await api.DELETE("/api/leagues/{leagueId}", {
        params: { path: { leagueId } },
      });
      if (error) {
        if (response.status === 409) {
          toast.error(error.message);
          return false;
        }
        throw error;
      }
      return true;
    },
    onSuccess: async (deleted) => {
      if (!deleted) {
        await queryClient.invalidateQueries({ queryKey: leagueQueryKey(leagueId) });
        return;
      }
      toast.success("League deleted");
      await queryClient.invalidateQueries({ queryKey: MY_LEAGUES_QUERY_KEY });
      navigate({ to: "/" });
    },
    onError: () => toast.error("Couldn't delete this league — please try again."),
  });

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
