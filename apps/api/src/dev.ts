import { serve } from "@hono/node-server";
import { loadEnv } from "@picksleagues/core";
import { createDb } from "@picksleagues/db";
import { createApp } from "./app";
import { createAuth } from "./auth";

const port = 3000;

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const auth = createAuth({ env, db });

serve({ fetch: createApp({ auth }).fetch, port }, () => {
  console.log(`API dev server listening on http://localhost:${port}/api`);
});
