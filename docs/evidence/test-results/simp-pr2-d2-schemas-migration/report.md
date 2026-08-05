# simp-pr2 / D2 — SIMP-5 + SIMP-6 verification

Deliverable: schema deletions, widened settings invalidation, new wire codes, and the
`differential` column migration.

- Repository: `picksleagues`, branch `feat/simp-pr2-rule-surface-collapse`
- Comparison point: `282ebb6` (D1, SIMP-4)
- Commit 1 (SIMP-5): `26c5108`
- Commit 2 (SIMP-6): this commit
- Migration: `packages/db/migrations/0019_curly_vin_gonzales.sql`

**This deliverable deliberately ends with a red `pnpm typecheck`.** SIMP-5 deletes symbols
whose consumers are deleted only by SIMP-8/9/10/11 — later deliverables in this same PR.
Deleting them here would steal their scope and break the commit-per-ticket contract. Section 3
attributes every residual error to the ticket that clears it.

Not run, by instruction: `pnpm test:integration`, `pnpm test:e2e`, `pnpm contract:check`, any
Vercel command. `contract:check` cannot pass until the repick route is deleted (SIMP-8);
`test:e2e` destroys the dev database.

---

## 1. Raw output

### `pnpm format` — exit 0

```
$ prettier --write .
```

Every file reported `(unchanged)`; the tree was already formatted by the per-commit run. The
full per-file listing (~200 lines of `(unchanged)`) is omitted.

### `pnpm lint` — exit 0

```
$ eslint .
```

### `pnpm test` — exit 0

```
$ vitest run --project unit

 RUN  v4.1.10 /Users/paulmacfarlane/code/picksleagues


 Test Files  27 passed (27)
      Tests  519 passed (519)
   Start at  20:37:34
   Duration  1.00s (transform 1.40s, setup 0ms, import 3.95s, tests 279ms, environment 2ms)
```

**Deviation from the expected result, in the safe direction.** The packet predicted failures in
`apps/web/src/components/league/pickem-standings-table.test.ts` and `pickem-week-detail.test.ts`.
They pass. Vitest transpiles without typechecking, and both files build their own row fixtures
that still carry `differential`, so the extra property is a *typecheck* error (section 3) but a
runtime no-op — the `Diff` column renders from the fixture's own value. SIMP-11 deletes both the
column and those fixture fields.

### `pnpm db:migrate` — exit 0

```
$ pnpm --filter @picksleagues/db migrate
$ drizzle-kit migrate
No config path provided, using default 'drizzle.config.ts'
Reading config file '/Users/paulmacfarlane/code/picksleagues/packages/db/drizzle.config.ts'
Using 'pg' driver for database querying
[✓] migrations applied successfully!
```

Run twice — once to apply `0019`, once after the suite; the second run is a no-op. Target was
the local Docker Postgres on `localhost:5433` only.

Post-migration column check:

```
$ docker exec picksleagues-db-1 psql -U postgres -d picksleagues -c "\d pickem_standings" -c "\d pickem_pick_results"
      Column      |           Type           | Collation | Nullable |      Default
 points           | double precision         |           | not null |
      Column      |           Type           | Collation | Nullable |      Default
 points           | double precision         |           | not null |
```

No `differential` column on either table.

---

## 2. Complete `pnpm typecheck` output

`pnpm -r typecheck` runs `apps/api` and `apps/web` in parallel and aborts on the first failure,
so `apps/api`'s errors are truncated from the recursive run. Both are reproduced below.

### `pnpm typecheck` — exit 2

