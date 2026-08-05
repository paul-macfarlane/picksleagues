# simp-pr2 / D5 — SIMP-10 + SIMP-11 + SIMP-12 verification

Deliverable: My Picks becomes confirm-and-freeze, the standings and League Picks
surfaces lose the tiebreaker and the moved-pick rows, and the simulator library
drops the `week-move` scenario.

- Repository: `picksleagues`, branch `feat/simp-pr2-rule-surface-collapse`
- Comparison point: `596f490` (D4, SIMP-9)
- Commit 1 (SIMP-10): `54d934c`
- Commit 2 (SIMP-11): `7f420fd`
- Commit 3 (SIMP-12 + this report): recorded in the branch log

**This deliverable clears the branch's inherited red state.** It arrived with 23
`apps/web` typecheck errors across four files, attributed in
`../simp-pr2-d4-write-path/report.md` §3 — every one owned by SIMP-10 or
SIMP-11. `pnpm typecheck` is now green across the whole repository for the first
time since SIMP-4, and so is every other gate, including
`pnpm --filter @picksleagues/web build`.

Not run, by instruction: `pnpm test:e2e` (deletes every dev league — human-gated;
SIMP-14 rewrites that journey and the orchestrator runs it) and any Vercel
command. No screenshots: the flow this deliverable ships has no e2e driver yet,
so visual evidence is captured at aggregate verification.

---

## 1. Raw output — all five gates plus `format` and `lint`

Every command below was re-run from a clean tree at the tip of commit 3's
content, in this order, each exiting 0.

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

Run after each commit as well as here. Every file reported `(unchanged)` on this
final pass; the ~330-line listing is omitted. During the work it rewrapped
`pickem-picks.tsx` and `pickem-game-row.tsx` once each, and those rewraps are in
commit 1.

### `pnpm lint` — exit 0

```
$ eslint .
```

Run after each commit; no output any time.

### `pnpm typecheck` — exit 0

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
apps/web typecheck: Done
apps/api typecheck: Done
```

No diagnostics from any project. This is the line the last three evidence
reports could not print.

### `pnpm test` — exit 0

```
$ vitest run --project unit

 RUN  v4.1.10 /Users/paulmacfarlane/code/picksleagues


 Test Files  27 passed (27)
      Tests  496 passed (496)
   Start at  21:44:53
   Duration  974ms (transform 1.66s, setup 0ms, import 3.90s, tests 305ms, environment 2ms)

```

### `pnpm test:integration` — exit 0

```
$ vitest run --project integration

 RUN  v4.1.10 /Users/paulmacfarlane/code/picksleagues


 Test Files  26 passed (26)
      Tests  472 passed (472)
   Start at  21:44:55
   Duration  25.49s (transform 559ms, setup 0ms, import 12.43s, tests 10.61s, environment 1ms)

```

Same 26 files and 472 cases as D4 — the `week-move` scenario deletion rewrites
one existing case rather than removing any (§4).

### `pnpm contract:check` — exit 0

```
$ pnpm contract:generate && test -z "$(git status --porcelain -- openapi)" || (git status --porcelain -- openapi && echo 'openapi/ is stale: run pnpm contract:generate and commit the result' && exit 1)
$ pnpm --filter @picksleagues/api generate:openapi
$ tsx scripts/generate-openapi.ts && openapi-typescript ../../openapi/openapi.json -o ../../openapi/client/schema.d.ts
Wrote /Users/paulmacfarlane/code/picksleagues/openapi/openapi.json
✨ openapi-typescript 7.13.0
🚀 ../../openapi/openapi.json → ../../openapi/client/schema.d.ts [68.3ms]
```

Regeneration is a no-op: this deliverable changes no schema and no route. D4
already committed the current `openapi/`.

### `pnpm --filter @picksleagues/web build` — exit 0

```
$ tsc -b && vite build
vite v8.1.5 building client environment for production...
transforming...
✓ 3565 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                              1.95 kB │ gzip:  0.76 kB
dist/assets/geist-cyrillic-ext-wght-normal-DjL33-gN.woff2    7.42 kB
dist/assets/geist-vietnamese-wght-normal-6IgcOCM7.woff2      8.00 kB
dist/assets/geist-cyrillic-wght-normal-BEAKL7Jp.woff2       15.08 kB
dist/assets/geist-latin-ext-wght-normal-DC-KSUi6.woff2      16.51 kB
dist/assets/geist-latin-wght-normal-BgDaEnEv.woff2          29.40 kB
dist/assets/index-DmlfSS6E.css                              63.99 kB │ gzip: 11.48 kB
… (78 further asset lines omitted)
dist/assets/date-time-picker-cOfRxGzg.js                    85.39 kB │ gzip: 25.85 kB
dist/assets/schemas-B7sqQlGY.js                            112.12 kB │ gzip: 30.28 kB
dist/assets/src-BFmrMiiz.js                                192.06 kB │ gzip: 44.37 kB
dist/assets/index-DWB1P5ie.js                              260.36 kB │ gzip: 80.59 kB

