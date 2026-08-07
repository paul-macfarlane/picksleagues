import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { useLeague } from "@/api/leagues";
import { pickemSettingsOf, survivorSettingsOf } from "@/lib/league-settings";
import { PickemPicks } from "@/components/league/pickem-picks";
import { SurvivorPicks } from "@/components/league/survivor-picks";
import { LeagueWeekPicker } from "@/components/league/league-week-picker";

const searchSchema = z.object({
  // Selection lives in the URL so a chosen week survives a refresh and is
  // linkable (same rationale as admin/games.tsx) — the week *list* and its
  // default still come from the server (GET .../weeks), never derived here.
  //
  // Independent of the League Picks tab's own `weekId` and of Overview's
  // `week`: each surface owns the week it is scoped to, so switching tabs
  // always lands on the current week rather than carrying a week the member
  // was inspecting somewhere else.
  weekId: z.string().optional(),
});

export const Route = createFileRoute("/_authed/leagues/$leagueId/my-picks")({
  validateSearch: searchSchema,
  component: MyPicks,
});

function MyPicks() {
  const { leagueId } = Route.useParams();
  const { weekId } = Route.useSearch();
  const navigate = Route.useNavigate();
  // Populated by the parent layout route — reads the same cache entry
  // (leagueQueryKey) instead of refetching.
  const league = useLeague(leagueId);

  if (!league.data) return null;
  // Direct navigation guard — the tab renders only for the modes with a pick
  // screen (route.tsx), but this route is still reachable by URL. Parsed rather
  // than cast (see pickemSettingsOf); both being null also covers a settings
  // blob that doesn't parse, which this screen could render nothing sane from.
  const pickem = pickemSettingsOf(league.data);
  const survivor = survivorSettingsOf(league.data);
  if (!pickem && !survivor) return null;

  return (
    <LeagueWeekPicker
      leagueId={leagueId}
      // Named for the page, not the mode: the id exists so the label
      // association is unique on screen, and both modes render one picker here.
      selectId="my-picks-week-select"
      weekId={weekId}
      onSelectWeek={(next) => navigate({ search: { weekId: next }, replace: true })}
    >
      {(effectiveWeekId) =>
        pickem ? (
          <PickemPicks leagueId={leagueId} weekId={effectiveWeekId} pickType={pickem.pickType} />
        ) : (
          survivor && (
            <SurvivorPicks
              leagueId={leagueId}
              weekId={effectiveWeekId}
              pickType={survivor.pickType}
            />
          )
        )
      }
    </LeagueWeekPicker>
  );
}
