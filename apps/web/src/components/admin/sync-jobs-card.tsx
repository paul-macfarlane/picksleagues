import { NFL_SYNC_JOB, type NflSyncJob } from "@picksleagues/schemas";
import { useRunNflSyncJob } from "@/api/admin";
import { JobTriggerRow } from "@/components/admin/job-trigger-row";
import { Section } from "@/components/section";

// Row copy for the manual sync triggers — kept here rather than in the
// api module since it's page display copy, not part of the mutation's shape.
const NFL_SYNC_JOB_ROWS: { job: NflSyncJob; label: string; description: string }[] = [
  {
    job: NFL_SYNC_JOB.SYNC_SCHEDULE,
    label: "Sync schedule",
    description: "Weeks, games, and kickoff times.",
  },
  {
    job: NFL_SYNC_JOB.SYNC_ODDS,
    label: "Sync odds",
    description: "Spreads for games that haven't started.",
  },
  {
    job: NFL_SYNC_JOB.SYNC_SCORES,
    label: "Sync scores",
    description: "Live and final scores.",
  },
  {
    job: NFL_SYNC_JOB.SYNC_STATS,
    label: "Sync stats",
    description: "Team records and matchup context (injuries, form).",
  },
];

export function SyncJobsCard() {
  return (
    <Section
      title="NFL data sync"
      description="Manually trigger the same sync jobs the cron scheduler runs."
    >
      <div className="flex flex-col">
        {NFL_SYNC_JOB_ROWS.map((row) => (
          <SyncJobRow key={row.job} job={row.job} label={row.label} description={row.description} />
        ))}
      </div>
    </Section>
  );
}

function SyncJobRow({
  job,
  label,
  description,
}: {
  job: NflSyncJob;
  label: string;
  description: string;
}) {
  const runJob = useRunNflSyncJob();

  return (
    <JobTriggerRow
      label={label}
      description={description}
      pending={runJob.isPending && runJob.variables === job}
      onRun={() => runJob.mutate(job)}
    />
  );
}
