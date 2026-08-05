# SIMP-15 — dead-code sweep (PR 3, deliverable D5)

Work package `simp-pr3`, deliverable D5. Commit `b3d3e05` on
`feat/simp-pr3-presets-and-closeout`.

_Placed by the frontier orchestrator: the worker's harness refused its own file write and
it reported that rather than routing around the refusal. The spot-checks in
§Orchestrator verification were run independently._

Repository-wide sweep for what the SIMP epic's deletions orphaned. Comparison base:
`0625ec0^`, the commit before `docs(simp): plan the epic` — the epic's true start. The
work package's own fixed base (`9f80131`) is mid-epic and would have hidden every orphan
PR 1 and PR 2 created.

## Headline

**The epic orphaned no live code.** Every export, helper, type, constant, fixture,
test-setup function and wire code in the repository is still referenced, and lint and
typecheck are clean, so no unused imports survive either. What the epic did leave behind
is **comments and display copy naming deleted things** — the same defect class, since a
comment naming a symbol that no longer exists misleads the next reader. Those are this
commit's changes.

## Method — scripted, not anecdotal

1. **Export enumeration.** Every `export function|const|class|type|interface` across
   `packages/*/src`, `apps/api/src`, `apps/api/test`, `apps/web/src` and `e2e` (203
   files), each checked for a reference outside its defining file *and* for any reference
   at all. All four package barrels are `export *`, so no wildcard re-export hid a symbol.
2. **Epic-orphan test.** Every symbol with no remaining external reference was re-checked
   at `0625ec0^`: did it have one *before* the epic? Exactly one did (`SlateTeamSchema`,
   still composed inside `slate.ts` — alive). Every other unreferenced export was already
   unreferenced before the epic began, so none is this ticket's subject.
3. **Test-only exports.** Exports whose only external reference is a test file and whose
   own file does not use them — dead code with a test attached. Result: **none**.
4. **Deleted-symbol siblings.** The 38 exported symbols the epic's diff removed, grepped
   repository-wide. All surviving mentions are in planning and historical records
   (`docs/plans/simp.md`, `backlog/12-simplification.md`, `docs/adr/0019-…`,
   `docs/feedback/05-pickem.md`) that deliberately name what was removed. The entire admin
   odds-history surface — `AdminGameOddsResponse`, `AdminOddsSnapshot`,
   `adminGameOddsQueryKey`, `useAdminGameOdds`, `listGameOdds`,
   `ADMIN_ODDS_SNAPSHOT_LIMIT` — is gone with no leftover route, query key, schema or
   OpenAPI path.
5. **Const sets, wire codes, columns, modules, OpenAPI components, dependencies.** Every
   `as const` member in `packages/schemas`, `packages/core`, `packages/scoring` and
   `apps/api/src/lib`; every column in `packages/db/src/schema`; every module checked for
   an importer; every `components.schemas` entry checked for a `$ref` (zero orphans);
   every runtime dependency checked for an import.

## Orphan list — what was deleted

No symbols. Nine stale references corrected:

| File | Named a thing that no longer exists |
| --- | --- |
| `apps/api/src/services/sim/scenarios/timing.ts` | Justified `WEEK_1` being the only declared week in terms of the deleted `week-move` scenario and a `WEEK_2` that never existed |
| `apps/web/src/lib/game.ts` | `spreadLabel` claimed to be shared by "the substitute-pick dialog", deleted with ADR-0018 |
| `packages/core/src/game-data-provider.ts` | `ProviderGame.status` described `moved` as an override-only status; `moved` is no longer a `GAME_STATUS` member |
| `packages/schemas/src/sim.ts` | `SIM_FINAL_STATUS` explained excluding `moved` — nothing left to exclude |
| `apps/api/src/services/nfl/season-lifecycle.ts` | "until odds snapshots exist"; the table was dropped in migration `0020` |
| `apps/web/src/components/sim/sim-reset-card.tsx` (×2) | Told the operator the reset deletes "odds snapshots". It cannot |
| `apps/web/src/components/admin/sync-jobs-card.tsx` | Sync-odds row described as writing "Spread snapshots"; it writes `games.spread` |
| `apps/api/test/admin-overrides.test.ts` (×2) | Cited a spec section SIMP-3 renamed, and reasoned about "cancelled/moved" games |
| `apps/api/test/pickem-picks.test.ts` | Test titled "reflects the seeded odds snapshot's spread"; the fixture seeds `games.spread` |

No behavior changed. The two UI edits are display copy that was factually wrong about
deleted infrastructure; no test binds to either string, because UI tests bind to role and
name.

## Judgement calls — kept, with the reason

Each is unreferenced or near-unreferenced today, and each was verified to predate the
epic, so none is an orphan this ticket created a duty to remove.

