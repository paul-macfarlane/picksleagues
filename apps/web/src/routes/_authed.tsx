import { useState } from "react";
import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { MenuIcon } from "lucide-react";
import { authClient } from "@/lib/auth";
import { displayNameOf, handleOf, initialsOf } from "@/lib/user";
import { useMyLeagues } from "@/lib/my-leagues";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { LeagueSwitcher } from "@/components/league-switcher";
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

// Pathless layout gating every signed-in route (mvp-spec has no anonymous browsing):
// beforeLoad re-checks the session on every navigation into this subtree.
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
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
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
              <LeagueSwitcher />
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <MobileNav />
            <ThemeToggle />
            <SessionMenu />
          </div>
        </div>
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
  const navigate = useNavigate();
  const myLeagues = useMyLeagues();
  const leagues = myLeagues.data?.leagues ?? [];

  function goTo(to: "/leagues/new") {
    setOpen(false);
    navigate({ to });
  }

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
          <SheetTitle>Picks Leagues</SheetTitle>
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
        <Button
          variant="outline"
          className="w-full justify-center"
          onClick={() => goTo("/leagues/new")}
        >
          Create league
        </Button>
      </SheetContent>
    </Sheet>
  );
}

function SessionMenu() {
  const { data: session } = authClient.useSession();
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
          <AvatarImage src={session.user.image ?? undefined} alt="" />
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56 max-w-72">
        {/* This dropdown-menu is the Base UI flavor: DropdownMenuLabel is a
            Menu.GroupLabel and throws at runtime unless nested in a Group. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="block truncate text-sm text-foreground">{displayName}</span>
            <span className="block truncate font-normal text-muted-foreground">
              {handleOf(session.user)}
            </span>
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
