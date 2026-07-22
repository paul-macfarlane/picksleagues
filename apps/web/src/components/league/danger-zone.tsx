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

export function DangerZoneSection({
  league,
  isCommissioner,
}: {
  league: LeagueResponse;
  isCommissioner: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const leagueId = league.id;

  const leaveLeague = useMutation({
    mutationFn: async () => {
      const { error, response } = await api.DELETE("/api/leagues/{leagueId}/members/me", {
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
    onSuccess: async (left) => {
      if (!left) {
        await queryClient.invalidateQueries({ queryKey: leagueQueryKey(leagueId) });
        return;
      }
      toast.success("Left the league");
      await queryClient.invalidateQueries({ queryKey: ["my-leagues"] });
      navigate({ to: "/" });
    },
    onError: () => toast.error("Couldn't leave this league — please try again."),
  });

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
      await queryClient.invalidateQueries({ queryKey: ["my-leagues"] });
      navigate({ to: "/" });
    },
    onError: () => toast.error("Couldn't delete this league — please try again."),
  });

  return (
    <Card className="ring-destructive/30">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <AlertDialog>
          <AlertDialogTrigger
            render={<Button variant="destructive" className="w-full justify-center" />}
          >
            Leave league
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Leave {league.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                You&apos;ll lose access to this league&apos;s picks and standings.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={leaveLeague.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={leaveLeague.isPending}
                onClick={() => leaveLeague.mutate()}
              >
                {leaveLeague.isPending ? "Leaving…" : "Leave league"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {isCommissioner && (
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
                  {deleteLeague.isPending ? "Deleting…" : "Delete league"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </CardContent>
    </Card>
  );
}
