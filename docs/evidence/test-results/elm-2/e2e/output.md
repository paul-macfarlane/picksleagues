# ELM-2 — merge gate (`pnpm test:e2e`)

Playwright against the full local stack with `SimulatedProvider` and the
simulated clock — no network mocks anywhere. The suite brings up its own stack
on its own database (`picksleagues_e2e`) and its own ports (5273/3100), so it
never touches the dev database.

Run against the integrated branch tip `9dc144f`.

```
$ playwright test
[WebServer] $ tsx watch --env-file=../../.env src/dev.ts
[WebServer] $ vite

Running 13 tests using 5 workers

  ✓   2 [chromium] › e2e/identity.spec.ts:70:3 › identity › preserves the intended destination through the claim-username gate (1.4s)
  ✓   1 [chromium] › e2e/identity.spec.ts:44:3 › identity › unclaimed session is gated to /claim-username; invalid submit errors inline; a valid claim reaches the dashboard (1.6s)
  ✓   3 [chromium] › e2e/identity.spec.ts:177:3 › identity › delete account signs out immediately and the session cannot return (2.1s)
  ✓   8 [chromium] › e2e/smoke.spec.ts:10:1 › unauthenticated visit redirects to sign-in and the API is reachable (344ms)
  ✓   6 [chromium] › e2e/sim-panel.spec.ts:26:3 › simulator › an admin reaches the simulator section and every tab renders its cards (1.1s)
  ✓   4 [chromium] › e2e/identity.spec.ts:95:3 › identity › profile edit: Save gates on a real change, success toasts and updates the account menu, a taken username errors inline (2.5s)
  ✓   7 [chromium] › e2e/sim-panel.spec.ts:109:3 › simulator › a non-admin cannot see the simulator route (1.1s)
  ✓   5 [chromium] › e2e/league-lifecycle.spec.ts:12:3 › league lifecycle › create → invite → second user joins → both appear on league home (3.3s)
  ✓   9 [simulated] › e2e/pickem-journey.sim.spec.ts:276:3 › Pick'em merge-gate journey (mixed-week scenario) › commissioner creates a Pick'em league; a second member joins via invite (1.0s)
  ✓  10 [simulated] › e2e/pickem-journey.sim.spec.ts:309:3 › Pick'em merge-gate journey (mixed-week scenario) › both members commit week 1 as one irreversible full set (1.4s)
  ✓  11 [simulated] › e2e/pickem-journey.sim.spec.ts:363:3 › Pick'em merge-gate journey (mixed-week scenario) › before kickoff, another member's picks are hidden behind a count (322ms)
  ✓  12 [simulated] › e2e/pickem-journey.sim.spec.ts:390:3 › Pick'em merge-gate journey (mixed-week scenario) › past one kickoff: that pick locks, is revealed, and the week refuses a second submission (514ms)
  ✓  13 [simulated] › e2e/pickem-journey.sim.spec.ts:464:3 › Pick'em merge-gate journey (mixed-week scenario) › after every game goes final, settlement produces the expected standings (569ms)

  13 passed (13.3s)
```

**What this does and does not prove.** ELM-2 adds no e2e spec — the Survivor
journey is ELM-5's ticket, and the repo's rule is that E2E covers journeys, not
branches: every Survivor refusal, lock, and visibility rule ELM-2 introduces is
pinned at the integration layer instead (`suites/output.md`). What this run
proves for ELM-2 is the **regression** direction: the five pre-existing specs,
including the whole Pick'em journey through settlement, still pass over a branch
that widened the `listLeagueWeeks` gate, refactored the shared settings-reset
across modes, renamed a shared response component, and retyped `spreadLabel`'s
side parameter.
