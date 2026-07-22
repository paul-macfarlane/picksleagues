import { z } from "zod";

export const APP_ENV = {
  LOCAL: "local",
  STAGING: "staging",
  PRODUCTION: "production",
} as const;

export type AppEnv = (typeof APP_ENV)[keyof typeof APP_ENV];

const EnvSchema = z.object({
  APP_ENV: z.enum(APP_ENV),
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  JOB_SECRET: z.string().min(32),
  // Discord webhook for repeated ingestion-failure alerts (arch §External
  // Data). Optional — alerting no-ops (logs only) when unset. `.env` templates
  // ship the key with an empty value, so treat "" as absent rather than letting
  // z.url() reject it and crash startup.
  DISCORD_ALERT_WEBHOOK_URL: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
  // Comma-separated Better Auth user ids; admin capability is this allowlist (arch §Overrides).
  ADMIN_USER_IDS: z
    .string()
    .default("")
    .transform((raw) =>
      raw
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/**
 * Parses and caches env config. Called once at startup (dev entry / function
 * cold start); everything downstream takes the parsed `Env`, never process.env.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  if (cached === undefined) {
    const parsed = EnvSchema.safeParse(source);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
        .join("\n");
      throw new Error(`Invalid environment configuration:\n${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Test-only escape hatch so each test can exercise loadEnv against its own source. */
export function resetEnvCache(): void {
  cached = undefined;
}
