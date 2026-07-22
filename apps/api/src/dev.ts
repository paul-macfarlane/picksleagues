import { serve } from "@hono/node-server";
import { loadEnv, resolveClock } from "@picksleagues/core";
import { createDb, getSimClockOffsetMs } from "@picksleagues/db";
import { createApp } from "./app";
import { createAuth } from "./auth";

const port = 3000;

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const auth = createAuth({ env, db });

serve(
  {
    fetch: createApp({
      auth,
      db,
      clock: () => resolveClock(env.APP_ENV, () => getSimClockOffsetMs(db)),
      env,
    }).fetch,
    port,
  },
  () => {
    console.log(`API dev server listening on http://localhost:${port}/api`);
  },
);
