import { logError } from "./logger";

export type Alerter = (alert: {
  jobName: string;
  message: string;
  consecutiveFailures: number;
}) => Promise<void>;

/**
 * Discord-webhook alerter for repeated ingestion failures (arch §External
 * Data). Alerting must never change a job's outcome, so every failure path
 * here is caught and logged — never thrown. When no webhook is configured the
 * alerter no-ops, logging `alert.unsent` so the streak is still visible in
 * platform logs.
 */
export function createDiscordAlerter(
  webhookUrl: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Alerter {
  if (webhookUrl === undefined) {
    return async (alert) => {
      logError("alert.unsent", { ...alert });
    };
  }

  return async (alert) => {
    const content = `🚨 Job "${alert.jobName}" failed ${alert.consecutiveFailures} times in a row: ${alert.message}`;
    try {
      const res = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        logError("alert.failed", { jobName: alert.jobName, status: res.status });
      }
    } catch (error) {
      // Swallow — a broken webhook (network error, bad URL) must not turn a
      // job's failure bookkeeping into an unhandled rejection.
      logError("alert.failed", { jobName: alert.jobName, error });
    }
  };
}
