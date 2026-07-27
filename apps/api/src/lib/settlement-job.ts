/**
 * The job name threaded into `runJob`'s envelope and log lines for the nightly
 * reconciliation sweep. Shared by the cron route (`/api/jobs/settle-sweep`) and
 * the admin trigger so both report under one name — logs and the cron
 * dashboard key off it.
 */
export const SETTLE_SWEEP_JOB_NAME = "settle-sweep";

/** Same envelope, one league's scope — the admin page's rebuild button. */
export const REBUILD_JOB_NAME = "league-rebuild";
