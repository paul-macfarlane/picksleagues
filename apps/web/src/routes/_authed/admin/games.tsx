import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { GamesBrowser } from "@/components/admin/games-browser";

const searchSchema = z.object({
  // Selection lives in the URL so a specific slate is shareable while debugging
  // a sync, and so the seasons browser can link straight to the week whose game
  // count looks wrong. A week identifies its own season, so a link needs only
  // `weekId`; `seasonId` alone covers "season chosen, no week yet".
  seasonId: z.uuid().optional(),
  weekId: z.uuid().optional(),
});

export const Route = createFileRoute("/_authed/admin/games")({
  validateSearch: searchSchema,
  component: AdminGames,
});

function AdminGames() {
  const { seasonId, weekId } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <GamesBrowser
      seasonId={seasonId}
      weekId={weekId}
      // `replace` on both: browsing weeks is refining one view, not a trail of
      // destinations to back-button through.
      onSeasonChange={(next) => navigate({ search: { seasonId: next }, replace: true })}
      onWeekChange={(next) => navigate({ search: { weekId: next }, replace: true })}
    />
  );
}
