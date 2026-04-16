import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  console.log("Starting NFL initial setup...");
  const start = Date.now();

  const { runInitialSetup } = await import("@/lib/sync/nfl/setup");
  await runInitialSetup();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Setup complete in ${elapsed}s`);
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
