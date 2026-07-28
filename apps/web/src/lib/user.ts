// Shared derivations so every call site (session menu, future member lists, etc.)
// agrees on how a user is displayed.

export function displayNameOf(user: { name?: string | null; email: string }): string {
  return user.name || user.email;
}

// The @-handle is the app's identity concept (unique username per spec); email
// only appears while the username is unclaimed (pre-claim screens).
export function handleOf(user: { username?: string | null; email: string }): string {
  return user.username ? `@${user.username}` : user.email;
}

export function initialsOf(name: string): string {
  return (
    name
      .split(" ")
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

// The decided identity display rule (PKM UX feedback): display name is
// primary, @username is secondary and shown wherever there's room; on the
// tightest surfaces the username is dropped rather than truncating the name.
// `UserIdentity` (components/user-identity.tsx) is the one renderer of this
// rule; this is the pure "does this variant show a username" decision,
// extracted so it's table-tested without a component render (the vitest
// `unit` project is node-only — see pickem-standings-table.test.ts).
export type UserIdentityVariant = "roomy" | "compact";

export function identityLines(
  user: { displayName: string; username?: string | null },
  variant: UserIdentityVariant,
): { primary: string; secondary: string | null } {
  return {
    primary: user.displayName,
    secondary: variant === "roomy" && user.username ? `@${user.username}` : null,
  };
}
