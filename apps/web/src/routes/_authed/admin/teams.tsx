import { createFileRoute } from "@tanstack/react-router";
import { TeamsBrowser } from "@/components/admin/teams-browser";

export const Route = createFileRoute("/_authed/admin/teams")({
  component: TeamsBrowser,
});
