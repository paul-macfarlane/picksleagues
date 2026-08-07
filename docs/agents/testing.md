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
| test | `pnpm test` | Vitest unit suite, no database required. Includes the exhaustive packages/scoring spec tests. | Every change, before PR | verified |
| test:integration | `pnpm test:integration` | In-process Hono against real Postgres: transactional lock validation, spread-staleness 409s, pick visibility filtering, join cutoffs and caps, settlement idempotency, override precedence. Auto-creates and migrates picksleagues_test. | Any API, DB, service, or schema change. Requires pnpm db:up first. | verified |
| contract:check | `pnpm contract:check` | Regenerates the OpenAPI spec and client and fails if openapi/ is stale | Any Zod schema, DTO, or route change | verified |
| format:check | `pnpm format:check` | Prettier check across the repo | Before PR | verified |
| format | `pnpm format` | Prettier write across the repo | After edits, before lint; rerun affected tests after automatic fixes | verified |
| build | `pnpm --filter @picksleagues/web build` | tsc -b plus vite build for the SPA. This is the ONLY build in the repository: there is no root build script, and apps/api and all four packages have none. Never record or run 'pnpm build'. | Any apps/web change | verified |
| test:e2e | `pnpm test:e2e` | Playwright against a full local stack with the SimulatedProvider and simulated clock, no network mocks. The merge gate. | Before PR. Safe to run unattended: it starts its own stack on its own database (`picksleagues_e2e`) and ports (5273/3100), created and migrated by `e2e/setup/global-setup.ts`, and never touches the dev database — which is what lets its Pick'em journey reset the simulator with `scope: "environment"`. Needs `pnpm db:up` for the Postgres server. Last verified 2026-08-06 on `chore/qlty-quality-pass`. | verified |
| db:up | `pnpm db:up` | Starts and waits for the Docker Postgres container on port 5433 | Before any integration or e2e run | verified |
| db:migrate | `pnpm db:migrate` | Applies packages/db/migrations to the local database | After pulling or writing a migration | verified |
| dev | `pnpm dev` | Runs the web and api dev servers in parallel. The SPA is the origin at :5173 and proxies the API; OAuth and session cookies are scoped there. | Driving the app or the season simulator locally to produce evidence | verified |

`verified` means the command ran successfully here. `inferred` means configuration names it but setup did not execute it. `unavailable` is an explicit gap.

**No suite sizes in this table.** File and test counts used to sit in the
Coverage column and went stale the first time a work package added or pruned a
test — QLTY changed two of them inside a single delivery, and three documents
were carrying three different numbers by then. A count belongs in a run's
evidence, where it is dated and attached to a commit; the `Last verified <date>
on <branch>` stamp is the freshness signal that does not rot silently.

**Copy-decoupling probe — three runs, not two.** To prove the e2e suite is
decoupled from copy (the standing guarantee QLTY-2 established): (1) run the
gate green on current copy; (2) reword the bound strings in the SPA and re-run —
it must still pass; (3) revert and re-run to prove the revert is clean. Back the
reverts with byte-exact file copies in the session scratchpad rather than hand
edits, and confirm with `git status` before reporting. Budget three full
stack-up/tear-down cycles, not two — a probe that skips step 3 has proved the
suite tolerates the reword but not that the tree was restored.

**Scoping a partial vitest run: use `--project`, never `--dir` or a bare path.**
The two projects in `vitest.config.ts` are selected by name, and `--dir` is only a
path filter applied *within every* project — so `vitest run --dir packages/scoring`
still runs the `integration` project, whose `globalSetup` creates and migrates the
test database. Confirmed: `vitest list --dir packages/scoring` enumerates both
`[unit]` and `[integration]`; adding `--project unit` leaves only `[unit]`. Narrow
with `vitest run --project unit <path>`. This matters because `--dir` reads like a
scope filter and is not one, so a worker told to stay off the database can reach it
while believing it has not.

## Evidence policy

- **Toasts are the one sanctioned exception to "never bind to DOM structure"**
  (`.claude/rules/engineering.md` §Quality). Sonner exposes no way to put our
  own handle on a toast — its option type has no data-attribute pass-through —
  so `[data-sonner-toast][data-type="error"]`, as `e2e/identity.spec.ts` uses,
  is the binding. Accepted risk, named so it is not rediscovered as a bug: a
  sonner major that renames those attributes fails the merge gate with no
  product change. This exception exists because the alternative is binding to
  the toast's copy, which is worse — copy changes on the owner's judgement alone
  and must not tax that.
- Repository-local proof-artifact root: `docs/evidence/test-results`, with **one
  directory per work package**, lowercased: `docs/evidence/test-results/data-9/…`.
- **Never clear the root, and never delete another work package's evidence.**
  Scoping by work package already prevents stale proof being read as current,
  which is the only thing clearing bought — and clearing costs real things:
  every PR carries deletions unrelated to its change, two concurrent branches
  collide on the same directory, and a PR about playoff ingestion ends up
  removing the proof for a renewal pill. Within a package, one subdirectory per
  test name; rerunning a test replaces that directory.
- **Images and video are not committed. They go in the pull request.** Attach
  screenshots and video to the PR description or a PR comment, where they render
  inline for the reviewer instead of making them click through to a repo path. A
  PNG is also the one artifact that cannot be cleaned up later without rewriting
  history, so it is the one that must not accumulate there. `.gitignore` enforces
  this — image and video extensions under the evidence root are ignored.
  "Uploaded to the PR" is durable and reviewable, so it satisfies the
  never-cite-an-uncommitted-local-file rule below; a path on your laptop does not.
- Visual/browser behavior: Screenshot when visual state matters, at phone width first since the product is mobile-first. Video only when motion, timing, or a multi-step interaction cannot be proved by a still image. Attached to the PR, not committed.
- Integration and non-UI behavior: Committed vitest output, or a driven-simulator transcript. The season simulator is this repo's primary verification harness, so a transcript proving the flow at a controlled instant is usually stronger proof than a screenshot -- mechanics in docs/agents/verification-runbook.md..
- External integration: None. Request paths never call ESPN; external provider data arrives only through ingestion jobs, and local verification uses the SimulatedProvider. There is no real-target smoke test..
- Sensitive data: Sanitize before storage. Never commit .env values, session tokens, the jobs shared secret, OAuth client secrets, or database URLs. Screenshots of authenticated pages show only seeded test identities..
- Any **text** artifact cited as `PASS` evidence — captured command output, a
  vitest report, a driven-simulator transcript — is saved beneath
  `docs/evidence/test-results/<work-package-id>/` and committed on the feature
  branch, and the PR links that path. Text is small, greppable from a checkout,
  and survives a mirror, which is why it stays in the repo. **Images and video
  are uploaded to the PR instead** (see above). Either way, never describe an
  uncommitted local file as attached evidence.
- Screenshot is the default visual proof. Add video only when motion, timing, or
  a multi-step interaction is material and a still image cannot prove it. Do not
  require screenshots or video when the repository has no UI/browser surface.
  Both are attached to the PR, not committed.
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
