# simp-pr2 / D4 — SIMP-8 + SIMP-9 verification

Deliverable: the Pick'em write path becomes one immutable submission per member
per week (ADR-0018), settlement and the pick read path lose `moved` (ADR-0019),
and `openapi/` is regenerated at the first state that can produce it.

- Repository: `picksleagues`, branch `feat/simp-pr2-rule-surface-collapse`
- Comparison point: `7f62061` (D3, SIMP-7)
- Commit 1 (SIMP-8): `5d717aa`
- Commit 2 (SIMP-9 + contract regeneration): `e3bac7a`

**This deliverable clears the branch's inherited red state.** It arrived with 26
integration failures and a red `pnpm typecheck` in both apps, attributed in
`../simp-pr2-d2-schemas-migration/report.md` §3 and
`../simp-pr2-d3-spread-collapse/report.md` §3–4. `pnpm test:integration` is now
green, `apps/api` and all four workspace packages typecheck green, and
`pnpm contract:check` passes for the first time since SIMP-5. `apps/web` stays
red in two areas only, both owned by SIMP-10 / SIMP-11 (§3).

Not run, by instruction: `pnpm test:e2e` (deletes every dev league — human-gated)
and any Vercel command.

---

## 1. Raw output

### `pnpm db:up` — exit 0

```
$ docker compose up -d db --wait
 Container picksleagues-db-1 Running
 Container picksleagues-db-1 Waiting
 Container picksleagues-db-1 Healthy
```

### `pnpm format` — exit 0

```
$ prettier --write .
```

Run after each commit. Only `apps/api/test/pickem-picks.test.ts` was rewritten by
it; every other file reported `(unchanged)` and the ~200-line listing is omitted.

### `pnpm lint` — exit 0

```
$ eslint .
```

Run after each commit; no output either time.

### `pnpm test` — exit 0

```
$ vitest run --project unit

 RUN  v4.1.10 /Users/paulmacfarlane/code/picksleagues


 Test Files  28 passed (28)
      Tests  526 passed (526)
   Start at  21:22:29
   Duration  1.02s (transform 1.56s, setup 0ms, import 4.09s, tests 297ms, environment 2ms)

```

The unit suite gains 7 cases: `packages/schemas/src/pickem.test.ts`, the
table-driven test for `requiredPickemPickCount`.

### `pnpm test:integration` — exit 0

```
$ vitest run --project integration

 RUN  v4.1.10 /Users/paulmacfarlane/code/picksleagues


 Test Files  26 passed (26)
      Tests  472 passed (472)
   Start at  21:22:30
   Duration  24.73s (transform 557ms, setup 0ms, import 12.23s, tests 10.12s, environment 1ms)

```

The inherited 26 failures are gone and none was replaced by a skip: the count
moves from `26 failed | 474 passed (500)` at D3 to `472 passed (472)` here. The
suite shrank by 28 cases, which is accounted for in §4.

### `pnpm contract:check` — exit 0

```
$ pnpm contract:generate && test -z "$(git status --porcelain -- openapi)" || (git status --porcelain -- openapi && echo 'openapi/ is stale: run pnpm contract:generate and commit the result' && exit 1)
$ pnpm --filter @picksleagues/api generate:openapi
$ tsx scripts/generate-openapi.ts && openapi-typescript ../../openapi/openapi.json -o ../../openapi/client/schema.d.ts
Wrote /Users/paulmacfarlane/code/picksleagues/openapi/openapi.json
✨ openapi-typescript 7.13.0
🚀 ../../openapi/openapi.json → ../../openapi/client/schema.d.ts [67.8ms]
```

Run **after** commit 2, deliberately: the check's staleness test is
`git status --porcelain -- openapi`, which reports a staged-but-uncommitted
regeneration as dirty. Before the commit it failed with
`openapi/ is stale`; the committed tree is what it certifies.

### `pnpm --filter @picksleagues/api typecheck` — exit 0

```
$ tsc
```

All four workspace packages likewise, each exit 0 with no diagnostics:
`@picksleagues/schemas`, `@picksleagues/scoring`, `@picksleagues/core`,
`@picksleagues/db`.

---

## 2. Complete `pnpm typecheck` output — exit 2 (`apps/web` only)

