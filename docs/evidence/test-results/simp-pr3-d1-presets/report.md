# simp-pr3 / D1 — SIMP-18 + SIMP-19 (season-range presets)

Branch `feat/simp-pr3-presets-and-closeout`, base `staging` at `9f80131`.
Two commits: SIMP-18 (settings shape + contract) then SIMP-19 (resolution).
Every command below was run at the tip of the second commit's working tree,
in this order.

No UI evidence: this deliverable changes `packages/schemas`, `apps/api` and
test fixtures only. The Pick'em forms are SIMP-20 (D2).

## Commands

| # | Command | Exit | Salient output |
|---|---------|------|----------------|
| 1 | `pnpm format` | 0 | Prettier rewrote nothing outside this deliverable's files. |
| 2 | `pnpm lint` | **1 — environmental, see below** | `Parsing error: No tsconfigRootDir was set, and multiple candidate TSConfigRootDirs are present` (626 identical parse errors). |
| 2a | `npx eslint apps packages e2e` | 0 | No findings. Same rule set, scoped to the workspace directories; the substitute run for the row above. |
| 3 | `pnpm typecheck` | 0 | 7 projects + `tsc -p e2e/tsconfig.json`. All `Done`. |
| 4 | `pnpm test` (unit) | 0 | 27 files, **515 tests passed**. |
| 5 | `pnpm db:up` | 0 | `Container picksleagues-db-1 Healthy`. |
| 6 | `pnpm test:integration` | 0 | 27 files, **485 tests passed**, 26.01s. |
| 7 | `pnpm contract:check` | 0 | Regeneration produced no diff — `git status --porcelain -- openapi` empty. |
| 8 | `pnpm --filter @picksleagues/web build` | 0 | `built in 456ms` (run because commit 1 touches `apps/web`). |

`pnpm test:e2e` was not run — it belongs to the orchestrator on the integrated
candidate.

### The `pnpm lint` failure is not this change

A sibling git worktree checked out at
`.claude/worktrees/harness-fixes/picksleagues` (branch
`fix/testing-vitest-project-scoping`, commit `2b70ebd`) is not covered by
`eslint.config.js`'s global ignores, so a root-level `eslint .` finds two
candidate TSConfig roots and fails in the parser before any rule runs. The
failure is layout-dependent, not content-dependent, and predates this
deliverable. This worker does not touch sibling worktrees or guardrail
configuration, so the equivalent scoped run (`npx eslint apps packages e2e`,
row 2a) stands as the lint evidence.

## New tests pinning the acceptance criteria

`apps/api/test/league-season-range.test.ts` — 11 tests, all passing
(`npx vitest run --project integration apps/api/test/league-season-range.test.ts`):

- `stores 'regular_season' | 'postseason' | 'full_season' as its nominal range while every week is still ahead` (3 cases) — the nominal ranges of ADR-0020 §The three presets.
- `is never born already started — the resolved start is still ahead of the clock`.
- `advances the start to the next week whose first kickoff is still ahead` — creation one millisecond past week 1's kickoff resolves to week 2.
- `advances past a week whose kickoff was corrected forward, using the effective kickoff` — `override_kickoff_at ?? kickoff_at`, so resolution and lock derivation agree.
- `falls back to the nominal start on a provisional season whose weeks hold no games` — ADR-0020 §The no-games fallback.
- **`ignores week refs a client supplies alongside the preset`** — the named acceptance criterion for the wire/stored divergence.
- `still refuses a preset whose whole range has already run` — `start_week_passed` stays reachable.
- `re-resolves the range when the commissioner changes the preset` (pre-start editor).
- `applies the mid-week rule to the edit's own clock, not the creation clock`.

`packages/schemas/src/league-settings.test.ts` adds `PickemSettingsInputSchema`
cases, including `drops client-supplied week refs instead of carrying them
through`, and an input-dispatch-map case asserting only Pick'em's entry
diverges.

Changed elsewhere: `apps/api/test/leagues.test.ts` replaces two tests that
expressed themselves through client-supplied `startWeek` (no longer part of the
wire) with `derives startsAt as null when no week in the preset's range has
ingested games` and `advances the start past a week already underway instead of
refusing`; `apps/api/test/pickem-picks.test.ts` re-expresses its two week-range
invalidation cases as preset changes (Regular Season to Postseason clears picks;
Regular Season to Full Season keeps them).
