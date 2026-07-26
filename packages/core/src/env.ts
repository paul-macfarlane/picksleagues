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
  // Explicit simulator toggle so an environment can be flipped without a code
  // change. Defaults off so a config omission fails closed, and production
  // ignores it entirely (see `isSimEnabled`).
  SIM_ENABLED: z.stringbool().default(false),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * The single definition of "can this environment reach the simulator" — clock
 * resolution, provider resolution, sim-route registration, and the `/me`
 * capability flag all derive from this one predicate.
 *
 * `APP_ENV=production` is a hard override, not a default (ADR-0014): the
 * simulator can manipulate the clock and reset the environment, so one
 * mis-set env var must never be able to point that at the production
 * database. Enabling it there requires changing `APP_ENV`, not a flag.
 */
export function isSimEnabled(env: Pick<Env, "APP_ENV" | "SIM_ENABLED">): boolean {
  return env.APP_ENV !== APP_ENV.PRODUCTION && env.SIM_ENABLED;
}

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
