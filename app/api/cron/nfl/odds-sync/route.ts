import { handleCronRoute } from "@/lib/cron-auth";
import { runOddsSync } from "@/lib/sync/nfl/odds-sync";

export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleCronRoute(request, () => runOddsSync());
}
