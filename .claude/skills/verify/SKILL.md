---
name: verify
description: Build/launch/drive recipe for runtime-verifying changes in this repo (Vite SPA + Hono API + local Docker Postgres + season simulator).
---

# Verifying Picks Leagues changes at runtime

> **Stub — the code scaffold doesn't exist yet.** Fill in each section with real commands, ports, and env-var names as the corresponding tasks land (FND-1/2 launch, FND-4 auth, SIM epic simulator). Keeping this file current is part of closing those tasks. The intended shape below comes from `docs/architecture.md`.

## Launch (fill in at FND-1/FND-2)

- DB: Docker Postgres via the repo compose file (`pnpm db:up` or similar); apply migrations with drizzle-kit. Record container name, host port, and credentials here.
- API: Hono dev server. Web: Vite dev server. Record start commands, ports, and a readiness check (`curl -s -o /dev/null -w "%{http_code}" ...`).

## Drive

- The SPA consumes the generated OpenAPI client, so most behavior is verifiable straight against the API — `curl` routes per the committed spec in `openapi/`.
- **The simulator is the primary verification harness** (non-prod only): load a scenario (`POST /sim/fixtures`), set or advance time (`POST /sim/clock`), run settlement (`POST /sim/settle`), then assert via ordinary API reads. Record the shared-secret header/env-var name and the scenario file locations here once SIM lands. Time-dependent behavior (locking, cutoffs, deadlines) must be verified by moving the simulated clock, never by editing kickoff timestamps.
- DB state setup/inspection without the UI: `docker exec <container> psql ...` — record specifics; clean up synthetic rows afterward.

## Auth-gated flows (fill in at FND-4)

Sign-in is OAuth-only (Google/Discord), so headless verification needs a minted session: follow the paulitakes pattern — an e2e helper that inserts user + session rows and signs the Better Auth session cookie with the local secret. Record the helper path and usage (Playwright `addCookies`, or curl with the cookie) here once built.

## Gotchas

- (accumulate as discovered)
