import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { NflStatContextBrowser } from "@/components/admin/nfl-stat-context-browser";
import { NflStatsBrowser } from "@/components/admin/nfl-stats-browser";

const searchSchema = z.object({
  // The season-stats browser's year — a plain year, not a season row id,
  // because stats rows key on bare `season_year` (ADR-0040).
  season: z.coerce.number().int().optional(),
  // The context browser's selection, the games browser's exact contract:
  // a week identifies its own season; `seasonId` covers "season, no week yet".
  seasonId: z.uuid().optional(),
  weekId: z.uuid().optional(),
});

type StatsSearch = z.infer<typeof searchSchema>;

export const Route = createFileRoute("/_authed/admin/stats")({
  validateSearch: searchSchema,
  component: AdminStats,
});

function AdminStats() {
  const { season, seasonId, weekId } = Route.useSearch();
  const navigate = Route.useNavigate();

  // Functional updates that keep the *other* browser's selection: two
  // independent browsers share this URL, so replacing the search wholesale
  // (the games route's idiom) would reset the sibling on every change.
  return (
    <div className="flex flex-col gap-4">
      <NflStatsBrowser
        season={season}
        onSeasonChange={(next) =>
          navigate({ search: (prev: StatsSearch) => ({ ...prev, season: next }), replace: true })
        }
      />
      <NflStatContextBrowser
        seasonId={seasonId}
        weekId={weekId}
        onSeasonChange={(next) =>
          // Drops the week: carrying one over from a different season would
          // select a week this season doesn't have.
          navigate({
            search: (prev: StatsSearch) => ({ ...prev, seasonId: next, weekId: undefined }),
            replace: true,
          })
        }
        onWeekChange={(next) =>
          navigate({ search: (prev: StatsSearch) => ({ ...prev, weekId: next }), replace: true })
        }
      />
    </div>
  );
}
