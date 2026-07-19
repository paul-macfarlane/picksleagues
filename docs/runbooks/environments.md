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
2. Production branch: `main`. Enable preview deployments for the `staging` branch only.
3. Add a fixed domain alias for the staging branch deployment (e.g. `staging.picksleagues.app`
   → branch `staging`) under Project → Domains.
4. Functions deploy via the Build Output API (`.vercel/output/`), not framework auto-detect —
   the API is bundled by `scripts/build-vercel-output.sh` (esbuild, ESM format **with the
   `createRequire` banner** so CJS deps like `pg` can `require` Node built-ins at runtime;
   removing the banner crashes prod at cold start).

### Neon — one project, branch per environment

1. Primary branch = production database.
2. Create a long-lived `staging` branch (copy-on-write from primary; resettable from seed).
3. Copy each branch's connection string into the matching Vercel env scope as `DATABASE_URL`.

### OAuth apps — one pair per environment

Separate Google and Discord OAuth apps per environment; the redirect URI is
`<origin>/api/auth/callback/<provider>`:

| Environment | Origin (`BETTER_AUTH_URL`)        | Redirect URIs                                                    |
| ----------- | --------------------------------- | ---------------------------------------------------------------- |
| Local       | `http://localhost:5173`           | `http://localhost:5173/api/auth/callback/{google,discord}`       |
| Staging     | `https://staging.picksleagues.app` | `https://staging.picksleagues.app/api/auth/callback/{google,discord}` |
| Production  | `https://picksleagues.app`        | `https://picksleagues.app/api/auth/callback/{google,discord}`    |

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