- **`UNPLAYED_GAME_STATUSES`** has indeed shrunk to one member (`cancelled`), which the
  plan flagged as a deletion candidate. Kept: two rules key off it — a game is not
  *pickable*, and an existing pick on it *pushes* — and they must agree. Collapsing it to
  a bare comparison is a refactor, not a deletion.
- **Nine `ERROR_CODE` members with no `ERROR_CODE.X` call site** (`MEMBER_NOT_FOUND`,
  `INVITE_NOT_FOUND`, `NO_ACTIVE_SEASON`, `ALREADY_MEMBER`, `JOIN_CLOSED`, `LEAGUE_FULL`,
  `INVITE_REVOKED`, `INVITE_EXPIRED`, `INVITE_EXHAUSTED`). The API emits all nine — they
  reach the wire through `JOIN_BLOCKED_REASON`, whose values are the same slugs — and
  `ERROR_CODE` documents itself as the complete wire inventory. Pinned values, not dead
  constants.
- **`PICKEM_REFUSAL.NOT_COMMISSIONER`** has no direct reference, but the value is produced
  by `authorizeLeagueAction` and the member is load-bearing in the `PickemRefusal` union
  that `lib/pickem-refusals.ts` maps exhaustively. Removing it breaks the type.
- **`apps/web/src/components/ui/skeleton.tsx`**, the repo's only module with no importer,
  is named by path in `.claude/rules/engineering.md` as the required loading mechanism
  with LNCH-8 owing the retrofit. Deliberately public.
- **Nine never-referenced exports** (`AppType`, `HEAD`/`OPTIONS`, `AppEnv`,
  `AppRoleSchema`, `ErrorCode`, `JobRunStatus`, `MarchMadnessScoringModelSchema`,
  `SimClockAdjustmentKind`) were all already unreferenced at the epic base — package-public
  types for surfaces not yet built, or platform entry points. A general orphan purge is a
  different decision from an epic sweep.
- **Self-aware historical comments** (`sim-fixtures.test.ts:63`,
  `settlement.test.ts:276,316`, `pickem-picks.test.ts:303`) name a deleted thing *and say
  it is deleted*, which is why the test exists. They do not mislead.
- **The `nfl-sync-schedule.week-move` log event** stays: real provider week moves still
  happen, and ADR-0019 makes detection operational — SIMP-13's runbook tells the operator
  to watch that exact line.

## Orchestrator verification

The worker's "no live orphans" claim is the kind that is expensive to be wrong about, so
it was spot-checked independently against the plan's own named candidates. Repository-wide
reference counts across `apps/`, `packages/`, `e2e/`, `openapi/`:

`storedPriceSideFor` 0 · `repickErrorMessage` 0 · `formatSigned` 0 · `movedLine` 0 ·
`MovedPickTeam` 0 · `PICKEM_WEEK_OPTIONS` 0 · `latestSpreadsForGames` 0 · `oddsSnapshots` 0

Every symbol the plan predicted would be left behind is already gone — deleted by the PR
that orphaned it rather than surviving to this sweep, which is what the finding says.

## One stale rule, fixed by the orchestrator

The worker flagged `.claude/rules/engineering.md:19` — it still listed `odds_snapshots`
among the "genuinely shared" tables, which SIMP-7 dropped — and correctly declined to edit
it, since that file is human-owned repository policy imported by `CLAUDE.md` and outside a
worker's bounds. The orchestrator corrected it in the follow-up commit: the line now names
`games` as carrying the current spread directly. A standards document that names a dropped
table is exactly the stale-guardrail failure PR 2's closeout warned about.

## Verification

| Command | Result |
| --- | --- |
| `pnpm format` | pass — every file already formatted |
| `pnpm lint` | pass — `eslint .` clean, so no unused imports or locals survive |
| `pnpm typecheck` | pass — 7 projects + `e2e/tsconfig.json` |
| `pnpm test` | pass — 27 files, 526 tests |
| `pnpm db:up && pnpm test:integration` | pass — 27 files, 490 tests against local Postgres |
| `pnpm contract:check` | pass — `openapi/` regenerated byte-identical |
| `pnpm --filter @picksleagues/web build` | pass |

`pnpm test:e2e` was run by the orchestrator on the integrated candidate; see
`../simp-pr3-aggregate/report.md`.

No UI proof artifacts: this deliverable changes two lines of admin/simulator display copy
and no rendered structure, so there is nothing a screenshot would show that the diff does
not already state.

## Bugs found and not fixed

None.

## Stated limit

The export-enumeration regex does not cover `export default` or destructured
`export const { … }`. Neither form appears in the enumerated files, so the guarantee is
empirical rather than structural.
