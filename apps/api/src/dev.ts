import { serve } from "@hono/node-server";
import { EspnProvider, loadEnv, resolveClock } from "@picksleagues/core";
import { createDb, getSimClockOffsetMs } from "@picksleagues/db";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { createDiscordAlerter } from "./lib/alerting";

const port = 3000;

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const auth = createAuth({ env, db });
// ESPN in every environment today; the future SimulatedProvider swaps in here.
const provider = new EspnProvider();
const alerter = createDiscordAlerter(env.DISCORD_ALERT_WEBHOOK_URL);

serve(
  {
    fetch: createApp({
      auth,
      db,
      clock: () => resolveClock(env.APP_ENV, () => getSimClockOffsetMs(db)),
      env,
      provider,
      alerter,
    }).fetch,
    port,
  },
  () => {
    console.log(`API dev server listening on http://localhost:${port}/api`);
  },
);