```
$ pnpm -r typecheck
Scope: 7 of 8 workspace projects
packages/schemas typecheck$ tsc
packages/schemas typecheck: Done
packages/core typecheck$ tsc
packages/db typecheck$ tsc
packages/scoring typecheck$ tsc
packages/scoring typecheck: Done
packages/core typecheck: Done
packages/db typecheck: Done
apps/web typecheck$ tsc -b
apps/api typecheck$ tsc
apps/web typecheck: src/api/pickem.ts(7,8): error TS2305: Module '"@picksleagues/schemas"' has no exported member 'PickemRepickRequest'.
apps/web typecheck: src/api/pickem.ts(159,21): error TS2339: Property 'PICK_NOT_REPLACEABLE' does not exist on type '{ readonly MISCONFIGURED: "misconfigured"; readonly INTERNAL: "internal"; readonly UNAUTHENTICATED: "unauthenticated"; readonly UNAUTHORIZED: "unauthorized"; readonly NOT_ADMIN: "not_admin"; ... 41 more ...; readonly OVERRIDE_UNLOCKS_GAME: "override_unlocks_game"; }'.
apps/web typecheck: src/api/pickem.ts(161,21): error TS2339: Property 'PICK_NOT_FOUND' does not exist on type '{ readonly MISCONFIGURED: "misconfigured"; readonly INTERNAL: "internal"; readonly UNAUTHENTICATED: "unauthenticated"; readonly UNAUTHORIZED: "unauthorized"; readonly NOT_ADMIN: "not_admin"; ... 41 more ...; readonly OVERRIDE_UNLOCKS_GAME: "override_unlocks_game"; }'.
apps/web typecheck: src/api/pickem.ts(190,9): error TS2345: Argument of type '"/api/leagues/{leagueId}/pickem/weeks/{weekId}/repick"' is not assignable to parameter of type 'PathsWithMethod<paths, "post">'.
apps/web typecheck: src/api/pickem.ts(195,11): error TS2345: Argument of type 'Readable<ErrorResponse<{ 201: { headers: { [name: string]: unknown; }; content: { "application/json": { id: string; name: string; mode: "pickem" | "elimination" | "march_madness"; visibility: "public" | "private"; status: "active" | "concluded"; ... 6 more ...; members: { ...; }[]; }; }; }; 400: { ...; }; 401: { ......' is not assignable to parameter of type '{ error: string; message: string; }'.
apps/web typecheck:   Property 'error' is missing in type '{ job: string; status: "ok" | "error" | "skipped"; durationMs: number; details?: { [x: string]: string | number | boolean; } | undefined; message?: string | undefined; }' but required in type '{ error: string; message: string; }'.
apps/web typecheck: src/api/pickem.ts(202,46): error TS2339: Property 'error' does not exist on type 'Readable<ErrorResponse<{ 201: { headers: { [name: string]: unknown; }; content: { "application/json": { id: string; name: string; mode: "pickem" | "elimination" | "march_madness"; visibility: "public" | "private"; status: "active" | "concluded"; ... 6 more ...; members: { ...; }[]; }; }; }; 400: { ...; }; 401: { ......'.
apps/web typecheck:   Property 'error' does not exist on type '{ job: string; status: "ok" | "error" | "skipped"; durationMs: number; details?: { [x: string]: string | number | boolean; } | undefined; message?: string | undefined; }'.
apps/web typecheck: src/components/league/pickem-picks.tsx(159,13): error TS2339: Property 'movedGame' does not exist on type '{ id: string; gameId: string; side: "home" | "away"; spread: number | null; outcome: "push" | "correct" | "incorrect" | null; updatedAt: string; }'.
apps/web typecheck: src/components/league/pickem-picks.tsx(162,48): error TS2339: Property 'movedGame' does not exist on type '{ id: string; gameId: string; side: "home" | "away"; spread: number | null; outcome: "push" | "correct" | "incorrect" | null; updatedAt: string; }'.
apps/web typecheck: src/components/league/pickem-picks.tsx(162,74): error TS2339: Property 'movedGame' does not exist on type '{ id: string; gameId: string; side: "home" | "away"; spread: number | null; outcome: "push" | "correct" | "incorrect" | null; updatedAt: string; }'.
apps/web typecheck: src/components/league/pickem-picks.tsx(459,27): error TS2339: Property 'movedGame' does not exist on type '{ id: string; gameId: string; side: "home" | "away"; spread: number | null; outcome: "push" | "correct" | "incorrect" | null; updatedAt: string; }'.
apps/web typecheck: src/components/league/pickem-picks.tsx(460,33): error TS2339: Property 'movedGame' does not exist on type '{ id: string; gameId: string; side: "home" | "away"; spread: number | null; outcome: "push" | "correct" | "incorrect" | null; updatedAt: string; }'.
apps/web typecheck: src/components/league/pickem-picks.tsx(460,75): error TS2339: Property 'movedGame' does not exist on type '{ id: string; gameId: string; side: "home" | "away"; spread: number | null; outcome: "push" | "correct" | "incorrect" | null; updatedAt: string; }'.
apps/web typecheck: src/components/league/pickem-picks.tsx(460,124): error TS2339: Property 'movedGame' does not exist on type '{ id: string; gameId: string; side: "home" | "away"; spread: number | null; outcome: "push" | "correct" | "incorrect" | null; updatedAt: string; }'.
apps/web typecheck: src/components/league/pickem-standings-table.test.ts(19,5): error TS2353: Object literal may only specify known properties, and 'differential' does not exist in type '{ leagueMemberId: string; userId: string; username: string | null; displayName: string; image: string | null; isViewer: boolean; points: number; wins: number; losses: number; pushes: number; rank: number; }'.
apps/web typecheck: src/components/league/pickem-standings-table.test.ts(37,44): error TS2353: Object literal may only specify known properties, and 'differential' does not exist in type 'Partial<{ leagueMemberId: string; userId: string; username: string | null; displayName: string; image: string | null; isViewer: boolean; points: number; wins: number; losses: number; pushes: number; rank: number; }> & { ...; }'.
apps/web typecheck: src/components/league/pickem-standings-table.test.ts(41,7): error TS2353: Object literal may only specify known properties, and 'differential' does not exist in type 'Partial<{ leagueMemberId: string; userId: string; username: string | null; displayName: string; image: string | null; isViewer: boolean; points: number; wins: number; losses: number; pushes: number; rank: number; }> & { ...; }'.
apps/web typecheck: src/components/league/pickem-standings-table.test.ts(47,46): error TS2353: Object literal may only specify known properties, and 'differential' does not exist in type 'Partial<{ leagueMemberId: string; userId: string; username: string | null; displayName: string; image: string | null; isViewer: boolean; points: number; wins: number; losses: number; pushes: number; rank: number; }> & { ...; }'.
apps/web typecheck: src/components/league/pickem-standings-table.test.ts(48,44): error TS2353: Object literal may only specify known properties, and 'differential' does not exist in type 'Partial<{ leagueMemberId: string; userId: string; username: string | null; displayName: string; image: string | null; isViewer: boolean; points: number; wins: number; losses: number; pushes: number; rank: number; }> & { ...; }'.
apps/web typecheck: src/components/league/pickem-standings-table.tsx(92,16): error TS2339: Property 'differential' does not exist on type '{ leagueMemberId: string; userId: string; username: string | null; displayName: string; image: string | null; isViewer: boolean; points: number; wins: number; losses: number; pushes: number; rank: number; }'.
apps/web typecheck: src/components/league/pickem-standings-table.tsx(92,33): error TS2339: Property 'differential' does not exist on type '{ leagueMemberId: string; userId: string; username: string | null; displayName: string; image: string | null; isViewer: boolean; points: number; wins: number; losses: number; pushes: number; rank: number; }'.
apps/web typecheck: src/components/league/pickem-standings-table.tsx(258,41): error TS2339: Property 'differential' does not exist on type '{ leagueMemberId: string; userId: string; username: string | null; displayName: string; image: string | null; isViewer: boolean; points: number; wins: number; losses: number; pushes: number; rank: number; }'.
apps/web typecheck: src/components/league/pickem-week-detail.test.ts(27,5): error TS2353: Object literal may only specify known properties, and 'differential' does not exist in type '{ leagueMemberId: string; userId: string; username: string | null; displayName: string; image: string | null; isViewer: boolean; points: number; wins: number; losses: number; pushes: number; rank: number; }'.
apps/web typecheck: src/components/league/pickem-week-detail.tsx(273,24): error TS2339: Property 'movedGame' does not exist on type '{ id: string; gameId: string; side: "home" | "away"; spread: number | null; outcome: "push" | "correct" | "incorrect" | null; updatedAt: string; }'.
apps/web typecheck: Failed
/Users/paulmacfarlane/code/picksleagues/apps/web:
[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] @picksleagues/web@0.0.0 typecheck: `tsc -b`
Exit status 2
[ELIFECYCLE] Command failed with exit code 2.
```