```
$ pnpm -r typecheck
Scope: 7 of 8 workspace projects
packages/schemas typecheck$ tsc
packages/schemas typecheck: Done
packages/core typecheck$ tsc
packages/scoring typecheck$ tsc
packages/db typecheck$ tsc
packages/scoring typecheck: Done
packages/core typecheck: Done
packages/db typecheck: Done
apps/api typecheck$ tsc
apps/web typecheck$ tsc -b
apps/web typecheck: src/api/pickem.ts(7,8): error TS2305: Module '"@picksleagues/schemas"' has no exported member 'PickemRepickRequest'.
apps/web typecheck: src/components/admin/games-browser.tsx(121,42): error TS2322: Type '{ id: string; weekId: string; providerGameId: string; homeTeam: { id: string; abbreviation: string; name: string; }; awayTeam: { id: string; abbreviation: string; name: string; }; kickoffAt: string; status: "scheduled" | ... 4 more ... | "moved"; ... 21 more ...; effectiveClockSeconds: number | null; }' is not assignable to type '{ id: string; weekId: string; providerGameId: string; homeTeam: { id: string; abbreviation: string; name: string; }; awayTeam: { id: string; abbreviation: string; name: string; }; kickoffAt: string; status: "scheduled" | ... 3 more ... | "cancelled"; ... 21 more ...; effectiveClockSeconds: number | null; }'.
apps/web typecheck:   Types of property 'status' are incompatible.
apps/web typecheck:     Type '"scheduled" | "in_progress" | "final" | "postponed" | "cancelled" | "moved"' is not assignable to type '"scheduled" | "in_progress" | "final" | "postponed" | "cancelled"'.
apps/web typecheck:       Type '"moved"' is not assignable to type '"scheduled" | "in_progress" | "final" | "postponed" | "cancelled"'.
apps/web typecheck: src/components/league/pickem-picks.tsx(159,13): error TS2339: Property 'movedGame' does not exist on type '{ id: string; gameId: string; side: "home" | "away"; spread: number | null; outcome: "push" | "correct" | "incorrect" | null; updatedAt: string; }'.
apps/web typecheck: src/components/league/pickem-picks.tsx(162,48): error TS2339: Property 'movedGame' does not exist on type '{ id: string; gameId: string; side: "home" | "away"; spread: number | null; outcome: "push" | "correct" | "incorrect" | null; updatedAt: string; }'.
apps/web typecheck: src/components/league/pickem-picks.tsx(162,74): error TS2339: Property 'movedGame' does not exist on type '{ id: string; gameId: string; side: "home" | "away"; spread: number | null; outcome: "push" | "correct" | "incorrect" | null; updatedAt: string; }'.
apps/web typecheck: src/components/league/pickem-picks.tsx(230,11): error TS2719: Type '{ weekId: string; weekType: "regular" | "postseason"; weekNumber: number; label: string; startsAt: string; endsAt: string; games: { id: string; homeTeam: { id: string; abbreviation: string; name: string; location: string | null; logoLightUrl: string | null; logoDarkUrl: string | null; }; ... 10 more ...; pickable: b...' is not assignable to type '{ weekId: string; weekType: "regular" | "postseason"; weekNumber: number; label: string; startsAt: string; endsAt: string; games: { id: string; homeTeam: { id: string; abbreviation: string; name: string; location: string | null; logoLightUrl: string | null; logoDarkUrl: string | null; }; ... 10 more ...; pickable: b...'. Two different types with this name exist, but they are unrelated.
apps/web typecheck:   Types of property 'games' are incompatible.
apps/web typecheck:     Type '{ id: string; homeTeam: { id: string; abbreviation: string; name: string; location: string | null; logoLightUrl: string | null; logoDarkUrl: string | null; }; awayTeam: { id: string; abbreviation: string; name: string; location: string | null; logoLightUrl: string | null; logoDarkUrl: string | null; }; ... 9 more .....' is not assignable to type '{ id: string; homeTeam: { id: string; abbreviation: string; name: string; location: string | null; logoLightUrl: string | null; logoDarkUrl: string | null; }; awayTeam: { id: string; abbreviation: string; name: string; location: string | null; logoLightUrl: string | null; logoDarkUrl: string | null; }; ... 9 more .....'. Two different types with this name exist, but they are unrelated.
apps/web typecheck:       Type '{ id: string; homeTeam: { id: string; abbreviation: string; name: string; location: string | null; logoLightUrl: string | null; logoDarkUrl: string | null; }; awayTeam: { id: string; abbreviation: string; name: string; location: string | null; logoLightUrl: string | null; logoDarkUrl: string | null; }; ... 9 more .....' is not assignable to type '{ id: string; homeTeam: { id: string; abbreviation: string; name: string; location: string | null; logoLightUrl: string | null; logoDarkUrl: string | null; }; awayTeam: { id: string; abbreviation: string; name: string; location: string | null; logoLightUrl: string | null; logoDarkUrl: string | null; }; ... 9 more .....'. Two different types with this name exist, but they are unrelated.
apps/web typecheck:         Types of property 'status' are incompatible.
apps/web typecheck:           Type '"scheduled" | "in_progress" | "final" | "postponed" | "cancelled" | "moved"' is not assignable to type '"scheduled" | "in_progress" | "final" | "postponed" | "cancelled"'.
apps/web typecheck:             Type '"moved"' is not assignable to type '"scheduled" | "in_progress" | "final" | "postponed" | "cancelled"'.
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
apps/web typecheck: src/components/league/pickem-week-detail.tsx(140,19): error TS2719: Type 'Map<string, { id: string; homeTeam: { id: string; abbreviation: string; name: string; location: string | null; logoLightUrl: string | null; logoDarkUrl: string | null; }; awayTeam: { id: string; ... 4 more ...; logoDarkUrl: string | null; }; ... 9 more ...; pickable: boolean; }>' is not assignable to type 'Map<string, { id: string; homeTeam: { id: string; abbreviation: string; name: string; location: string | null; logoLightUrl: string | null; logoDarkUrl: string | null; }; awayTeam: { id: string; ... 4 more ...; logoDarkUrl: string | null; }; ... 9 more ...; pickable: boolean; }>'. Two different types with this name exist, but they are unrelated.
apps/web typecheck:   Type '{ id: string; homeTeam: { id: string; abbreviation: string; name: string; location: string | null; logoLightUrl: string | null; logoDarkUrl: string | null; }; awayTeam: { id: string; abbreviation: string; name: string; location: string | null; logoLightUrl: string | null; logoDarkUrl: string | null; }; ... 9 more .....' is not assignable to type '{ id: string; homeTeam: { id: string; abbreviation: string; name: string; location: string | null; logoLightUrl: string | null; logoDarkUrl: string | null; }; awayTeam: { id: string; abbreviation: string; name: string; location: string | null; logoLightUrl: string | null; logoDarkUrl: string | null; }; ... 9 more .....'. Two different types with this name exist, but they are unrelated.
apps/web typecheck:     Types of property 'status' are incompatible.
apps/web typecheck:       Type '"scheduled" | "in_progress" | "final" | "postponed" | "cancelled" | "moved"' is not assignable to type '"scheduled" | "in_progress" | "final" | "postponed" | "cancelled"'.
apps/web typecheck:         Type '"moved"' is not assignable to type '"scheduled" | "in_progress" | "final" | "postponed" | "cancelled"'.
apps/web typecheck: src/components/league/pickem-week-detail.tsx(273,24): error TS2339: Property 'movedGame' does not exist on type '{ id: string; gameId: string; side: "home" | "away"; spread: number | null; outcome: "push" | "correct" | "incorrect" | null; updatedAt: string; }'.
apps/web typecheck: src/components/sim/sim-fixtures-card.tsx(121,46): error TS2719: Type '{ id: string; scenarioId: string; providerGameId: string; weekType: "regular" | "postseason"; weekNumber: number; homeTeamAbbr: string; homeTeamName: string; awayTeamAbbr: string; awayTeamName: string; ... 7 more ...; projectedAwayScore: number | null; }' is not assignable to type '{ id: string; scenarioId: string; providerGameId: string; weekType: "regular" | "postseason"; weekNumber: number; homeTeamAbbr: string; homeTeamName: string; awayTeamAbbr: string; awayTeamName: string; ... 7 more ...; projectedAwayScore: number | null; }'. Two different types with this name exist, but they are unrelated.
apps/web typecheck:   Types of property 'projectedStatus' are incompatible.
apps/web typecheck:     Type '"scheduled" | "in_progress" | "final" | "postponed" | "cancelled" | "moved"' is not assignable to type '"scheduled" | "in_progress" | "final" | "postponed" | "cancelled"'.
apps/web typecheck:       Type '"moved"' is not assignable to type '"scheduled" | "in_progress" | "final" | "postponed" | "cancelled"'.
apps/web typecheck: src/lib/game.ts(25,16): error TS2339: Property 'MOVED' does not exist on type '{ readonly SCHEDULED: "scheduled"; readonly IN_PROGRESS: "in_progress"; readonly FINAL: "final"; readonly POSTPONED: "postponed"; readonly CANCELLED: "cancelled"; }'.
apps/web typecheck: Failed
/Users/paulmacfarlane/code/picksleagues/apps/web:
[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] @picksleagues/web@0.0.0 typecheck: `tsc -b`
Exit status 2
[ELIFECYCLE] Command failed with exit code 2.
```

