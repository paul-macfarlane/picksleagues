<!-- atlas-v3:testing:start -->
# Testing and proof of work

This document is the authoritative repository policy for verification commands,
acceptance evidence, and `PASS`, `FAIL`, `BLOCKED`, and `SKIPPED` verdict
semantics.

Run surface: **local only**.

Read this guide while planning acceptance criteria, Definition of Done,
fixtures, and verification. Resolve the applicable commands and evidence rules
into each execution packet; implementation workers execute that packet without
rereading this guide.

## Commands

| Check | Command | Coverage | When | Status |
|---|---|---|---|---|
| typecheck | `pnpm typecheck` | tsc across every workspace package, then `e2e/tsconfig.json` — `e2e/` and `playwright.config.ts` are not in any workspace, so `pnpm -r` alone left the merge gate's own specs with no type gate | Every change, before PR | verified |
| lint | `pnpm lint` | ESLint across the repo, including the Clock discipline rule and max-lines warnings | Every change, before PR | verified |
| test | `pnpm test` | Vitest unit suite, no database required (27 files, 528 tests). Includes the exhaustive packages/scoring spec tests. | Every change, before PR | verified |
| test:integration | `pnpm test:integration` | In-process Hono against real Postgres (26 files, 505 tests): transactional lock validation, spread-staleness 409s, pick visibility filtering, join cutoffs and caps, settlement idempotency, override precedence. Auto-creates and migrates picksleagues_test. | Any API, DB, service, or schema change. Requires pnpm db:up first. | verified |
| contract:check | `pnpm contract:check` | Regenerates the OpenAPI spec and client and fails if openapi/ is stale | Any Zod schema, DTO, or route change | verified |
| format:check | `pnpm format:check` | Prettier check across the repo | Before PR | verified |
| format | `pnpm format` | Prettier write across the repo | After edits, before lint; rerun affected tests after automatic fixes | verified |
| build | `pnpm --filter @picksleagues/web build` | tsc -b plus vite build for the SPA. This is the ONLY build in the repository: there is no root build script, and apps/api and all four packages have none. Never record or run 'pnpm build'. | Any apps/web change | verified |
| test:e2e | `pnpm test:e2e` | Playwright against a full local stack with the SimulatedProvider and simulated clock, no network mocks (14 tests). The merge gate. | Before PR. Safe to run unattended: it starts its own stack on its own database (`picksleagues_e2e`) and ports (5273/3100), created and migrated by `e2e/setup/global-setup.ts`, and never touches the dev database — which is what lets its Pick'em journey reset the simulator with `scope: "environment"`. Needs `pnpm db:up` for the Postgres server. Last verified 2026-08-04 on `feat/simp-pr2-rule-surface-collapse`. | verified |
| db:up | `pnpm db:up` | Starts and waits for the Docker Postgres container on port 5433 | Before any integration or e2e run | verified |
| db:migrate | `pnpm db:migrate` | Applies packages/db/migrations to the local database | After pulling or writing a migration | verified |
| dev | `pnpm dev` | Runs the web and api dev servers in parallel. The SPA is the origin at :5173 and proxies the API; OAuth and session cookies are scoped there. | Driving the app or the season simulator locally to produce evidence | verified |

`verified` means the command ran successfully here. `inferred` means configuration names it but setup did not execute it. `unavailable` is an explicit gap.

## Evidence policy

- Repository-local proof-artifact root: `docs/evidence/test-results`.
- Clear the entire proof-artifact root before capturing evidence for each work
  package. It intentionally contains only the latest work package's evidence.
- For UI screenshots and videos, use one directory per test name beneath the
  proof-artifact root. Rerunning a test replaces that test directory.
- Visual/browser behavior: Screenshot when visual state matters, at phone width first since the product is mobile-first. Video only when motion, timing, or a multi-step interaction cannot be proved by a still image. One subdirectory per test name..
- Integration and non-UI behavior: Committed vitest output, or a driven-simulator transcript. The season simulator is this repo's primary verification harness, so a transcript proving the flow at a controlled instant is usually stronger proof than a screenshot -- mechanics in docs/agents/verification-runbook.md..
- External integration: None. Request paths never call ESPN; external provider data arrives only through ingestion jobs, and local verification uses the SimulatedProvider. There is no real-target smoke test..
- Sensitive data: Sanitize before storage. Never commit .env values, session tokens, the jobs shared secret, OAuth client secrets, or database URLs. Screenshots of authenticated pages show only seeded test identities..
- Any screenshot, video, test report, captured output, or other artifact cited as
  `PASS` evidence is saved beneath `docs/evidence/test-results` and committed
  on the feature branch. The PR links to the committed path; it never describes
  an uncommitted local file as attached evidence.
- Screenshot is the default visual proof. Add video only when motion, timing, or
  a multi-step interaction is material and a still image cannot prove it. Do not
  require screenshots or video when the repository has no UI/browser surface.
- Failure-only diagnostics not cited as `PASS` evidence, such as large traces,
  may remain uncommitted when repository policy says so.
- A blocked or skipped check records the attempted command and raw failure.
- `BLOCKED`, `SKIPPED`, ambiguity, and worker self-report are never `PASS`.

Run formatting before lint review, avoid unrelated reformatting, and rerun
affected tests after automatic fixes. Give every real integration seam at least
one criterion against the real dependency. Name test accounts, seed data,
confirmation flows, and cleanup. Human-gated criteria name the prerequisite,
human action, expected result, and post-action check. Runnable work must be
startable and exercisable by a fresh context using committed instructions.

Use `PASS` when evidence proves the criterion, `FAIL` when observable behavior is
incorrect, `BLOCKED` when it cannot be observed or exercised, and `SKIPPED` only
for an approved exception with the attempted command and reason. Sanitize every
retained artifact before storage or sharing.
<!-- atlas-v3:testing:end -->
