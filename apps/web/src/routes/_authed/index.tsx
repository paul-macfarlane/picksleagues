import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/")({
  component: Dashboard,
});

function Dashboard() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-2 p-6">
      <h1 className="text-2xl font-semibold text-foreground">Picks Leagues</h1>
      <p className="text-sm text-muted-foreground">Your leagues dashboard is coming soon.</p>
    </main>
  );
}
