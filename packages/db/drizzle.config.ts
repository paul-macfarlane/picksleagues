import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Guard hook in .claude/hooks/ prompts before drizzle-kit runs against non-local DBs.
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/picksleagues",
  },
});
