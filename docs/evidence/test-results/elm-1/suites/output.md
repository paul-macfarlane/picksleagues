# ELM-1 — unit, integration, and the e2e merge gate

Run on the integrated branch after all three deliverables landed. Real
dependencies throughout: the integration suite runs in-process Hono against real
Postgres (`picksleagues_test`), and the e2e suite brings up its own full stack on
its own database and ports. No mocks anywhere.

## `pnpm test` — unit

```
 RUN  v4.1.10 /Users/paulmacfarlane/code/picksleagues

 Test Files  27 passed (27)
      Tests  469 passed (469)
   Duration  947ms
```

## `pnpm db:up && pnpm test:integration`

```
 Container picksleagues-db-1 Healthy

$ vitest run --project integration
 RUN  v4.1.10 /Users/paulmacfarlane/code/picksleagues

 Test Files  30 passed (30)
      Tests  553 passed (553)
   Duration  28.86s
```

Covers the season-range resolution criteria against real Postgres:
mid-week resolution, the no-games provisional-season fallback, never-born-
already-started, the range-exhausted `start_week_passed` refusal, and both
halves of the renewal behaviour (verbatim copy, then re-resolution on the next
pre-start save).

## `pnpm test:e2e` — the merge gate

```
Running 13 tests using 5 workers

  ✓   5 [chromium] › e2e/identity.spec.ts:70:3 › identity › preserves the intended destination through the claim-username gate (1.2s)
  ✓   4 [chromium] › e2e/identity.spec.ts:44:3 › identity › unclaimed session is gated to /claim-username; invalid submit errors inline; a valid claim reaches the dashboard (1.9s)
  ✓   2 [chromium] › e2e/identity.spec.ts:177:3 › identity › delete account signs out immediately and the session cannot return (2.1s)
  ✓   8 [chromium] › e2e/smoke.spec.ts:10:1 › unauthenticated visit redirects to sign-in and the API is reachable (310ms)
  ✓   6 [chromium] › e2e/sim-panel.spec.ts:26:3 › simulator › an admin reaches the simulator section and every tab renders its cards (1.3s)
  ✓   7 [chromium] › e2e/sim-panel.spec.ts:109:3 › simulator › a non-admin cannot see the simulator route (561ms)
  ✓   3 [chromium] › e2e/identity.spec.ts:95:3 › identity › profile edit: Save gates on a real change, success toasts and updates the account menu, a taken username errors inline (2.6s)
  ✓   1 [chromium] › e2e/league-lifecycle.spec.ts:12:3 › league lifecycle › create → invite → second user joins → both appear on league home (3.2s)
  ✓   9 [simulated] › e2e/pickem-journey.sim.spec.ts:276:3 › Pick'em merge-gate journey (mixed-week scenario) › commissioner creates a Pick'em league; a second member joins via invite (1.0s)
  ✓  10 [simulated] › e2e/pickem-journey.sim.spec.ts:309:3 › Pick'em merge-gate journey (mixed-week scenario) › both members commit week 1 as one irreversible full set (1.3s)
  ✓  11 [simulated] › e2e/pickem-journey.sim.spec.ts:363:3 › Pick'em merge-gate journey (mixed-week scenario) › before kickoff, another member's picks are hidden behind a count (312ms)
  ✓  12 [simulated] › e2e/pickem-journey.sim.spec.ts:390:3 › Pick'em merge-gate journey (mixed-week scenario) › past one kickoff: that pick locks, is revealed, and the week refuses a second submission (490ms)
  ✓  13 [simulated] › e2e/pickem-journey.sim.spec.ts:464:3 › Pick'em merge-gate journey (mixed-week scenario) › after every game goes final, settlement produces the expected standings (573ms)

  13 passed (13.2s)
```

All five pre-existing specs stay green — the Pick'em journey in particular, which
is the regression signal that mattered here: the season-range resolution helper
this work package extracted and made mode-neutral is the one Pick'em's own league
creation runs through.
