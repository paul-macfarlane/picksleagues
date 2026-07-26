import { createFileRoute } from "@tanstack/react-router";
import { useMe } from "@/api/me";
import { SimPanel } from "@/components/admin/sim/sim-panel";

export const Route = createFileRoute("/_authed/admin/sim")({
  component: AdminSim,
});

function AdminSim() {
  const me = useMe();

  // The layout route already proved `isAdmin`; this proves the environment
  // has a simulator at all (ADR-0014 — sim routes aren't registered where
  // `isSimEnabled` is false), so this page must be invisible where there's
  // no simulator — reading identically to an unknown route, not an
  // "unavailable" message.
  if (!me.data?.simEnabled) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-8">
        <p className="text-sm text-muted-foreground">Page not found.</p>
      </div>
    );
  }

  return <SimPanel />;
}
