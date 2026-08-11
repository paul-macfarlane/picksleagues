process.loadEnvFile("../../.env");
import { createDb } from "@picksleagues/db";
import { loadEnv } from "@picksleagues/core";
import { createAuth } from "./src/auth";
import { createAuthenticatedUser } from "./test/setup/auth-helpers";
async function main() {
  const env = loadEnv(process.env);
  const db = createDb(env.DATABASE_URL);
  const auth = createAuth({ env, db });
  const admin = await createAuthenticatedUser(auth, { username: "fb4admin" });
  console.log(JSON.stringify({ cookie: admin.cookie }));
  await db.$client.end();
}
void main();
