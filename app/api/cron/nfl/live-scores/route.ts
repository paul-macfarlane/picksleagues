import { handleCronRoute } from "@/lib/cron-auth";
import { getAppNow } from "@/lib/simulator";
import { runLiveScoresSync } from "@/lib/sync/nfl/live-scores";

export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleCronRoute(request, async () =>
    runLiveScoresSync(await getAppNow()),
  );
}
