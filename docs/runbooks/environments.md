# Runbook: Environments

How the three environments (arch §Environments, D12) are provisioned and operated. Local is
fully scripted; staging/production require one-time console setup in Vercel, Neon, Google
Cloud, and Discord.

## Matrix

| Environment | Deploy                                     | Branch  | Database                   | `APP_ENV`    | Simulator            |
| ----------- | ------------------------------------------ | ------- | -------------------------- | ------------ | -------------------- |
| Local       | `pnpm dev` (Vite :5173 + Hono :3000)       | any     | Docker Postgres :5433      | `local`      | enabled              |
| Staging     | Vercel Preview pinned to `staging` + alias | staging | Neon branch `staging`      | `staging`    | enabled              |
| Production  | Vercel Production                          | main    | Neon primary               | `production` | routes not registered |

## Local

```sh
cp .env.example .env        # fill BETTER_AUTH_SECRET (openssl rand -base64 32), OAuth creds, JOB_SECRET
pnpm install
pnpm db:up                  # Docker Postgres 17 on :5433
pnpm db:migrate
pnpm dev                    # web :5173, api :3000; Vite proxies /api → :3000
```

The SPA and API are same-origin everywhere (locally via the Vite proxy), so there is no CORS
config anywhere — add it only if a real cross-origin consumer ever appears.

## One-time provisioning (staging + production)

### Vercel — one project

1. Create/link the Vercel project to this repo (`vercel link`).
2. Production branch: `main`. Preview deploys are restricted to the `staging` branch by the
   `ignoreCommand` in `vercel.json` (feature-branch pushes skip the build) — no console
   toggle needed.
3. Add a fixed domain alias for the staging branch deployment (e.g. `staging.picksleagues.com`
   → branch `staging`) under Project → Domains.
4. Functions deploy via the Build Output API (`.vercel/output/`), not framework auto-detect:
   `vercel.json` pins `buildCommand` to `scripts/build-vercel-output.sh`, which builds the SPA
   into `static/`, bundles the API entry (`apps/api/src/vercel.ts`) with esbuild in ESM format
   **with the `createRequire` banner** so CJS deps like `pg` can `require` Node built-ins at
   runtime (omitting the banner builds fine and crashes prod at cold start), and writes the
   route table (hashed assets → static files → `/api/*` → function → SPA fallback).
5. Settings → Deployment Protection → set **Vercel Authentication** to Disabled. Previews
   only ever build the `staging` branch (the `ignoreCommand`), and staging must be publicly
   reachable — left on, `staging.picksleagues.com` 302s every request to Vercel SSO and the
   OAuth callback flows can't complete.

### Neon — one project, branch per environment

1. Primary branch = production database.
2. Create a long-lived `staging` branch (copy-on-write from primary; resettable from seed).
3. Copy each branch's **pooled** connection string into the matching Vercel env scope as
   `DATABASE_URL`. Pooled = the `-pooler` hostname (PgBouncer in transaction mode) — in the
   console's Connect widget, toggle "Connection pooling" on, or just insert `-pooler` after
   the endpoint ID (`ep-xxx-123-pooler.<region>.aws.neon.tech`). Serverless instances can
   spike connection counts past the direct limit; the pooler absorbs that.
4. Use the **direct** (non-pooler) URL when running Drizzle migrations — DDL and
   session-level features don't mix with transaction pooling.

### Migrations (ADR-0003)

The `Migrate` workflow (`.github/workflows/migrate.yml`) applies drizzle migrations on every
push to `staging`/`main`, using GitHub repo secrets holding each branch's **direct** Neon
URL: `STAGING_DATABASE_URL` and `PROD_DATABASE_URL` (`gh secret set <NAME>`). No fallback
between them; a missing secret skips green. CI's own migrate step only touches its
throwaway Postgres container — deployed databases are migrated by this workflow alone.
The workflow races the Vercel deploy, so migrations must stay backward-compatible with the
previously deployed code (expand/contract).

The API talks to Neon with plain `pg` over TCP — no Neon-specific driver. Fluid Compute is a
full Node runtime, so the same driver serves Docker Postgres locally/in tests and Neon in
deployed envs; `@neondatabase/serverless` is only for TCP-less runtimes (edge/workers) and
would fork the driver between test and prod for no benefit.

### OAuth apps — one pair per environment

Separate Google and Discord OAuth apps per environment; the redirect URI is
`<origin>/api/auth/callback/<provider>`:

| Environment | Origin (`BETTER_AUTH_URL`)        | Redirect URIs                                                    |
| ----------- | --------------------------------- | ---------------------------------------------------------------- |
| Local       | `http://localhost:5173`           | `http://localhost:5173/api/auth/callback/{google,discord}`       |
| Staging     | `https://staging.picksleagues.com` | `https://staging.picksleagues.com/api/auth/callback/{google,discord}` |
| Production  | `https://picksleagues.com`        | `https://picksleagues.com/api/auth/callback/{google,discord}`    |

Local gotcha: `BETTER_AUTH_URL` must be the **SPA origin** (`:5173`, not `:3000`) — the
session cookie has to be scoped where the SPA can see it; registering `:3000` silently breaks
post-sign-in sessions.

### Vercel env vars — per scope

Set in three scopes (Production / Preview–`staging` / Development):
`APP_ENV`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `JOB_SECRET`,
`ADMIN_USER_IDS`.

Every environment gets its **own** `BETTER_AUTH_SECRET`. Known failure mode: if the staging
Neon branch is created (copy-on-write) from a database that already has a `jwks` row encrypted
under a different secret, auth fails with "Failed to decrypt private key" — fix with
`DELETE FROM jwks;` on the staging branch.

### Jobs (production only)

cron-job.org hits `/api/jobs/*` with the shared-secret header. Staging jobs are triggered
manually (admin page / simulator) — scheduled crons would fight simulated time.

## Promotion flow

Feature branch → PR to `staging` (CI green required) → merge deploys staging → promote by
PR `staging` → `main`, which re-runs the suite and deploys production. Never push either
branch directly (guard hook prompts).

## Resetting staging

1. Reset the Neon `staging` branch from primary (or from seed data).
2. `DELETE FROM jwks;` if the secret differs from the source database's.
3. Run migrations if the branch predates them; re-run any simulator scenario setup.
