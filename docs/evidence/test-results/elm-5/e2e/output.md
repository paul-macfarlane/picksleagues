# Merge gate — full Playwright run

Run against the integrated tip with the SimulatedProvider and the simulated clock, no
network mocks. The five pre-existing specs and the new Survivor journey in one run —
which is also the proof that the simulated project now serializes its spec files.

```
[WebServer] $ tsx watch --env-file=../../.env src/dev.ts
[WebServer] $ vite

Running 18 tests using 5 workers

  ✓   4 [chromium] › e2e/identity.spec.ts:70:3 › identity › preserves the intended destination through the claim-username gate (1.8s)
  ✓   1 [chromium] › e2e/identity.spec.ts:44:3 › identity › unclaimed session is gated to /claim-username; invalid submit errors inline; a valid claim reaches the dashboard (2.1s)
  ✓   3 [chromium] › e2e/identity.spec.ts:177:3 › identity › delete account signs out immediately and the session cannot return (2.2s)
  ✓   8 [chromium] › e2e/smoke.spec.ts:10:1 › unauthenticated visit redirects to sign-in and the API is reachable (398ms)
  ✓   5 [chromium] › e2e/identity.spec.ts:95:3 › identity › profile edit: Save gates on a real change, success toasts and updates the account menu, a taken username errors inline (2.6s)
  ✓   7 [chromium] › e2e/sim-panel.spec.ts:109:3 › simulator › a non-admin cannot see the simulator route (576ms)
  ✓   6 [chromium] › e2e/sim-panel.spec.ts:26:3 › simulator › an admin reaches the simulator section and every tab renders its cards (1.0s)
  ✓   2 [chromium] › e2e/league-lifecycle.spec.ts:12:3 › league lifecycle › create → invite → second user joins → both appear on league home (4.1s)
  ✓   9 [simulated] › e2e/pickem-journey.sim.spec.ts:276:3 › Pick'em merge-gate journey (mixed-week scenario) › commissioner creates a Pick'em league; a second member joins via invite (967ms)
  ✓  10 [simulated] › e2e/pickem-journey.sim.spec.ts:309:3 › Pick'em merge-gate journey (mixed-week scenario) › both members commit week 1 as one irreversible full set (1.3s)
  ✓  11 [simulated] › e2e/pickem-journey.sim.spec.ts:363:3 › Pick'em merge-gate journey (mixed-week scenario) › before kickoff, another member's picks are hidden behind a count (313ms)
  ✓  12 [simulated] › e2e/pickem-journey.sim.spec.ts:390:3 › Pick'em merge-gate journey (mixed-week scenario) › past one kickoff: that pick locks, is revealed, and the week refuses a second submission (530ms)
  ✓  13 [simulated] › e2e/pickem-journey.sim.spec.ts:464:3 › Pick'em merge-gate journey (mixed-week scenario) › after every game goes final, settlement produces the expected standings (579ms)
  ✓  14 [simulated] › e2e/survivor-journey.sim.spec.ts:234:3 › Survivor season journey (survivor-season scenario) › a Survivor league created through the form resolves to the four ingested weeks; two members join (1.4s)
  ✓  15 [simulated] › e2e/survivor-journey.sim.spec.ts:293:3 › Survivor season journey (survivor-season scenario) › week 15: all three pick, and settlement puts the one who backed a loser out (1.4s)
  ✓  16 [simulated] › e2e/survivor-journey.sim.spec.ts:351:3 › Survivor season journey (survivor-season scenario) › week 16: the eliminated member gets a verdict, not a sheet, and a change of pick sticks (1.0s)
  ✓  17 [simulated] › e2e/survivor-journey.sim.spec.ts:391:3 › Survivor season journey (survivor-season scenario) › week 17: the whole alive set busts, and the revival rule brings them back (593ms)
  ✓  18 [simulated] › e2e/survivor-journey.sim.spec.ts:417:3 › Survivor season journey (survivor-season scenario) › week 18: the season concludes and the survivors share first (612ms)

  18 passed (19.2s)
```
