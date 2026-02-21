import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";

import * as authSchema from "./schema/auth";
import * as profilesSchema from "./schema/profiles";

const schema = { ...authSchema, ...profilesSchema };

function createDb() {
  // Vercel sets this env var automatically in all deployments
  if (process.env.VERCEL) {
    return drizzleNeon({ connection: process.env.DATABASE_URL!, schema });
  }
  return drizzlePg({ connection: process.env.DATABASE_URL!, schema });
}

export const db = createDb();
