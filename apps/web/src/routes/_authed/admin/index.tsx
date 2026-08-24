import { createFileRoute } from "@tanstack/react-router";
import { SettlementCard } from "@/components/admin/settlement-card";
import { SyncJobsCard } from "@/components/admin/sync-jobs-card";

/**
 * The default admin section: operations you run, versus the browsers you read.
 * The non-prod simulator control panel is deliberately NOT here — it shipped as
 * its own top-level /sim section (SIM-9), since it carries a second gate the
 * admin tabs don't (ADR-0011, ADR-0014).
 */
export const Route = createFileRoute("/_authed/admin/")({
  component: AdminJobs,
});

function AdminJobs() {
  return (
    <>
      <SyncJobsCard />
      <SettlementCard />
    </>
  );
}
