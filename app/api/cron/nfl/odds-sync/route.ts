import { handleCronRoute } from "@/lib/cron-auth";
import { getAppNow } from "@/lib/simulator";
import { runOddsSync } from "@/lib/sync/nfl/odds-sync";

export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleCronRoute(request, async () => runOddsSync(await getAppNow()));
}
