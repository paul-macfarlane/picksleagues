import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  CompassIcon,
  EllipsisIcon,
  ShieldIcon,
  TimerIcon,
  TrophyIcon,
  UserIcon,
} from "lucide-react";
import { useMe } from "@/api/me";
import { isLeaguesSubtree } from "@/lib/league";
import { cn } from "@/lib/utils";
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
 * Phone-width primary navigation (MOB-2): a `fixed` bottom bar with Leagues /
 * Browse / Profile (+ More for admins), replacing the hamburger drawer — the
 * installed app reads as an app only once its navigation sits where the thumb
 * already is. Hidden from `sm` up, where the header's inline nav takes over;
 * the two never show together.
 *
 * Leagues is the hub at `/` and a league page is one tap deeper — the tab
 * model fantasy apps already taught members. An earlier cut had a Home tab
 * plus a League tab that navigated on the first tap and opened a switcher on
 * the second; nothing on screen signalled the second gesture, and re-tapping
 * the active tab conventionally means "back to the top", so the switch was
 * undiscoverable (owner, 2026-08-22).
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
 * Render only with a live session: `useMe` assumes one.
 */
export function AppTabBar() {
  const me = useMe();
  const { pathname } = useLocation();
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
      <LeaguesTab active={isLeaguesSubtree(pathname)} />
      <Link
        to="/discovery"
        className={tabClassName}
        inactiveProps={tabInactiveProps}
        activeProps={tabActiveProps}
      >
        <CompassIcon aria-hidden="true" />
        Browse
      </Link>
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

// Manual rather than `activeProps`: the link targets `/`, but the tab
// represents the whole leagues subtree too.
function LeaguesTab({ active }: { active: boolean }) {
  return (
    <Link
      to="/"
      className={cn(tabClassName, active ? tabActiveClassName : tabInactiveClassName)}
      aria-current={active ? "page" : undefined}
    >
      <TrophyIcon aria-hidden="true" />
      Leagues
    </Link>
  );
}

// Operator surfaces stay reachable for admins without costing members a tab
// (owner, 2026-08-22: an overflow tab rather than keeping the drawer).
function MoreTab({ simEnabled }: { simEnabled: boolean }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // /guide counts as Admin: it's reached from the Admin heading, not this menu.
  const active =
    pathname.startsWith("/admin") || pathname.startsWith("/sim") || pathname.startsWith("/guide");

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
