import { useLayoutEffect, useRef } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { authClient } from "@/lib/auth";
import { displayNameOf, handleOf, initialsOf } from "@/lib/user";
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
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
              <LeagueSwitcher />
            </nav>
          </div>
          <SessionMenu />
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
  // Theme selection lives in this menu rather than as its own top-bar control
  // (FB-14, owner's call): it's a set-and-forget account preference, not a
  // per-visit action worth permanent header real estate. No SSR pass, so
  // next-themes' `theme` is already correct on first paint.
  const { theme, setTheme } = useTheme();
  // The avatar comes from /me, not from `session.user.image`: that column is
  // the provider's, and Better Auth's session knows nothing about the member's
  // override (ADR-0022), so reading it here would show the provider photo to
  // the one person who set a different one. React Query dedupes this against
  // the calls in AppHeader and MobileNav, so it costs no request.
  const me = useMe();
  const navigate = useNavigate();

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
        {/* Label nested in a Group on purpose — this dropdown-menu is the Base
            UI flavor, and a bare GroupLabel throws at runtime. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
            <DropdownMenuRadioItem value="light">
              <SunIcon />
              Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <MoonIcon />
              Dark
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">
              <MonitorIcon />
              System
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            // Navigate regardless of the result: /sign-in's beforeLoad bounces a
            // still-live session back to "/", so a failed sign-out can't strand
            // the user on a page they shouldn't see.
            const { error } = await authClient.signOut();
            if (error) {
              console.error("Sign-out failed", error);
              toast.error("Sign out failed — please try again.");
            }
            navigate({ to: "/sign-in" });
          }}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