✓ built in 514ms
```

The only build in the repo, and the gate the whole branch had been unable to
reach since SIMP-4.

---

## 2. Inherited-error clearance

Every row of D4's residual table, and which commit closed it. Nothing was
suppressed, cast away, or left behind a `@ts-expect-error`.

| D4 row | File / symbol | Closed by |
|---|---|---|
| 1 | `api/pickem.ts:7` `PickemRepickRequest` import | Commit 1 — `useRepick` deleted |
| 2 | `api/pickem.ts:159,161` `PICK_NOT_REPLACEABLE` / `PICK_NOT_FOUND` | Commit 1 — the repick refusal map went with the hook |
| 3 | `api/pickem.ts:190,195,202` `POST …/repick` not a client path | Commit 1 — same hook |
| 4 | `pickem-picks.tsx` ×7 `movedGame` | Commit 1 — `MovedPickTeam` and the moved-out-of-week `<li>` deleted |
| 5 | `pickem-standings-table.tsx` ×3 `differential` | Commit 2 — `Diff` column and `DIFFERENTIAL` sort member deleted |
| 6 | `pickem-standings-table.test.ts` ×5 `differential` | Commit 2 — fixture rebuilt |
| 7 | `pickem-week-detail.test.ts:27` `differential` | Commit 2 — fixture field dropped |
| 8 | `pickem-week-detail.tsx:273` `movedGame` | Commit 2 — `!game` branch deleted, join moved up |

---

## 3. Deleted files and symbols

Files deleted outright:

- `apps/web/src/components/league/pickem-substitute-dialog.tsx`
- `apps/web/src/components/league/pickem-game-row.test.ts` (its only subject was
  `storedPriceSideFor`)
- `apps/api/src/services/sim/scenarios/week-move.ts`

Exported symbols deleted, with their tests:

| Symbol | Home | Why it has nothing left to do |
|---|---|---|
| `useRepick`, `repickErrorMessage` | `api/pickem.ts` | The endpoint went in SIMP-8 |
| `storedPriceSideFor` | `pickem-game-row.tsx` | A submitted pick can never be re-priced, so no row ever holds a stored price *and* a live offer |
| `repricedPickCount` | `pickem-picks.tsx` | Spreads are accepted exactly once, at submission |
| `hasOperableControl` | `pickem-picks.tsx` | The action bar's condition is now "the week still has something to pick" |
| `visibleGames` | `pickem-picks.tsx` | The sheet shows what can still be picked; the submitted view shows the picks. Neither needs to reconcile the two |
| `weekHasNothingToShow` | `pickem-picks.tsx` | Its whole reason was a retained pick whose game had left the week (ADR-0019) |
| `MovedPickTeam` | `pickem-picks.tsx` | Same |
| `formatSigned` | `pickem-standings-table.tsx` | Nothing signed is displayed once `Diff` goes |
| `STANDINGS_SORT_COLUMN.DIFFERENTIAL` | `pickem-standings-table.tsx` | ADR-0018 decision 4 |
| `WEEK_2` | `sim/scenarios/timing.ts` | `week-move` was the only scenario that declared it |

`pickemStandingsQueryPrefix` survives but is no longer exported: `useRepick` was
its only external caller, and it is still the derivation `pickemStandingsQueryKey`
is built from.

Kept deliberately, and why (each was checked rather than assumed):

- **`openSelections`** — and it matters *more* than it did. A game locking under
  an open sheet used to cost one pick; under submit-once the write path refuses
  the whole set with `pick_locked`, so it would cost the week.
- **`pickProgressLabel`** — the sheet still counts toward a target, and the
  string is asserted literally by the e2e journey.
- **`pickMargin` / `settledMarginLabel`** — grading and the per-pick margin
  phrase, which ADR-0018 says survive on their own merits.
- **`rankLabel` / `sharedRankCounts`** — `T-1` is the shared rank *notation*,
  not a value shown behind it. ADR-0018 decision 4 forbids a separator between
  tied members; it requires the tie to be visible.

---

## 4. Integration test-count reconciliation

`472 → 472`, net zero. One case changed subject:

**`sim-fixtures.test.ts`** — "lists a scenario's fixtures ordered by kickoff and
filters by weekType/weekNumber" was the library's only consumer of `week-move`,
which it used because that scenario declared two weeks and its declaration order
disagreed with its kickoff order. Retargeted to `mixed-week`, and the ordering
assertion is now *stronger* rather than weaker: the test `PATCH`es one fixture's
kickoff past the last game's and asserts the list reorders, which proves ordering
is by kickoff independent of declaration or insertion order — a fact the old
version borrowed from a fixture quirk. The week filters are pinned by inclusion
(`weekNumber=1` returns all four) and exclusion (`weekNumber=2` and
`weekType=postseason` return nothing).

**Coverage genuinely lost, stated rather than hidden:** no library scenario now
spans two weeks, so the *positive* multi-week filter case (`weekNumber=2`
returning that week's games) is gone. It was only ever reachable through the
week-move fixture. Nothing in the product depends on it that the negative case
does not also cover, and a future multi-week scenario restores it with its own
reason for existing.

---

## 5. How completeness and the confirmation are wired

`apps/web/src/components/league/pickem-picks.tsx`:

```ts
const required = requiredPickemPickCount(picksAllowed, slate.games);
const complete = required > 0 && selections.size === required;
```

That is the **same function** `apps/api/src/services/pickem/picks.ts` validates
the submission with, imported from `packages/schemas` — no web-side restatement,
and no second home for the rule. The web passes the wire's `picksAllowed` as the
cap and the API passes `settings.picksPerWeek`; the function's docblock carries
the proof that the two agree
(`min(min(p, pickable), unlockedPickable) === min(p, unlockedPickable)`).

`locked` and `pickable` arrive **server-computed on the slate** (arch D11), so
nothing here reads a browser clock — which is the whole point under the
simulator, where the browser sits at a different instant than the API.

The confirmation is an `AlertDialog` in the same idiom as the settings-reset
warning (`settings-section.tsx`): `AlertDialogTrigger render={<Button …/>}`
carrying the disabled state, `AlertDialogCancel` / `AlertDialogAction` in the
footer, both disabled while the mutation is pending. The action, not the
trigger, fires the PUT — so a member who opens the dialog and cancels has
submitted nothing. It is keyboard-operable and labelled by construction
(`AlertDialogTitle` / `AlertDialogDescription`), and its copy names the
irreversibility concretely: "These picks are final for the week… Once they're in
they can't be changed, replaced, or removed", with the ATS variant adding "at the
spreads shown".

---

## 6. Notes for the reviewer

- **The Save control is now named "Submit picks", not "Save picks".** There is
  no draft to save — the sheet never touches the server until the one write —
  and the verb is what the confirmation dialog then repeats. This changes a
  string `e2e/pickem-journey.sim.spec.ts` addresses by role name in five places;
  SIMP-14 owns that journey and must go through the dialog regardless.
- **An ATS game with no posted line holds the whole week.** It counts toward
  `requiredPickemPickCount` (which knows about locks, not spreads) but cannot be
  picked, so Submit can never enable until the odds sync lands. That is exactly
  what the server would do with such a submission (`spread_unavailable`), so the
  sheet mirrors the rule rather than inventing one — and the action bar says why,
  because a dead Submit button with no explanation is the failure mode the
  deleted `hasOperableControl` existed to prevent.
- **`pick_locked` now refetches the slate, alongside `spread_stale`.** Both mean
  the slate the member assembled against has moved. Under submit-once a rejected
  sheet is their only attempt at the week until they can build a valid one, so
  leaving a now-unpickable row on screen would strand them. This is one line
  beyond the packet's "keep `spread_stale` handling" and is called out here
  rather than left to be discovered.
- **A submitted row prices both sides from `pick.spread`.** The packet requires
  the held side to show `spread_at_pick`; showing the live line on the other
  side would be the moved-line information this deliverable deletes, and a bare
  team with no number beside a signed one reads as a rendering fault. Both sides
  render the accepted number, which is simply that number seen from each side.
- **`QueryState` still renders a "Loading…" line rather than skeletons.** The
  shared component has no skeleton slot; retrofitting it is LNCH-8's ticket, and
  this deliverable keeps every view behind it rather than hand-rolling a
  replacement.
- **No `apps/web` unit test asserts completeness**, deliberately. The rule is
  table-driven in `packages/schemas/src/pickem.test.ts`, where both call sites
  share it; a second home is how the two surfaces would come to disagree. The
  packet directs this explicitly, overriding the plan's earlier note.
- **"Nothing behind the rank" is pinned as the sort-column set.** `apps/web` has
  no DOM test environment (`vitest.config.ts`: `environment: "node"`, and the
  unit glob is `*.test.ts`), so there is no seam here at which to assert rendered
  markup — role-and-name UI assertions live in Playwright. The available
  contract is `STANDINGS_SORT_COLUMN`: every member of it is a header, a cell and
  a sort at once, so a tiebreaker cannot return to the board without appearing in
  that list first. The row type no longer carries a differential at all, which is
  the structural half of the same guarantee. A rendered assertion belongs in
  SIMP-14's journey.
- **The standings fixture was rebuilt, not patched.** Its old ranks encoded the
  deleted rule — three members level on points carried ranks 1, 2, 1 because
  differential had separated them. They now share rank 1 with the next member at
  rank 4, and one of them reaches three points via two wins and two half-point
  pushes, which keeps the fixed 0.5 honest in the same fixture.
- **Operator-facing scenario lists were corrected** where they would otherwise
  advertise a deleted scenario: `docs/simulator-guide.md` (seven → six, slug list)
  and `docs/agents/verification-runbook.md`'s slug list. The simulator guide also
  now says, in one parenthetical, that `docs/runbooks/pickem-regression.md` still
  drives `week-move` until **SIMP-13** rewrites it — that runbook is SIMP-13's
  file and was deliberately left alone.
- **Still outstanding from D4's flags, unchanged and not this ticket's:**
  `packages/db/src/schema/pickem.ts:68-81` justifies the per-week uniqueness
  constraint with a week-move scenario ADR-0019 makes unreachable. The constraint
  itself stands (ADR-0018 keeps it); only the comment's reasoning is stale.
