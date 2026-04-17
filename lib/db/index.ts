import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";

import * as authSchema from "./schema/auth";
import * as externalSchema from "./schema/external";
import * as leaguesSchema from "./schema/leagues";
import * as profilesSchema from "./schema/profiles";
import * as relationsSchema from "./schema/relations";
import * as simulatorSchema from "./schema/simulator";
import * as sportsSchema from "./schema/sports";

const schema = {
  ...authSchema,
  ...externalSchema,
  ...leaguesSchema,
  ...profilesSchema,
  ...relationsSchema,
  ...simulatorSchema,
  ...sportsSchema,
};

function createDb() {
  if (process.env.VERCEL) {
    return drizzleNeon({ connection: process.env.DATABASE_URL!, schema });
  }
  return drizzlePg({ connection: process.env.DATABASE_URL!, schema });
}

export const db = createDb();
