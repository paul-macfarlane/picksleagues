import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";

function createDb() {
  // Vercel sets this env var automatically in all deployments
  if (process.env.VERCEL) {
    return drizzleNeon(process.env.DATABASE_URL!);
  }
  return drizzlePg(process.env.DATABASE_URL!);
}

export const db = createDb();
