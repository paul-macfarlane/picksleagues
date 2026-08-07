# `settleSurvivorWeek` unit suite

Run 2026-08-07 on `feat/elm-3-survivor-week-settlement` at `3e514f5`.
Command: `pnpm test --project unit packages/scoring/src/survivor.test.ts --reporter=verbose`

One case per rule in spec §Game Mode 2, plus the purity property arch D10
requires of every settlement output. No database and no running stack — this
package is pure by rule.

```
$ vitest run --project unit --project unit packages/scoring/src/survivor.test.ts --reporter=verbose

 RUN  v4.1.10 /Users/paulmacfarlane/code/picksleagues

 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — grading one member's pick > 'rode the home side and it won → corre…' 1ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — grading one member's pick > 'rode the away side and it won → corre…' 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — grading one member's pick > 'rode the home side and it lost → inco…' 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — grading one member's pick > 'rode the away side and it lost → inco…' 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — grading one member's pick > 'won by one → correct' 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — grading one member's pick > 'tie, advance-and-consume → push, adva…' 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — grading one member's pick > 'tie, eliminate → push, eliminated, te…' 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — grading one member's pick > 'cancelled game, advance setting → pus…' 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — grading one member's pick > 'cancelled game, eliminate setting → s…' 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — missed picks > eliminates an alive member who submitted nothing, writing no outcome row 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — missed picks > eliminates a member who missed the week even though others picked 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — missed picks > does not eliminate a member who was already out — a missed pick is only a rule for the alive 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — no zombie grading > ignores 'a winning pick' by a member who is already out 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — no zombie grading > ignores 'a losing pick' by a member who is already out 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — everyone eliminated in the same week > revives every member when they all busted on wrong picks 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — everyone eliminated in the same week > revives on a mix of wrong picks and missed picks 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — everyone eliminated in the same week > revives on a mix that includes a fatal tie 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — everyone eliminated in the same week > restores the life only — teams the busting picks spent stay spent 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — everyone eliminated in the same week > does not revive when one member survived 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — everyone eliminated in the same week > does not fire on an empty alive set — nobody entered, so nobody came back 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — the whole slate is cancelled > returns every picker's team and still eliminates the member who missed the week 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — an incomplete week grades to nothing > holds the week open on a game that is 'still scheduled' 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — an incomplete week grades to nothing > holds the week open on a game that is 'in progress' 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — an incomplete week grades to nothing > holds the week open on a game that is 'postponed' 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — an incomplete week grades to nothing > holds the week open on an unpicked game — a member with no pick can still make one 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — an incomplete week grades to nothing > surfaces a final game with no scores rather than grading against a missing number 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — an incomplete week grades to nothing > lets a scoreless final nobody live picked pass — it decides nothing 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — an incomplete week grades to nothing > does not treat a cancelled game as incomplete 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — an incomplete week grades to nothing > reports one entry per blocking game, however many members picked it 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — a threaded season > leaves co-winners alive at the end week, with nothing ranking them (spec §End of League) 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — a threaded season > carries a revival forward into the next week 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — purity > returns the same settlement for the same inputs (arch D10 — settlement is a derivation) 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — purity > mutates none of its inputs 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — loader and write-path bugs are surfaced, not graded around > throws when a pick references a game absent from the results 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — loader and write-path bugs are surfaced, not graded around > throws for an absent game even when the picker is already out 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — loader and write-path bugs are surfaced, not graded around > throws when a pick rides a team that is not in its game 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — loader and write-path bugs are surfaced, not graded around > throws when one member holds two picks for the week 0ms
 ✓ |unit| packages/scoring/src/survivor.test.ts > settleSurvivorWeek — loader and write-path bugs are surfaced, not graded around > throws for a duplicate held by a member who is already out — same broken write 0ms

 Test Files  1 passed (1)
      Tests  38 passed (38)
   Start at  19:20:26
   Duration  250ms (transform 96ms, setup 0ms, import 160ms, tests 6ms, environment 0ms)

```
