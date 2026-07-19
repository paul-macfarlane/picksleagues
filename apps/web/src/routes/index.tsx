import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/health");
      if (error) throw error;
      return data;
    },
  });

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-2 p-6">
      <h1 className="text-2xl font-semibold text-foreground">Picks Leagues</h1>
      <p className="text-sm text-muted-foreground">Sports pick&apos;em with friends.</p>
      <p className="text-xs text-muted-foreground">
        API: {health.isPending ? "checking…" : health.data?.status === "ok" ? "up" : "unreachable"}
      </p>
    </main>
  );
}
