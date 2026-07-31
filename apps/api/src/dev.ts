import { serve } from "@hono/node-server";
import { loadEnv } from "@picksleagues/core";
import { createApp } from "./app";
import { createRuntimeDeps } from "./runtime";

// 3000 for `pnpm dev`. Overridable so the E2E stack can run its own API on a
// separate port against its own database (playwright.config.ts), leaving a
// hand-testing dev server on 3000 untouched.
const port = Number(process.env.API_PORT ?? 3000);

const env = loadEnv();

const server = serve(
  {
    fetch: createApp(createRuntimeDeps(env)).fetch,
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
