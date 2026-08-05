# PR 2 — `pnpm test:e2e` (merge gate)

Run by the frontier orchestrator on the integrated branch, 2026-08-04, after the owner
corrected the standing claim that this command destroys dev data. It does not: the
stack is isolated on `picksleagues_e2e` at :5273/:3100 (`e2e/setup/e2e-env.ts`).

```
Running 14 tests using 5 workers

  ✓   4 [chromium] › e2e/identity.spec.ts:21:3 › identity › unclaimed session is gated to /claim-username; invalid submit errors inline; a valid claim reaches the dashboard (1.4s)
  ✓   1 [chromium] › e2e/identity.spec.ts:47:3 › identity › preserves the intended destination through the claim-username gate (1.7s)
  ✓   3 [chromium] › e2e/identity.spec.ts:72:3 › identity › profile edit: Save gates on a real change, success toasts and updates the account menu, a taken username errors inline (2.0s)
  ✓   2 [chromium] › e2e/identity.spec.ts:117:3 › identity › delete account signs out immediately and the session cannot return (2.0s)
  ✓   7 [chromium] › e2e/sim-panel.spec.ts:107:3 › simulator › a non-admin cannot see the simulator route (588ms)
  ✓   8 [chromium] › e2e/smoke.spec.ts:10:1 › unauthenticated visit redirects to sign-in and the API is reachable (308ms)
  ✓   6 [chromium] › e2e/sim-panel.spec.ts:26:3 › simulator › an admin reaches the simulator section and every tab renders its cards (1.0s)
  ✓   5 [chromium] › e2e/league-lifecycle.spec.ts:12:3 › league lifecycle › create → invite → second user joins → both appear on league home (3.1s)
  ✓   9 [simulated] › e2e/pickem-journey.sim.spec.ts:238:3 › Pick'em merge-gate journey (mixed-week scenario) › commissioner creates a Pick'em league; a second member joins via invite (1.1s)
  ✓  10 [simulated] › e2e/pickem-journey.sim.spec.ts:269:3 › Pick'em merge-gate journey (mixed-week scenario) › both members commit week 1 as one irreversible full set (1.3s)
  ✓  11 [simulated] › e2e/pickem-journey.sim.spec.ts:337:3 › Pick'em merge-gate journey (mixed-week scenario) › a cap shorter than the slate asks for the cap, then freezes to what was picked (578ms)
  ✓  12 [simulated] › e2e/pickem-journey.sim.spec.ts:383:3 › Pick'em merge-gate journey (mixed-week scenario) › before kickoff, another member's picks are hidden behind a count (444ms)
  ✓  13 [simulated] › e2e/pickem-journey.sim.spec.ts:418:3 › Pick'em merge-gate journey (mixed-week scenario) › past one kickoff: that pick locks, is revealed, and the week refuses a second submission (527ms)
  ✓  14 [simulated] › e2e/pickem-journey.sim.spec.ts:509:3 › Pick'em merge-gate journey (mixed-week scenario) › after every game goes final, settlement produces the expected standings (721ms)

  14 passed (14.7s)
```
