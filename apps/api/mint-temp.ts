process.loadEnvFile("../../.env");
import { createDb } from "@picksleagues/db";
import { loadEnv } from "@picksleagues/core";
import { createAuth } from "./src/auth";
import { createAuthenticatedUser } from "./test/setup/auth-helpers";

async function main() {
  const env = loadEnv(process.env);
  const db = createDb(env.DATABASE_URL);
  const auth = createAuth({ env, db });
  const admin = await createAuthenticatedUser(auth, { username: "fbadmin" });
  const alice = await createAuthenticatedUser(auth, { username: "fb_alice" });
  const bob = await createAuthenticatedUser(auth, { username: "fb_bob" });
  console.log(
    JSON.stringify({
      admin: { id: admin.user.id, cookie: admin.cookie },
      alice: { id: alice.user.id, cookie: alice.cookie },
      bob: { id: bob.user.id, cookie: bob.cookie },
    }),
  );
  await db.$client.end();
}
void main();
