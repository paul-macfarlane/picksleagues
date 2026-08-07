# Evidence root

Committed proof that a work package's acceptance criteria and DoD items actually hold. This is the configured evidence root for the Atlas experiment (`docs/atlas-experiment.md`); give this path — `docs/evidence` — when `/setup-atlas` asks for the proof-artifact directory.

## Why not `test-results/`

`test-results/` is Playwright's scratch output and is gitignored. Atlas's verification contract requires that any artifact cited as `PASS` evidence be **committed on the feature branch** — "never describe an uncommitted local file as attached evidence". Rather than un-ignoring Playwright's full output (traces, videos, and per-retry directories on every run), evidence is deliberately curated into this directory. `test-results/` stays gitignored and stays scratch.

## Rules

`docs/agents/testing.md` §Evidence policy is authoritative; this restates it for anyone who lands here first.

- **One directory per work package, and nothing is ever cleared.** `docs/evidence/test-results/<work-package-id>/…`, lowercased. Scoping is what stops stale proof reading as current — deleting a previous package's evidence was the old rule and it cost more than it bought: every PR carried deletions unrelated to its change, concurrent branches collided here, and a PR about one feature removed the proof for another. Within a package, one subdirectory per test name; rerunning a test replaces that directory.
- **Text only. Images and video go in the pull request.** Screenshots and video are attached to the PR description or a comment, where they render inline for the reviewer instead of sitting behind a repo path — and a PNG is the one artifact that can't be removed later without rewriting history. `.gitignore` enforces this. Captured command output, vitest reports, and simulator transcripts stay committed here: small, greppable from a checkout, and they survive a mirror.
- **Only `PASS` evidence is committed.** Failure-only diagnostics may stay uncommitted in `test-results/`.
- **Screenshot by default for UI work.** Add video only when motion, timing, or a multi-step interaction genuinely cannot be proved by a still image. Both are attached to the PR.
- **Non-UI criteria** use integration-test reports, captured command output, or real-target results instead — this repo's primary harness is the season simulator (`docs/agents/verification-runbook.md`), so a driven-simulator transcript is often the strongest available proof.
- **Sanitize before committing.** No session cookies, no `BETTER_AUTH_SECRET`/`JOB_SECRET` values, no real user data in a captured payload or screenshot.

Static checks (`pnpm typecheck`, `pnpm lint`, `pnpm contract:check`) prove static correctness only; they never prove runtime behavior and do not need an artifact here.

## Evidence from before 2026-08-07

Work packages up to and including LG-11 committed screenshots here and cleared the whole root each time, so their closeout tables (`docs/plans/lg-9.md`, `lg-10.md`, `lg-11.md`, `simp*.md`) cite image paths that no longer resolve at HEAD. Those images are in git history and in the pull requests that introduced them; they were not re-homed, because under the current rule they would not be committed at all. The plans are records of what was proved at delivery and are left as written.
