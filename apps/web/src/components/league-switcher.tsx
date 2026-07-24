import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useMyLeagues } from "@/api/leagues";
import { leagueModeLabel } from "@/lib/league";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Desktop nav companion to the Home/Discover links — surfaces the current
// league (when on one) and every league the signed-in user belongs to, one
// tap away. Shares its data (and cache entry) with the dashboard's league
// list via useMyLeagues.
export function LeagueSwitcher() {
  // strict: false merges params across whatever route is matched, so
  // leagueId comes back populated only on /leagues/$leagueId and its
  // children — this is the one config-free way to detect "on a league page"
  // without duplicating the route path here.
  const { leagueId } = useParams({ strict: false });
  // Pathname-prefix check (rather than keying off leagueId, which is absent on
  // /leagues/new) so the trigger stays highlighted across the whole /leagues
  // subtree: the list, a specific league, and the create-league page.
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const myLeagues = useMyLeagues();

  const isLoading = myLeagues.isPending || myLeagues.isError;
  const leagues = myLeagues.data?.leagues ?? [];
  const currentLeague = leagueId ? leagues.find((league) => league.id === leagueId) : undefined;
  const isOnLeaguesSubtree = pathname.startsWith("/leagues");

  return (
    <DropdownMenu>
      {/* This is a menu trigger, not a location Link, so it doesn't carry
          aria-current — the visual highlight is enough, and the menu items
          below already expose aria-current="page" for the selected league. */}
      <DropdownMenuTrigger
        disabled={isLoading}
        aria-label="Switch league"
        className={cn(
          "flex items-center gap-1 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-expanded:text-foreground",
          isOnLeaguesSubtree && "font-medium text-foreground",
        )}
      >
        <span className="max-w-[10rem] truncate">
          {currentLeague ? currentLeague.name : "Leagues"}
        </span>
        <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56 max-w-72">
        {leagues.length === 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => navigate({ to: "/leagues/new" })}>
              Create league
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate({ to: "/discovery" })}>
              Browse public leagues
            </DropdownMenuItem>
          </DropdownMenuGroup>
        ) : (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Your leagues</DropdownMenuLabel>
              {leagues.map((league) => {
                const isCurrent = league.id === leagueId;
                return (
                  <DropdownMenuItem
                    key={league.id}
                    aria-current={isCurrent ? "page" : undefined}
                    className={cn(isCurrent && "bg-accent text-accent-foreground")}
                    onClick={() =>
                      navigate({ to: "/leagues/$leagueId", params: { leagueId: league.id } })
                    }
                  >
                    {isCurrent ? (
                      <CheckIcon aria-hidden="true" className="shrink-0" />
                    ) : (
                      <span aria-hidden="true" className="size-4 shrink-0" />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{league.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {leagueModeLabel(league.mode)}
                      </span>
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate({ to: "/leagues/new" })}>
              Create league
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
