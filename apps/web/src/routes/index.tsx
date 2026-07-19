import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-2 p-6">
      <h1 className="text-2xl font-semibold text-foreground">Picks Leagues</h1>
      <p className="text-sm text-muted-foreground">Sports pick&apos;em with friends.</p>
    </main>
  );
}