### `pnpm --filter @picksleagues/api typecheck` — exit 2

```
$ tsc
src/routes/pickem.ts(5,3): error TS2724: '"@picksleagues/schemas"' has no exported member named 'PickemRepickRequestSchema'. Did you mean 'SubmitPickemPicksRequestSchema'?
src/services/pickem/picks.ts(15,8): error TS2305: Module '"@picksleagues/schemas"' has no exported member 'PickemRepickRequest'.
src/services/pickem/settlement.ts(152,79): error TS2339: Property 'MOVED' does not exist on type '{ readonly SCHEDULED: "scheduled"; readonly IN_PROGRESS: "in_progress"; readonly FINAL: "final"; readonly POSTPONED: "postponed"; readonly CANCELLED: "cancelled"; }'.
src/services/sim/replay.ts(40,4): error TS2366: Function lacks ending return statement and return type does not include 'undefined'.
src/services/sim/replay.ts(50,22): error TS2339: Property 'MOVED' does not exist on type '{ readonly SCHEDULED: "scheduled"; readonly IN_PROGRESS: "in_progress"; readonly FINAL: "final"; readonly POSTPONED: "postponed"; readonly CANCELLED: "cancelled"; }'.
test/pickem-picks.test.ts(303,64): error TS2339: Property 'MOVED' does not exist on type '{ readonly SCHEDULED: "scheduled"; readonly IN_PROGRESS: "in_progress"; readonly FINAL: "final"; readonly POSTPONED: "postponed"; readonly CANCELLED: "cancelled"; }'.
test/pickem-picks.test.ts(754,62): error TS2339: Property 'MOVED' does not exist on type '{ readonly SCHEDULED: "scheduled"; readonly IN_PROGRESS: "in_progress"; readonly FINAL: "final"; readonly POSTPONED: "postponed"; readonly CANCELLED: "cancelled"; }'.
test/pickem-picks.test.ts(932,20): error TS2339: Property 'movedGame' does not exist on type '{ id: string; gameId: string; side: "home" | "away"; spread: number | null; outcome: "push" | "correct" | "incorrect" | null; updatedAt: string; }'.
test/pickem-picks.test.ts(933,20): error TS2339: Property 'movedGame' does not exist on type '{ id: string; gameId: string; side: "home" | "away"; spread: number | null; outcome: "push" | "correct" | "incorrect" | null; updatedAt: string; }'.
test/pickem-picks.test.ts(934,20): error TS2339: Property 'movedGame' does not exist on type '{ id: string; gameId: string; side: "home" | "away"; spread: number | null; outcome: "push" | "correct" | "incorrect" | null; updatedAt: string; }'.
test/pickem-picks.test.ts(938,54): error TS2339: Property 'movedGame' does not exist on type '{ id: string; gameId: string; side: "home" | "away"; spread: number | null; outcome: "push" | "correct" | "incorrect" | null; updatedAt: string; }'.
/Users/paulmacfarlane/code/picksleagues/apps/api:
[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] @picksleagues/api@0.0.0 typecheck: `tsc`
Exit status 2
```

