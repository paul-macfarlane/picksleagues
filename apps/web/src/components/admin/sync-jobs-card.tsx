import { NFL_SYNC_JOB, type NflSyncJob } from "@picksleagues/schemas";
import { useRunNflSyncJob } from "@/api/admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
    <Card>
      <CardHeader>
        <CardTitle>NFL data sync</CardTitle>
        <CardDescription>
          Manually trigger the same sync jobs the cron scheduler runs.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {NFL_SYNC_JOB_ROWS.map((row) => (
          <SyncJobRow key={row.job} job={row.job} label={row.label} description={row.description} />
        ))}
      </CardContent>
    </Card>
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
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={runJob.isPending && runJob.variables === job}
        onClick={() => runJob.mutate(job)}
      >
        Run
      </Button>
    </div>
  );
}
