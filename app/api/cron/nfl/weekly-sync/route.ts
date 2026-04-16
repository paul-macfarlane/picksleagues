import { handleCronRoute } from "@/lib/cron-auth";
import { getAppNow } from "@/lib/simulator";
import { runWeeklySync } from "@/lib/sync/nfl/weekly-sync";

export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleCronRoute(request, async () => runWeeklySync(await getAppNow()));
}
