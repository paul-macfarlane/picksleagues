# Repository gates

Run 2026-08-07 on `feat/elm-3-survivor-week-settlement` at `3e514f5`,
the branch tip carrying both code commits.

| Gate | Command | Result |
| --- | --- | --- |
| format | `pnpm format:check` | PASS |
| lint | `pnpm lint` | PASS |
| typecheck | `pnpm typecheck` | PASS |
| unit | `pnpm test` | PASS — 518 tests, 29 files |
| e2e (merge gate) | `pnpm test:e2e` | PASS — 13 tests |

`pnpm contract:check`, `pnpm test:integration` and the web build are not run:
this change adds no schema, no route, no database access and no web file, so
none of the three can observe it. `pnpm test:e2e` is run anyway — it is the
unconditional merge gate, not a surface-conditioned one.

## `pnpm format:check`
```
$ prettier --check .
Checking formatting...
All matched files use Prettier code style!
```

## `pnpm lint`
```
$ eslint .
```

## `pnpm typecheck`
```
$ pnpm -r typecheck && tsc -p e2e/tsconfig.json
Scope: 7 of 8 workspace projects
packages/schemas typecheck$ tsc
packages/schemas typecheck: Done
packages/scoring typecheck$ tsc
packages/db typecheck$ tsc
packages/core typecheck$ tsc
packages/scoring typecheck: Done
packages/core typecheck: Done
packages/db typecheck: Done
apps/api typecheck$ tsc
apps/web typecheck$ tsc -b
apps/web typecheck: Done
apps/api typecheck: Done
```

## `pnpm test`
```
$ vitest run --project unit

 RUN  v4.1.10 /Users/paulmacfarlane/code/picksleagues


 Test Files  29 passed (29)
      Tests  518 passed (518)
   Start at  19:20:43
   Duration  969ms (transform 1.66s, setup 0ms, import 4.04s, tests 271ms, environment 2ms)

```

## `pnpm test:e2e`

The suite is untouched by this change — no e2e path reaches the new module
until ELM-4 integrates it — so this proves the package still builds and
imports cleanly into the API, not new behaviour.

```
$ playwright test

Running 13 tests using 5 workers

  ✓   5 [chromium] › e2e/identity.spec.ts:70:3 › identity › preserves the intended destination through the claim-username gate (1.8s)
  ✓   4 [chromium] › e2e/identity.spec.ts:44:3 › identity › unclaimed session is gated to /claim-username; invalid submit errors inline; a valid claim reaches the dashboard (2.1s)
  ✓   2 [chromium] › e2e/identity.spec.ts:177:3 › identity › delete account signs out immediately and the session cannot return (2.2s)
  ✓   8 [chromium] › e2e/smoke.spec.ts:10:1 › unauthenticated visit redirects to sign-in and the API is reachable (408ms)
  ✓   3 [chromium] › e2e/identity.spec.ts:95:3 › identity › profile edit: Save gates on a real change, success toasts and updates the account menu, a taken username errors inline (2.6s)
  ✓   7 [chromium] › e2e/sim-panel.spec.ts:109:3 › simulator › a non-admin cannot see the simulator route (600ms)
  ✓   6 [chromium] › e2e/sim-panel.spec.ts:26:3 › simulator › an admin reaches the simulator section and every tab renders its cards (1.1s)
  ✓   1 [chromium] › e2e/league-lifecycle.spec.ts:12:3 › league lifecycle › create → invite → second user joins → both appear on league home (4.0s)
  ✓   9 [simulated] › e2e/pickem-journey.sim.spec.ts:276:3 › Pick'em merge-gate journey (mixed-week scenario) › commissioner creates a Pick'em league; a second member joins via invite (1.0s)
  ✓  10 [simulated] › e2e/pickem-journey.sim.spec.ts:309:3 › Pick'em merge-gate journey (mixed-week scenario) › both members commit week 1 as one irreversible full set (1.2s)
  ✓  11 [simulated] › e2e/pickem-journey.sim.spec.ts:363:3 › Pick'em merge-gate journey (mixed-week scenario) › before kickoff, another member's picks are hidden behind a count (330ms)
  ✓  12 [simulated] › e2e/pickem-journey.sim.spec.ts:390:3 › Pick'em merge-gate journey (mixed-week scenario) › past one kickoff: that pick locks, is revealed, and the week refuses a second submission (522ms)
  ✓  13 [simulated] › e2e/pickem-journey.sim.spec.ts:464:3 › Pick'em merge-gate journey (mixed-week scenario) › after every game goes final, settlement produces the expected standings (577ms)

  13 passed (13.8s)
```
