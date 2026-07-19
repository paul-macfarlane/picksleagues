import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { authClient } from "@/lib/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Pathless layout gating every signed-in route (mvp-spec has no anonymous browsing):
// beforeLoad re-checks the session on every navigation into this subtree.
export const Route = createFileRoute("/_authed")({
  beforeLoad: async () => {
    const { data: session } = await authClient.getSession();
    if (!session) {
      throw redirect({ to: "/sign-in" });
    }
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-semibold text-foreground">Picks Leagues</span>
        <SessionMenu />
      </header>
      <Outlet />
    </div>
  );
}

function SessionMenu() {
  const { data: session } = authClient.useSession();
  const navigate = useNavigate();

  // beforeLoad already guarantees a session for this subtree; this hook can still
  // observe a brief null while it fetches on mount.
  if (!session) return null;

  const displayName = session.user.name || session.user.email;
  const initials =
    displayName
      .split(" ")
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Open account menu">
        <Avatar>
          <AvatarImage src={session.user.image ?? undefined} alt="" />
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{displayName}</DropdownMenuLabel>
        <DropdownMenuLabel className="font-normal text-muted-foreground">
          {session.user.email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            await authClient.signOut();
            navigate({ to: "/sign-in" });
          }}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
