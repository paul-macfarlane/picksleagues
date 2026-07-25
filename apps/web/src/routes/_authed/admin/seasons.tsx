import { createFileRoute } from "@tanstack/react-router";
import { SeasonsBrowser } from "@/components/admin/seasons-browser";

export const Route = createFileRoute("/_authed/admin/seasons")({
  component: SeasonsBrowser,
});
