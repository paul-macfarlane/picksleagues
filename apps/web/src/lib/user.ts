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
