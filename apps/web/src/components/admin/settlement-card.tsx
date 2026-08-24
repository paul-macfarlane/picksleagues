import { useRunSettleSweep } from "@/api/admin";
import { JobTriggerRow } from "@/components/admin/job-trigger-row";
import { Section } from "@/components/section";

/**
 * The settlement sweep's manual trigger (ADM-6). Its own section rather than a
 * fifth row under "NFL data sync": the sweep reads only our own tables and is
 * mode-agnostic, so filing it under an NFL provider-sync heading would claim a
 * scope it doesn't have. The per-league rebuild endpoint deliberately has no
 * trigger here — curl-only by owner re-verdict on ADM-6 (2026-08-23).
 */
export function SettlementCard() {
  const runSweep = useRunSettleSweep();

  return (
    <Section
      title="Settlement"
      description="Manually trigger the reconciliation sweep the cron scheduler runs twice a day."
    >
      <div className="flex flex-col">
        <JobTriggerRow
          label="Settlement sweep"
          description="Recompute every active league's results and standings from stored data."
          pending={runSweep.isPending}
          onRun={() => runSweep.mutate()}
        />
      </div>
    </Section>
  );
}
