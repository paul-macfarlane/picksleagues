import { createFileRoute } from "@tanstack/react-router";
import { SyncJobsCard } from "@/components/admin/sync-jobs-card";

// The default admin section: operations you run, versus the browsers you read.
// The non-prod simulator control panel (SIM-7) joins this tab.
export const Route = createFileRoute("/_authed/admin/")({
  component: AdminJobs,
});

function AdminJobs() {
  return <SyncJobsCard />;
}