---

## 3. Residual-error attribution

23 errors, every one in `apps/web`, in four files. Nothing in `apps/api` or
`packages/*`.

| # | File | Lines | Symbol / error | Cleared by |
|---|---|---|---|---|
| 1 | `apps/web/src/api/pickem.ts` | 7 | `PickemRepickRequest` import | SIMP-10 — owns this file; deletes the `useRepick` mutation hook |
| 2 | `apps/web/src/api/pickem.ts` | 159, 161 | `ERROR_CODE.PICK_NOT_REPLACEABLE` / `PICK_NOT_FOUND` | SIMP-10 — the repick refusal-copy map goes with the hook |
| 3 | `apps/web/src/api/pickem.ts` | 190, 195, 202 | `POST …/repick` is not a path in the generated client | SIMP-10 — same hook; the route no longer exists |
| 4 | `apps/web/src/components/league/pickem-picks.tsx` | 159, 162 ×2, 459, 460 ×3 | `movedGame` on `PickemPick` | SIMP-10 — My Picks: the moved-out-of-week row and `MovedPickTeam` |
| 5 | `apps/web/src/components/league/pickem-standings-table.tsx` | 92 ×2, 258 | `PickemStandingsRow.differential` (sort key + `Diff` cell) | SIMP-11 — standings `Diff` column |
| 6 | `apps/web/src/components/league/pickem-standings-table.test.ts` | 19, 37, 41, 47, 48 | `differential` in row fixtures | SIMP-11 — same |
| 7 | `apps/web/src/components/league/pickem-week-detail.test.ts` | 27 | `differential` in a row fixture | SIMP-11 — same |
| 8 | `apps/web/src/components/league/pickem-week-detail.tsx` | 273 | `movedGame` on `PickemPick` | SIMP-11 — week-detail moved-pick branch |

