import { handleCronRoute } from "@/lib/cron-auth";
import { runInitialSetup } from "@/lib/sync/nfl/setup";

export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleCronRoute(request, () => runInitialSetup());
}
