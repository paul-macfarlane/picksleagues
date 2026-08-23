import { useLayoutEffect, useRef } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { authClient } from "@/lib/auth";
import { displayNameOf, handleOf, initialsOf } from "@/lib/user";
import { useSignOut } from "@/lib/sign-out";
import { useMe } from "@/api/me";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BrandMark } from "@/components/brand";
import { LeagueSwitcher } from "@/components/league-switcher";
import { SimClockBanner } from "@/components/sim-clock-banner";
import { UserIdentity } from "@/components/user-identity";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const navLinkClassName = "touch-hit outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
const navLinkInactiveProps = { className: "text-muted-foreground" };
const navLinkActiveProps = {
  className: "text-foreground font-medium",
  "aria-current": "page" as const,
};

/**
 * The signed-in shell's header, extracted from the `_authed` layout so the
 * public static pages (rules/terms/privacy) can wear the same chrome for a
 * signed-in member — navigation back into the app must not depend on which
 * route family a page lives in. Render only with a live session: its queries
 * (`useMe`) assume one. Pairs with `AppTabBar`, which carries the primary nav
 * below `sm` — this header's inline nav is the `sm`-and-up half.
 */
export function AppHeader() {
  const me = useMe();
  const headerRef = useRef<HTMLElement>(null);

  // TabNav (rendered by league/admin/sim route layouts) sticks flush beneath
  // this header, offset by its measured height — hardcoding an offset isn't
  // possible because SimClockBanner mounts/unmounts inside the header,
  // changing its height. ResizeObserver keeps the published height in sync
  // with that, and with resize/wrapping, without a layout-shift flash
  // (useLayoutEffect runs before paint).
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const publishHeight = () => {
      document.documentElement.style.setProperty("--app-header-height", `${header.offsetHeight}px`);
    };
    publishHeight();

    const observer = new ResizeObserver(publishHeight);
    observer.observe(header);
    return () => {
      observer.disconnect();
      // Published on the document element, so it outlives this subtree: after
      // sign-out the unauthed pages have no header, and a stale height would
      // push their toasts (Toaster reads the same property) down by one.
      document.documentElement.style.removeProperty("--app-header-height");
    };
  }, []);

  return (
    <>
      {/* Overlays (Sheet/AlertDialog/DropdownMenu/Select, see components/ui) all
          portal to document.body at z-50, so z-40 here keeps the header above
          page content while staying under every overlay regardless of DOM order.
          Layering below this: TabNav sticks at z-30, and the page-level fixed
          tier (AppTabBar, the picks screen's action bar) stays at z-20. */}
      <header
        ref={headerRef}
        // Safe-area padding (MOB-1): with viewport-fit=cover and a translucent
        // status bar the header starts under the notch, and it is this
        // background that tints the status bar. offsetHeight includes the
        // padding, so the published --app-header-height already accounts for
        // it. `select-none`: a long-press on nav chrome in the installed app
        // otherwise opens the text-selection loupe.
        className="sticky top-0 z-40 border-b border-border bg-background pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] select-none"
      >
        {/* Phones: the brand alone, centred, the way an iOS nav bar titles a
            screen — primary nav is the bottom AppTabBar and the account lives
            on its Profile tab, so the avatar menu would be a second way to
            the same page. From `sm` the full masthead returns. */}
        <div className="mx-auto flex w-full max-w-5xl items-center justify-center gap-2 px-4 py-3 sm:justify-between sm:px-6">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="touch-hit flex items-center gap-2 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <BrandMark className="size-6" />
              Picks Leagues
            </Link>
            {/* sm and up: full inline nav + league switcher. Below sm the
                bottom AppTabBar carries primary navigation instead. */}
            <nav aria-label="Primary" className="hidden items-center gap-3 text-sm sm:flex">
              <Link
                to="/"
                className={navLinkClassName}
                inactiveProps={navLinkInactiveProps}
                activeProps={navLinkActiveProps}
                activeOptions={{ exact: true }}
              >
                Home
              </Link>
              <Link
                to="/discovery"
                className={navLinkClassName}
                inactiveProps={navLinkInactiveProps}
                activeProps={navLinkActiveProps}
              >
                Browse
              </Link>
              {/* Primary before operator, the order the phone tab bar uses
                  (Home · Browse · League · … · More). */}
              <LeagueSwitcher />
              {me.data?.isAdmin && (
                <Link
                  to="/admin"
                  className={navLinkClassName}
                  inactiveProps={navLinkInactiveProps}
                  activeProps={navLinkActiveProps}
                >
                  Admin
                </Link>
              )}
              {me.data?.isAdmin && me.data?.simEnabled && (
                <Link
                  to="/sim"
                  className={navLinkClassName}
                  inactiveProps={navLinkInactiveProps}
                  activeProps={navLinkActiveProps}
                >
                  Simulator
                </Link>
              )}
            </nav>
          </div>
          <div className="hidden sm:block">
            <SessionMenu />
          </div>
        </div>
        {/* Inside the sticky header so the "now isn't real" warning survives
            scrolling — an indicator you can scroll past is one you can forget. */}
        <SimClockBanner />
      </header>
    </>
  );
}

function SessionMenu() {
  const { data: session } = authClient.useSession();
  // Theme is not in this menu (it was, per FB-14): a set-and-forget
  // preference's one home is the profile page's Appearance section, which
  // is also the only home the phone layout has (owner, 2026-08-22).
  // The avatar comes from /me, not from `session.user.image`: that column is
  // the provider's, and Better Auth's session knows nothing about the member's
  // override (ADR-0022), so reading it here would show the provider photo to
  // the one person who set a different one. React Query dedupes this against
  // the calls in AppHeader and MobileNav, so it costs no request.
  const me = useMe();
  const navigate = useNavigate();
  const signOut = useSignOut();

  // The authed layout's beforeLoad guarantees a session in that subtree; this
  // hook can still observe a brief null while it fetches on mount.
  if (!session) return null;

  const displayName = displayNameOf(session.user);
  const initials = initialsOf(displayName);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Open account menu" className="touch-hit rounded-full">
        <Avatar>
          <AvatarImage src={me.data?.image ?? undefined} alt="" />
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56 max-w-72">
        {/* This dropdown-menu is the Base UI flavor: DropdownMenuLabel is a
            Menu.GroupLabel and throws at runtime unless nested in a Group. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {/* Text-only: the trigger above already renders the avatar. handleOf's
                email fallback is correct here — this is the viewer's own,
                possibly pre-claim, account (see UserIdentity's secondaryOverride). */}
            <UserIdentity
              displayName={displayName}
              username={session.user.username}
              showAvatar={false}
              secondaryOverride={handleOf(session.user)}
            />
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate({ to: "/profile" })}>Profile</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void signOut()}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