**Every residual error is attributed, and each is in a file the named ticket
owns outright.** There are no unattributed errors.

### What changed against D3's table

D3 carried 18 rows across seven files. Six rows are gone entirely:

| D3 row | File | Outcome here |
|---|---|---|
| 1, 2 | `apps/api/src/routes/pickem.ts`, `services/pickem/picks.ts` | Fixed — SIMP-8 deleted the repick route and service |
| 3, 4, 5 | `apps/api/src/services/pickem/settlement.ts`, `sim/replay.ts` ×2 | Fixed — SIMP-9. `mapFinalStatus`'s "lacks ending return statement" was the knock-on D2 flagged; it is fixed by restoring a genuinely exhaustive switch, not a fallback return |
| 6, 7 | `apps/api/test/pickem-picks.test.ts` | Fixed — the `moved` fixtures and the `movedGame` read-path case go with the behaviour |
| 9 | `apps/web/src/components/admin/games-browser.tsx:121` | **Fixed by the regeneration.** D3 predicted exactly this: it was a staleness error in the committed client (`spread` missing, `"moved"` in the union behind it), not a defect |
| 11, 16, 17 | `pickem-picks.tsx:230`, `pickem-week-detail.tsx:140`, `sim-fixtures-card.tsx:121` | **Fixed by the regeneration** — all three were the slate/sim `status` union carrying `"moved"` |
| 18 | `apps/web/src/lib/game.ts:25` | Fixed — SIMP-9 deleted the `moved` status label |
| 8, 10, 12–15 | `apps/web` My Picks / standings | Unchanged — rows 1, 4–8 above |

Three errors are **new**, all in `apps/web/src/api/pickem.ts` (row 2 and row 3
above): SIMP-8 retired `pick_not_found` / `pick_not_replaceable` from
`ERROR_CODE` and deleted the `/repick` path from the contract, and that file
still reads both. It is SIMP-10's file — D3's table already assigned it there —
and the errors are the deletion arriving, not a defect.

---

## 4. Integration test-count reconciliation

`500 → 472`, a net −28 across three files. Every case is accounted for.

**`pickem-picks.test.ts` (−1 net).** Removed with the rules they described:
wholesale-replace, empty-array-clears, the two retention-boundary cases and
their "doesn't over-retain" sibling, the cap-remaining-slots case, the
never-refuse-an-empty-submission case, the locked-pick-retention case, and the
four "a pick whose game moved to another week" cases (three retention, one
read-path serialization). Added: the full-set happy path, a second submit →
`already_submitted` with the first set intact, an undersized set, an empty
submission, the **post-first-kickoff submitter**, an oversized set (retitled
from "more than picksPerWeek"), and **raise-`picksPerWeek`-then-resubmit** end
to end. The unplayable-slate `it.each` keeps two cases, retargeted from
cancelled/moved to provider-cancelled/override-cancelled.

