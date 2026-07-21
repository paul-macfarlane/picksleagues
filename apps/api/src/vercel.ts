import { handle } from "hono/vercel";
import { loadEnv } from "@picksleagues/core";
import { createDb } from "@picksleagues/db";
import { createApp } from "./app";
import { createAuth } from "./auth";

// Module scope runs once per cold start; Fluid Compute reuses the instance
// (and its pg pool) across requests. A bad env config fails the cold start
// loudly instead of limping per-request.
const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const auth = createAuth({ env, db });

export default handle(createApp({ auth }));
