# Evidence root

Committed proof that a work package's acceptance criteria and DoD items actually hold. This is the configured evidence root for the Atlas experiment (`docs/atlas-experiment.md`); give this path — `docs/evidence` — when `/setup-atlas` asks for the proof-artifact directory.

## Why not `test-results/`

`test-results/` is Playwright's scratch output and is gitignored. Atlas's verification contract requires that any artifact cited as `PASS` evidence be **committed on the feature branch** — "never describe an uncommitted local file as attached evidence". Rather than un-ignoring Playwright's full output (traces, videos, and per-retry directories on every run), evidence is deliberately curated into this directory. `test-results/` stays gitignored and stays scratch.

## Rules

- **Cleared per work package.** Delete the whole directory's contents at the start of a work package so stale proof from a previous run can never be accepted as current.
- **One subdirectory per test name.** `docs/evidence/<test-name>/…` — rerunning a test replaces that directory rather than accumulating alongside it.
- **Only `PASS` evidence is committed.** Failure-only diagnostics may stay uncommitted in `test-results/`.
- **Screenshot by default for UI work.** Add video only when motion, timing, or a multi-step interaction genuinely cannot be proved by a still image.
- **Non-UI criteria** use integration-test reports, captured command output, or real-target results instead — this repo's primary harness is the season simulator (`docs/agents/verification-runbook.md`), so a driven-simulator transcript is often the strongest available proof.
- **Sanitize before committing.** No session cookies, no `BETTER_AUTH_SECRET`/`JOB_SECRET` values, no real user data in a captured payload or screenshot.

Static checks (`pnpm typecheck`, `pnpm lint`, `pnpm contract:check`) prove static correctness only; they never prove runtime behavior and do not need an artifact here.
