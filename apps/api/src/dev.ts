import { serve } from "@hono/node-server";
import { EspnProvider, loadEnv, resolveClock } from "@picksleagues/core";
import { createDb, getSimClockOffsetMs } from "@picksleagues/db";
import { createApp } from "./app";
import { createAuth } from "./auth";

const port = 3000;

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const auth = createAuth({ env, db });
// ESPN in every environment today; the future SimulatedProvider swaps in here.
const provider = new EspnProvider();

const server = serve(
  {
    fetch: createApp({
      auth,
      db,
      clock: () => resolveClock(env.APP_ENV, () => getSimClockOffsetMs(db)),
      env,
      provider,
    }).fetch,
    port,
  },
  () => {
    console.log(`API dev server listening on http://localhost:${port}/api`);
  },
);

// Dev harnesses (pnpm --parallel, Playwright webServer, VS Code task kill)
// deliver SIGTERM/SIGINT to this process without always closing sockets on
// their own — leaving the listener bound to :3000 after the wrapper exits.
// `server.close()` alone waits for open (including idle keep-alive)
// connections to end, which can hang indefinitely, so we also proactively
// drop idle connections and hard-exit after a short grace period.
function shutdown() {
  // `ServerType` also covers Http2Server/Http2SecureServer, which don't
  // expose closeIdleConnections — we only ever construct a plain http.Server
  // here (no https/http2 options passed to `serve`), so the guard is just to
  // satisfy the wider union type, not because it's ever missing at runtime.
  if ("closeIdleConnections" in server) {
    server.closeIdleConnections();
  }
  server.close(() => {
    process.exit(0);
  });
  // Fallback in case close() never fires (e.g. a lingering non-idle socket).
  setTimeout(() => {
    process.exit(0);
  }, 2000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
