import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { authClient } from "@/lib/auth";
import { displayNameOf, initialsOf } from "@/lib/user";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Pathless layout gating every signed-in route (mvp-spec has no anonymous browsing):
// beforeLoad re-checks the session on every navigation into this subtree.
export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ location }) => {
    const { data: session } = await authClient.getSession();
    if (!session) {
      throw redirect({ to: "/sign-in" });
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
      <DropdownMenuContent align="end">
        {/* This dropdown-menu is the Base UI flavor: DropdownMenuLabel is a
            Menu.GroupLabel and throws at runtime unless nested in a Group. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="block text-sm text-foreground">{displayName}</span>
            <span className="block font-normal text-muted-foreground">{session.user.email}</span>
          </DropdownMenuLabel>
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
