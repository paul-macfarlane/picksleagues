import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import {
  CompassIcon,
  EllipsisIcon,
  HomeIcon,
  ShieldIcon,
  TimerIcon,
  TrophyIcon,
  UserIcon,
} from "lucide-react";
import { useMe } from "@/api/me";
import { useMyLeagues } from "@/api/leagues";
import { readRememberedLeague, rememberLeague, resolveCurrentLeague } from "@/lib/current-league";
import { cn } from "@/lib/utils";
import { LeagueMenuContent } from "@/components/league-switcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Clearing padding for a shell that renders `AppTabBar`, so the page's last
 * rows and the footer scroll out from under it. The bar's own inset padding is
 * inside its published height, so nothing here adds the safe area twice.
 */
export const appTabBarClearanceClassName = "pb-[var(--app-tab-bar-height,0px)]";

// One 44pt column per tab (`min-h-11`): the whole column is the target, so
// no `touch-hit` — the invisible expansion would overlap the neighbour.
const tabClassName =
  "flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[0.6875rem] leading-none outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-5";
const tabInactiveClassName = "text-muted-foreground";
// The brand colours the glyph only (LNCH-9's one accent marks position
// without recolouring the label, the same rule TabNav's underline follows).
const tabActiveClassName = "font-medium text-foreground [&_svg]:text-primary";
const tabInactiveProps = { className: tabInactiveClassName };
const tabActiveProps = { className: tabActiveClassName, "aria-current": "page" as const };

/**
 * Phone-width primary navigation (MOB-2): a `fixed` bottom bar with Home /
 * Browse / League / Profile (+ More for admins), replacing the hamburger
 * drawer — the installed app reads as an app only once its navigation sits
 * where the thumb already is. Hidden from `sm` up, where the header's inline
 * nav takes over; the two never show together.
 *
 * Layering: z-20, the page-level tier under `TabNav` (z-30) and the header
 * (z-40), sharing the tier with `PickSheetActionBar` — which stacks *above*
 * this bar by its published height rather than replacing it (owner,
 * 2026-08-22: navigation that vanishes when picks are dirty confuses more
 * than it frees). Publishes `--app-tab-bar-height` on the document element
 * the way the header publishes `--app-header-height`; at `sm` and up the bar
 * is `display: none`, so the observed height — and the offset every consumer
 * reads — is 0 without any consumer knowing the breakpoint.
 *
 * Render only with a live session: its queries (`useMe`, `useMyLeagues`)
 * assume one.
 */
export function AppTabBar() {
  const me = useMe();
  const barRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;

    const publishHeight = () => {
      document.documentElement.style.setProperty("--app-tab-bar-height", `${bar.offsetHeight}px`);
    };
    publishHeight();

    // ResizeObserver rather than a resize listener: crossing `sm` flips the
    // bar between display:none and its real height, and the observer reports
    // both edges of that without a media-query listener of its own.
    const observer = new ResizeObserver(publishHeight);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      // Published on the document element so it outlives this subtree; after
      // sign-out nothing renders a bar, and a stale height would leave every
      // consumer offset by a bar that isn't there.
      document.documentElement.style.removeProperty("--app-tab-bar-height");
    };
  }, []);

  return (
    <nav
      ref={barRef}
      aria-label="Primary"
      // `select-none`: a long-press on nav chrome in the installed app
      // otherwise opens the text-selection loupe (MOB-1).
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-background pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] select-none sm:hidden"
    >
      <Link
        to="/"
        className={tabClassName}
        inactiveProps={tabInactiveProps}
        activeProps={tabActiveProps}
        activeOptions={{ exact: true }}
      >
        <HomeIcon aria-hidden="true" />
        Home
      </Link>
      <Link
        to="/discovery"
        className={tabClassName}
        inactiveProps={tabInactiveProps}
        activeProps={tabActiveProps}
      >
        <CompassIcon aria-hidden="true" />
        Browse
      </Link>
      <LeagueTab />
      <Link
        to="/profile"
        className={tabClassName}
        inactiveProps={tabInactiveProps}
        activeProps={tabActiveProps}
      >
        <UserIcon aria-hidden="true" />
        Profile
      </Link>
      {me.data?.isAdmin && <MoreTab simEnabled={Boolean(me.data.simEnabled)} />}
    </nav>
  );
}

// A menu trigger dressed as a tab. `aria-current` is allowed on any element,
// and here it is honest: the tab *is* the current section, it just also opens
// a menu.
function MenuTab({
  label,
  icon,
  active,
  children,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-current={active ? "page" : undefined}
        className={cn(
          tabClassName,
          active ? tabActiveClassName : tabInactiveClassName,
          "aria-expanded:text-foreground",
        )}
      >
        {icon}
        {label}
      </DropdownMenuTrigger>
      {children}
    </DropdownMenu>
  );
}

// Navigate first, switch second: one tap from anywhere reaches the member's
// league, and a tap while already *on* a league page is the only gesture left
// that can mean "a different one", so that is when the switcher opens. With
// one league there is nothing to switch to and the tab is always a link.
function LeagueTab() {
  // strict: false, as LeagueSwitcher does — populated only on a league page.
  const { leagueId } = useParams({ strict: false });
  const { pathname } = useLocation();
  const myLeagues = useMyLeagues();
  const leagues = myLeagues.data?.leagues ?? [];

  useEffect(() => {
    if (leagueId) rememberLeague(leagueId);
  }, [leagueId]);

  // Read on render, not held in state: the stored id only ever changes in the
  // effect above, and only while `leagueId` — which wins here — is set.
  const currentLeague = resolveCurrentLeague(leagues, leagueId ?? readRememberedLeague());
  // Prefix check, not `leagueId`, so the tab stays lit on /leagues/new.
  const isOnLeaguesSubtree = pathname.startsWith("/leagues");
  const icon = <TrophyIcon aria-hidden="true" />;

  if (leagueId && leagues.length > 1) {
    return (
      <MenuTab label="League" icon={icon} active={isOnLeaguesSubtree}>
        <LeagueMenuContent leagues={leagues} currentLeagueId={leagueId} align="center" side="top" />
      </MenuTab>
    );
  }

  // Manual rather than `activeProps`: the link targets one league, but the
  // tab represents the whole /leagues subtree.
  const linkProps = {
    className: cn(tabClassName, isOnLeaguesSubtree ? tabActiveClassName : tabInactiveClassName),
    "aria-current": isOnLeaguesSubtree ? ("page" as const) : undefined,
  };
  const body = (
    <>
      {icon}
      League
    </>
  );

  return currentLeague ? (
    <Link to="/leagues/$leagueId" params={{ leagueId: currentLeague.id }} {...linkProps}>
      {body}
    </Link>
  ) : (
    <Link to="/leagues/new" {...linkProps}>
      {body}
    </Link>
  );
}

// Operator surfaces stay reachable for admins without costing members a tab
// (owner, 2026-08-22: an overflow tab rather than keeping the drawer).
function MoreTab({ simEnabled }: { simEnabled: boolean }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = pathname.startsWith("/admin") || pathname.startsWith("/sim");

  return (
    <MenuTab label="More" icon={<EllipsisIcon aria-hidden="true" />} active={active}>
      {/* Upward, like every menu anchored to this bar: below the trigger is
          off-screen. */}
      <DropdownMenuContent align="end" side="top" className="min-w-48">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => navigate({ to: "/admin" })}>
            <ShieldIcon />
            Admin
          </DropdownMenuItem>
          {simEnabled && (
            <DropdownMenuItem onClick={() => navigate({ to: "/sim" })}>
              <TimerIcon />
              Simulator
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </MenuTab>
  );
}