All four workspace packages typecheck clean: `packages/schemas`, `packages/scoring`,
`packages/core`, `packages/db`. Only the two apps are red.

---

## 3. Residual-error attribution

One row per distinct residual error. "Regen" means the error is the stale committed `openapi/`
client still carrying `"moved"` in its `GameStatus` union — it disappears when `openapi/` is
regenerated, which the plan schedules for the first green state after the `moved` read-path
deletions (SIMP-9).

| # | File | Symbol / error | Cleared by |
|---|---|---|---|
| 1 | `apps/api/src/routes/pickem.ts:5` | `PickemRepickRequestSchema` import | SIMP-8 — deletes the `/repick` route |
| 2 | `apps/api/src/services/pickem/picks.ts:15` | `PickemRepickRequest` import | SIMP-8 — deletes `repickPickemPick` |
| 3 | `apps/api/src/services/pickem/settlement.ts:152` | `GAME_STATUS.MOVED` (week-move synthesis) | SIMP-9 — settlement `moved` synthesis |
| 4 | `apps/api/src/services/sim/replay.ts:50` | `GAME_STATUS.MOVED` case label | SIMP-9 — `sim/replay.ts` |
| 5 | `apps/api/src/services/sim/replay.ts:40` | `mapFinalStatus` "lacks ending return statement" | SIMP-9 — consequence of #4: the broken case label defeats TS's exhaustiveness proof over `GAME_STATUS` |
| 6 | `apps/api/test/pickem-picks.test.ts:303,754` | `GAME_STATUS.MOVED` in moved-game fixtures | SIMP-9 — the moved read-path tests go with the behavior |
| 7 | `apps/api/test/pickem-picks.test.ts:932,933,934,938` | `movedGame` on `PickemPick` | SIMP-9 — read-path `movedGame` serialization |
| 8 | `apps/web/src/api/pickem.ts:7` | `PickemRepickRequest` import | SIMP-10 — owns `apps/web/src/api/pickem.ts` (the repick mutation hook) |
| 9 | `apps/web/src/components/admin/games-browser.tsx:121` | `status` union carries `"moved"` | SIMP-9 — admin status-override option set + regen |
| 10 | `apps/web/src/components/league/pickem-picks.tsx:159,162,459,460` | `movedGame` on `PickemPick` | SIMP-10 — My Picks components |
| 11 | `apps/web/src/components/league/pickem-picks.tsx:230` | slate `status` union carries `"moved"` | SIMP-9 — regen |
| 12 | `apps/web/src/components/league/pickem-standings-table.tsx:92,258` | `PickemStandingsRow.differential` (sort key + `Diff` cell) | SIMP-11 — standings `Diff` column |
| 13 | `apps/web/src/components/league/pickem-standings-table.test.ts:19,37,41,47,48` | `differential` in row fixtures | SIMP-11 — same |
| 14 | `apps/web/src/components/league/pickem-week-detail.test.ts:27` | `differential` in row fixture | SIMP-11 — same |
| 15 | `apps/web/src/components/league/pickem-week-detail.tsx:273` | `movedGame` on `PickemPick` | SIMP-11 — week-detail moved branch |
| 16 | `apps/web/src/components/league/pickem-week-detail.tsx:140` | slate `status` union carries `"moved"` | SIMP-9 — regen |
| 17 | `apps/web/src/components/sim/sim-fixtures-card.tsx:121` | `projectedStatus` union carries `"moved"` | SIMP-9 — regen |
| 18 | `apps/web/src/lib/game.ts:25` | `GAME_STATUS.MOVED` | SIMP-9 — `apps/web/src/lib/game.ts` |

