import { UnauthorizedError } from "@/lib/errors";

export function assertCronAuth(request: Request): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new Error("CRON_SECRET is not configured");
  }

  const header = request.headers.get("authorization");
  const expected = `Bearer ${secret}`;

  if (!header || header !== expected) {
    throw new UnauthorizedError("Invalid cron authentication");
  }
}

export async function handleCronRoute<T>(
  request: Request,
  run: () => Promise<T>,
): Promise<Response> {
  try {
    assertCronAuth(request);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return Response.json({ error: err.message }, { status: 401 });
    }
    console.error("[cron] Configuration error:", err);
    return Response.json({ error: "Cron not configured" }, { status: 500 });
  }

  try {
    const result = await run();
    return Response.json(result);
  } catch (err) {
    console.error("[cron] Sync failed:", err);
    return Response.json({ error: "Sync failed" }, { status: 500 });
  }
}
