# NFL weekly confidence playbook

For the owner's private production test leagues: three users in ATS Pick'em
(five picks/week), and three in Survivor (Elimination). About 25 minutes of
hands-on checks spread across a game week. Joining, dues, and basic submission
counts have already been checked; spend this pass on what happens next.

## Manual: the real production app

Use A (commissioner), B, and C in separate browser profiles; use a real phone for
at least B's submission. Record each test league URL, season/start week, and
user mapping. Confirm the test leagues actually include Week 1: a league created
after its first kickoff resolves to the next unstarted week. If so, run this
playbook in that week and rehearse Week 1 locally now.

Make picks only in the two test leagues. Production test leagues share the real
game feed and jobs with paying leagues: use ordinary member actions and observe
scheduled jobs. Keep resets, fixture changes, forced corrections, and repeated
settlement experiments in the local simulator. Picks and outcomes in production
are real and cannot be rewound for another pass.

### 1. Before kickoff — 10–15 minutes

- [ ] **Pick'em A:** select four picks; submission should require five while at
      least five priced games remain open. Select the fifth, open confirmation,
      then cancel: nothing submitted. Confirm for real. Record each team, game,
      and accepted signed spread. Reload/sign back in: all five persist and the
      week is immutable immediately, even before kickoff.
- [ ] **Pick'em B:** submit five on the phone, preferably including the opposite
      side of one of A's games and games from different kickoff slots. Confirm
      the submit/confirmation controls are reachable and the saved set persists.
      **C intentionally submits nothing all week** to test zero scoring.
- [ ] **Survivor A and B:** pick the same team to give the test league a chance
      of keeping two survivors for Week 2. Before kickoff, A changes to another
      unstarted game/team and back; reload each time to verify the saved choice.
      C intentionally misses the week. A/B winning or tying leaves two alive;
      A/B losing plus C missing should revive all three after the week settles.
      A cancellation also leaves A/B alive and returns their team for reuse.
- [ ] **Privacy:** as B, inspect A's League Picks before kickoff in both modes.
      Submission counts may show; teams, sides, accepted spreads, and outcomes
      must stay hidden. If comfortable with DevTools, check the corresponding
      picks response too: hidden data must be absent from the response, not just
      the screen. Never include cookies or auth headers in saved evidence.

### 2. Across a kickoff — 5 minutes

- [ ] Leave a picks view open across a chosen game's displayed kickoff. Check
      once without refreshing, then refresh and compare. Other members' picks
      for that game become visible; later games remain hidden. Record a stale
      screen separately from an incorrect response after refresh.
- [ ] Survivor A cannot change the now-locked pick to a later game. Pick'em A/B
      remain frozen. Locks follow kickoff time, even if a score sync is late.
      A live score of zero or a delayed score is not permission to pick.
- [ ] Check the game's score/status after the next scheduled score sync. The
      configured cadence is 15 minutes; allow provider publication and execution
      delay. If still wrong after two scheduled ticks, inspect the run details
      and provider data. A successful HTTP response alone is insufficient:
      `no_active_games` while a known game is live merits investigation.

### 3. Finals and Week 2 — 10 minutes

- [ ] **Pick'em:** after scores sync, independently grade A/B using their saved
      spreads: selected team's score minus opponent's score plus that team's
      accepted spread; positive = 1 point, zero = 0.5, negative = 0. A cancelled
      game pushes for 0.5. Check each verdict, W/L/P, weekly total, season total,
      and tied ranks. C gets zero, with no invented picks or losses.
- [ ] **Survivor:** check the completed week's board against the A/B/C cases
      above. Missed-pick elimination waits for the entire week's games to become
      terminal; a postponement can delay it. Some losses can settle earlier once
      another member is confirmed safe. A normal win/tie consumes the team;
      cancellation returns it. A revival does not return losing teams.
- [ ] **Reconciliation:** compare results again after the next scheduled sweep.
      With unchanged inputs, points, picks, and Survivor status must stay the
      same. Record job success/time and observable data, not only absence of errors.
- [ ] **Week 2:** for Pick'em A/B, next-week picking opens when every game in
      their submitted set is terminal; C waits until the app's week turns over.
      Survivor A/B can pick ahead after a safe result; a loss/missed pick grants
      no early access. Eliminated members cannot pick after elimination settles.
      Use the app's ingested week window, not Monday midnight, as the boundary.
- [ ] In Week 2, verify ATS lines exist, submit a new five-pick set, and confirm
      Week 1 history remains intact. Verify Survivor rejects consumed teams and
      accepts a fresh team for eligible members. After Week 2 settles, Pick'em's
      season total must equal Week 1 + Week 2. If Survivor has only one survivor,
      conclusion is correct; continue multiweek testing in the simulator.

For repeat weeks, shorten this to: one saved submission per mode, one kickoff
privacy/lock check, one independently graded result, and the next-week opening.
Do not wait for rare real cancellations, ties, or line changes to test them.

## Automated: reuse the existing safety net

Run the existing gate before weekly releases and before the next slate when
confidence is needed. CI already runs on PRs and pushes to `staging`; no recurring
schedule has been added by this playbook. Follow [verification.md](verification.md)
for setup. Integration and E2E suites must run one at a time across sessions.
Confirm their database targets are local disposable test databases first.

```sh
pnpm test
pnpm test:integration
pnpm test:e2e
```

Keep the full CI gate for changes (including its static checks and web build).
For a focused browser rerun:

