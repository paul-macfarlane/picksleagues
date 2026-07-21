# 0003. Deployed-database migrations via GitHub Actions

- **Status:** Accepted
- **Date:** 2026-07-21
- **Related:** architecture.md §Environments / D12, docs/runbooks/environments.md, backlog FND-9

## Context

Nothing applied Drizzle migrations to the Neon databases: CI migrates only its throwaway
Postgres container, the Vercel build doesn't touch the DB, and the runbook never listed
deployed migration as a provisioning step — so the first staging deploy served an empty
schema (OAuth 500s on a missing `verifications` table). Options: migrate inside the Vercel
build (needs an unpooled URL per scope; couples deploy to DB access), a GitHub Actions
workflow on push to `staging`/`main` (paulitakes' proven design §7), or keep it manual
(already demonstrated its failure mode).

## Decision

Mirror paulitakes: a dedicated `Migrate` workflow runs `pnpm db:migrate` on push to
`staging` and `main`, selecting the **direct** (non-pooler) Neon URL from per-branch repo
secrets — `STAGING_DATABASE_URL` / `PROD_DATABASE_URL`, no fallback between them, so `main`
can never migrate the staging database. A missing secret logs a notice and exits green
(incremental provisioning). Per-`ref` concurrency serializes runs.

## Consequences

Merges self-apply schema changes, and the promotion flow guarantees staging migrates before
prod reaches the same commit. Neon URLs are duplicated into GitHub secrets (rotate in two
places). The workflow races the Vercel deploy, so new code may briefly run against the old
schema — migrations must stay backward-compatible for one deploy (expand/contract), which
settlement's recompute-friendly design (D10) already encourages. Revisit if we ever need
migrations gating the deploy itself (move into the Vercel build with an unpooled URL).
