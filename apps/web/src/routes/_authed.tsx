import { useLayoutEffect, useRef, useState } from "react";
import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { MenuIcon } from "lucide-react";
import { authClient } from "@/lib/auth";
import { displayNameOf, handleOf, initialsOf } from "@/lib/user";
import { useMe } from "@/api/me";
import { useMyLeagues } from "@/api/leagues";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const navLinkClassName = "outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
const navLinkInactiveProps = { className: "text-muted-foreground" };
const navLinkActiveProps = {
  className: "text-foreground font-medium",
  "aria-current": "page" as const,
};
const drawerLinkClassName = cn(
  navLinkClassName,
  "rounded-md px-2 py-1.5 hover:bg-muted hover:text-foreground",
);

/**
 * Pathless layout gating every signed-in route (mvp-spec has no anonymous browsing):
 * beforeLoad re-checks the session on every navigation into this subtree.
 */
export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ location }) => {
    const { data: session } = await authClient.getSession();
    if (!session) {
      // Preserve the deep link so sign-in returns here afterward (mvp-spec
      // §Invites: "Visiting a link while signed out routes through sign-in
      // and back").
      throw redirect({ to: "/sign-in", search: { redirect: location.href } });
    }
    // First-time-only claim step per spec onboarding flow (OAuth → claim
    // username → dashboard): every route in this subtree stays gated until
    // claimed, then returns here via the preserved redirect.
    if (!session.user.username) {
      throw redirect({ to: "/claim-username", search: { redirect: location.href } });
    }
  },
  component: AuthedLayout,
});

function AuthedLayout() {
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
    <div className="flex min-h-svh flex-col">
      {/* Overlays (Sheet/AlertDialog/DropdownMenu/Select, see components/ui) all
          portal to document.body at z-50, so z-40 here keeps the header above
          page content while staying under every overlay regardless of DOM order.
          Layering below this: TabNav sticks at z-30, and any page-level sticky
          element (e.g. the picks screen's action bar) must stay under that. */}
      <header ref={headerRef} className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="flex items-center gap-2 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <BrandMark className="size-6" />
              Picks Leagues
            </Link>
            {/* sm and up: full inline nav + league switcher. Below sm, this
                collapses into the hamburger drawer (MobileNav) so nothing
                overflows at phone width. */}
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
                Discover
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
          <div className="flex items-center gap-2">
            <MobileNav />
            <ThemeToggle />
            <SessionMenu />
          </div>
        </div>
        {/* Inside the sticky header so the "now isn't real" warning survives
            scrolling — an indicator you can scroll past is one you can forget. */}
        <SimClockBanner />
      </header>
      {/* Every authed page inherits this one column — pages never set their own
          page width, only intentionally-narrow content (single-card states,
          forms) centered inside it. */}
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}

function MobileNav() {
  const [open, setOpen] = useState(false);
  const me = useMe();
  const myLeagues = useMyLeagues();
  const leagues = myLeagues.data?.leagues ?? [];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Open navigation" className="sm:hidden" />
        }
      >
        <MenuIcon aria-hidden="true" />
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <BrandMark className="size-5" />
            Picks Leagues
          </SheetTitle>
        </SheetHeader>
        <nav aria-label="Primary" className="flex flex-col gap-1 text-sm">
          <Link
            to="/"
            className={drawerLinkClassName}
            inactiveProps={navLinkInactiveProps}
            activeProps={navLinkActiveProps}
            activeOptions={{ exact: true }}
            onClick={() => setOpen(false)}
          >
            Home
          </Link>
          <Link
            to="/discovery"
            className={drawerLinkClassName}
            inactiveProps={navLinkInactiveProps}
            activeProps={navLinkActiveProps}
            onClick={() => setOpen(false)}
          >
            Discover
          </Link>
          {me.data?.isAdmin && (
            <Link
              to="/admin"
              className={drawerLinkClassName}
              inactiveProps={navLinkInactiveProps}
              activeProps={navLinkActiveProps}
              onClick={() => setOpen(false)}
            >
              Admin
            </Link>
          )}
          {me.data?.isAdmin && me.data?.simEnabled && (
            <Link
              to="/sim"
              className={drawerLinkClassName}
              inactiveProps={navLinkInactiveProps}
              activeProps={navLinkActiveProps}
              onClick={() => setOpen(false)}
            >
              Simulator
            </Link>
          )}
        </nav>
        {leagues.length > 0 && (
          <nav aria-label="My leagues" className="flex flex-col gap-1 text-sm">
            <span className="px-2 py-1 text-xs font-medium text-muted-foreground">My leagues</span>
            {leagues.map((league) => (
              <Link
                key={league.id}
                to="/leagues/$leagueId"
                params={{ leagueId: league.id }}
                className={cn(drawerLinkClassName, "truncate")}
                inactiveProps={navLinkInactiveProps}
                activeProps={{
                  ...navLinkActiveProps,
                  className: cn(navLinkActiveProps.className, "bg-accent text-accent-foreground"),
                }}
                onClick={() => setOpen(false)}
              >
                {league.name}
              </Link>
            ))}
          </nav>
        )}
        {/* Same row idiom as the league links above — Router CONCATENATES base and
            active classNames (no tailwind-merge), so a buttonVariants base whose
            bg-background would outrank the appended bg-accent can't be used here. */}
        <Link
          to="/leagues/new"
          className={drawerLinkClassName}
          inactiveProps={navLinkInactiveProps}
          activeProps={{
            ...navLinkActiveProps,
            className: cn(navLinkActiveProps.className, "bg-accent text-accent-foreground"),
          }}
          onClick={() => setOpen(false)}
        >
          Create league
        </Link>
      </SheetContent>
    </Sheet>
  );
}

function SessionMenu() {
  const { data: session } = authClient.useSession();
  // The avatar comes from /me, not from `session.user.image`: that column is
  // the provider's, and Better Auth's session knows nothing about the member's
  // override (ADR-0022), so reading it here would show the provider photo to
  // the one person who set a different one. React Query dedupes this against
  // the calls in AuthedLayout and MobileNav, so it costs no request.
  const me = useMe();
  const navigate = useNavigate();

  // beforeLoad already guarantees a session for this subtree; this hook can still
  // observe a brief null while it fetches on mount.
  if (!session) return null;

  const displayName = displayNameOf(session.user);
  const initials = initialsOf(displayName);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Open account menu">
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