**Every residual error is attributed. There are no unattributed errors.**

Cross-check that the set is closed: the deleted symbols are `PICKEM_PUSH_TIE_RESOLUTION` /
`pushTieResolution` (all consumers removed in commit 1 — no residual), `PickemRepickRequest*`
(rows 1, 2, 8), `PickemMovedGame*` / `PickemPick.movedGame` (rows 7, 10, 15),
`GAME_STATUS.MOVED` (rows 3–6, 9, 11, 16, 17, 18), and `differential` on the standings row and
the sim standings row (rows 12–14; the API and sim service sides are fixed in commit 2, and the
`pickem_pick_results` / `pickem_standings` columns are dropped by the migration).

---

## 4. Bridges

`git grep "SIMP-[0-9] bridge"` returns nothing after commit 2. The bridge sites D1 left — four
`differential: 0` writes plus one dead `differential` select in
`apps/api/src/services/pickem/settlement.ts`, and the wire field served from the stored column
in `apps/api/src/services/pickem/standings.ts` — are gone, along with the parallel read in
`apps/api/src/services/sim/settle.ts`.

---

## 5. Notes for the reviewer

- `apps/api/test/sim-settle.test.ts` carried a rank assertion (`memberA` rank 2, `memberB`
  rank 1) that D1 already invalidated when `rankStandings` stopped consulting the differential:
  two members level on points now share rank 1. Corrected here, in the commit that removes the
  field the old expectation depended on. It is an integration test, so neither D1 nor this
  deliverable could observe the failure by running it.
- `packages/db/src/schema/pickem.ts:68-81` still justifies the per-week uniqueness constraint
  with a week-move scenario ADR-0019 makes unreachable. ADR-0018 keeps the constraint but
  supersedes that motivation. Left alone deliberately — the write path's duplicate check is
  SIMP-8's — and flagged rather than silently rewritten.
- ADR-0018's own text still lists the settings-reset trigger as "Picks Per Week lowered".
  Red-team finding B2 widened it to any change, which is what ships here. A one-line ADR
  amendment is a human decision and is not taken in this deliverable.