**`standings-repick.test.ts` → `pickem-standings.test.ts` (−27).** The repick
half (the file's lines 418–1231) goes with the endpoint; the standings half is
unchanged and the file is renamed for what it now contains. `postRepick` leaves
the shared harness.

**`settlement.test.ts` (net 0).** Two week-move cases out; a two-case `it.each`
for cancelled-pre-kickoff / cancelled-post-kickoff in, plus the ADR-0019
grading case that replaces the override-outranks-a-week-move test.

**`nfl-sync-schedule.test.ts` (net 0).** The week-move case is rewritten rather
than deleted: it still asserts the sync counts the move and re-settles, then
asserts the pick is *not* graded (the accepted failure mode), then applies the
admin `cancelled` override and asserts the push.

---

## 5. Generated-client greps

Run against the committed `openapi/openapi.json` and `openapi/client/schema.d.ts`.

| Term | `openapi/client/schema.d.ts` | `openapi/openapi.json` |
|---|---|---|
| `PickemRepickRequest` | 0 | 0 |
| `movedGame` | 0 | 0 |
| `differential` | 0 | 0 |
| `repick` (any path or operation) | 0 | 0 |
| `"moved"` | 0 | 0 |

`GameStatus` in the generated client:

```
907:        GameStatus: "scheduled" | "in_progress" | "final" | "postponed" | "cancelled";
1067:        NullableGameStatus: "scheduled" | "in_progress" | "final" | "postponed" | "cancelled" | null;
```

The two new wire codes appear in the spec's `submitPickemPicks` response
descriptions (`already_submitted`, `pick_set_incomplete`); `spread_stale` and
`spread_unavailable` are still there, as ADR-0018 requires.

---

## 6. How the required set is sized, and where the rule lives

`packages/schemas/src/pickem.ts`:

```ts
export function requiredPickemPickCount(
  cap: number,
  games: readonly { locked: boolean; pickable: boolean }[],
): number {
  return Math.min(cap, games.filter((game) => !game.locked && game.pickable).length);
}
```

The API calls it inside the submitting transaction with
`settings.picksPerWeek`, against the slate re-read there. SIMP-10's Save button
will call it with the wire's `picksAllowed`. Those agree, and the docblock
carries the argument rather than leaving a future reader to suspect one call
site: `picksAllowed` is `min(picksPerWeek, pickable)`, the unlocked-pickable
count is never larger than the pickable count, so
`min(min(p, pickable), unlockedPickable) === min(p, unlockedPickable)` — the
extra clamp can never bind first.

The wire field `picksAllowed` keeps exactly the meaning it had; no new field was
added. It computes a domain answer rather than a layout one, so it is
unit-tested (7 table-driven cases, including the locked-game and empty-slate
boundaries).

---

## 7. Notes for the reviewer

- **`already_submitted` is checked before per-game validation, on purpose.** A
  second attempt gets the honest reason instead of a stale-spread complaint
  about a sheet that was never going to be accepted. The size check sits between
  it and the per-game loop, which makes `pick_locked` reachable exactly where it
  should be: a sheet assembled before a kickoff is the *right size* for the
  slate the member saw and names a game that has since locked.
- **`lockLeagueMemberRow` is more load-bearing than it was.** Two requests
  racing on an empty week would otherwise both read no existing picks and both
  insert a full set. The comment there says so now.
- **`apps/api/test/pickem-picks.test.ts` line 421** ("filters another member's
  picks…") was reseeded with `picksPerWeek: 2` so each member's one submission
  can still be a *different* pair against the same three-game slate. Under
  submit-once with the default cap of 5 both members would have had to pick the
  whole slate, which would have dissolved the very asymmetry the test needs.
- **`ingest-season.ts` still re-settles on a week change**, and the comment now
  says why that survives ADR-0019: nothing synthesizes an outcome from the week
  any more, but the game's own status decides and may have changed in the same
  run. The `weekMoves` counter and its log line are untouched — they are
  ingestion facts, and per ADR-0019 the operator notice is SIMP-13's.
- **`apps/api/src/services/sim/scenarios/week-move.ts` is still present.**
  SIMP-12 owns deleting it; it does not reference `GAME_STATUS.MOVED` and does
  not block a green typecheck or suite.
- **`packages/db/src/schema/pickem.ts:68-81`** still justifies the per-week
  uniqueness constraint with a week-move scenario. D2 flagged it and left it;
  the write path's duplicate check landed here without needing it changed. Still
  flagged rather than silently rewritten — the constraint itself stands
  (ADR-0018, ADR-0019).