```sh
pnpm test:e2e e2e/pickem-journey.sim.spec.ts e2e/pickem-ats-journey.sim.spec.ts e2e/survivor-journey.sim.spec.ts
```

Playwright includes the dependent Chromium project. A skipped journey is not a
pass. These tests use disposable local data and minted sessions: they do not
prove real OAuth, production deployment configuration, or the live ESPN feed.
The production manual pass supplies that evidence.

| Weekly risk | Executable coverage |
| --- | --- |
| ATS five-pick submission → accepted line → final grade → Week 2 | `e2e/pickem-ats-journey.sim.spec.ts`: three members, six priced games per week, phone submission, a non-submitter, kickoff reveal, weekly history, cumulative totals and tied ranks. |
| Spread moves while confirmation is open | The ATS journey changes a fixture line, syncs odds, verifies the stale submission saves nothing, then resubmits without reselecting. A later line change must not alter the saved line or grade. |
| Next week opens when the member's set resolves | The ATS journey submits Week 2 after the five selected games finish while the sixth is still unstarted. The non-submitter waits for the week boundary. |
| Survivor pick/change → elimination → next week → revival/end | Existing three-member, four-week `survivor-journey.sim.spec.ts`; API/unit tests cover missed picks, consumption, cancellation, and repeated settlement. |
| Default job targeting and automatic settlement | The ATS journey calls jobs without explicit week arguments and asserts scores/standings before a sweep can repair them. Repeated sweeps must preserve domain results. Job integration tests cover default targeting and next-week odds. |

The ATS journey's test-only `e2e/setup/ats-season.ts` fixture goes through the
ordinary simulated provider and sync jobs. Expected totals are independent of
production scoring code: A scores 3.5 then 1.5, B scores 1.5 then 3.5, C scores
zero twice; A and B finish tied at 5. The fixture is not added to the production
simulator library. The `*.sim.spec.ts` filename automatically includes the journey
in `pnpm test:e2e` and the existing CI gate, serialized with the other simulator
journeys.

Use [pickem-regression.md](pickem-regression.md) Passes 2, 4, 5, and 6 for local
ATS edge cases now, and [survivor-regression.md](survivor-regression.md) for the
continuous season rehearsal. Their checked boxes are previous evidence, not
proof of a fresh run. Record a new dated result instead of assuming they passed.

## Findings and severity

Prioritize impact on the real 12-person/7-person leagues and the next affected
kickoff. Test gaps are not confirmed product bugs.

| Severity | Examples | Response |
| --- | --- | --- |
| P0 — integrity/privacy | Picks leak before kickoff; a late pick is accepted; confirmed picks disappear; wrong grading changes who wins or survives | Investigate immediately; preserve evidence and identify affected leagues before any correction. Fix and verify before the next affected game where possible. |
| P1 — weekly workflow blocked | Eligible users cannot submit; next week never opens; available odds do not ingest; score/settlement pipeline repeatedly fails | Same-day investigation, with priority increasing as kickoff approaches. |
| P2 — recoverable display problem | Saved picks appear only after reload; stale board while server data is correct | Fix in the next patch; escalate if it causes missed submissions or conceals incorrect outcomes. |
| P3 — cosmetic | Spacing or copy issue with no effect on picking or interpreting results | Batch after weekly correctness work. |

For each failure, record: environment/build (if known), league URL, user alias,
week/game, timestamp with timezone, steps, expected vs actual, screenshot,
sanitized response/error, whether refresh helps, and affected real users. Reproduce
with the local simulator; add a failing test at the cheapest useful layer. File
confirmed work under the appropriate existing `backlog/` epic with its next stable
ID and severity, then fix → rerun regression → review → PR to `staging`. Scoring,
locking/visibility, and settlement fixes require the independent evaluator.

**Initial review, 2026-09-08:** no production bug confirmed; production has not
been exercised by the agent. All 627 unit tests across 38 files passed via the
installed Vitest CLI. `pnpm test` itself hit pnpm's non-TTY dependency-reinstall
prompt before running tests; dependencies were not purged or reinstalled.
This review identified the ATS five-pick, two-week browser journey as the
highest-priority gap; the subsequent implementation above closes it.

**Automated follow-up, 2026-09-08, source `c2149e4`:** integration passed
642 tests across 36 files (41.7s). Browser suite passed 19 tests (31.0s),
including the Pick'em and four-week Survivor journeys; only the opt-in visual
capture was skipped. No application failure was reproduced. Integration used
local `picksleagues_test`; E2E used local `picksleagues_e2e` in a temporary source
copy with disposable credentials. The copy reused installed dependencies and
needed a temporary Vite allow-list entry for those dependencies' fonts; the
reported browser result is the rerun after that correction. Production was not
touched. Existing installed CLIs were used, with pnpm's automatic dependency
reinstall disabled for E2E server startup; no dependencies were changed.

**ATS journey added, 2026-09-08:** all five new stages passed in a targeted run,
then the full browser suite passed **24 tests in 49.0s**, with only the optional
visual capture skipped. E2E TypeScript checking, lint on changed test files, and
formatting passed. Independent review approved the test changes after strengthening
the early Week 2 boundary. Failures during authoring were fixture-request and
browser-locator/timing issues in the new tests; no application bug was reproduced.
Verification used the same isolated local setup described above. The journey is
included automatically by the existing Playwright/CI configuration once these
changes land.
