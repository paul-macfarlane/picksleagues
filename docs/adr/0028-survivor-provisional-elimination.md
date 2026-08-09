# 0028. A Survivor member goes out as soon as their loss is certain

- **Status:** Accepted
- **Date:** 2026-08-08
- **Related:** `docs/mvp-spec.md` §Game Mode 2 (Core Rules — Missed pick, Everyone eliminated in
  the same week, Eliminated members cannot pick; unchanged by this ADR),
  §Standings View; `docs/architecture.md` §Settlement & Scoring, D10;
  [0025](0025-survivor-team-ledger-and-prefix-ordered-settlement.md) (the unit-grading model
  and the prefix ordering this extends),
  [0027](0027-survivor-season-ends-at-a-sole-survivor.md) (the ending derived from the alive
  set this can now reduce mid-week),
  [0019](0019-week-moves-out-of-scope.md) (a real week move arrives as a `cancelled`
  override); backlog ELM-11

## Context

**A Survivor week grades as a unit** (ADR-0025). The grader refuses to touch a week holding
any game that is not yet terminal, because the mode's two headline rules are week *totals*
rather than facts about one pick: whether a member **missed** their pick is not knowable
while a game they could still take is unstarted, and whether **everyone alive busted** —
the revival rule — is a count over the whole slate. A partial grade would have to be revised
by a later run, and the thing it would revise is who is still in the league.

The owner drove a Survivor league, advanced the simulator past one game of a week, synced
the scores, and found the member who had backed the losing team still reading **alive** on
the board. The elimination only landed once the last game of that week went final. That is
today's behaviour working exactly as designed, and it reads as a missed elimination: the
result is on the screen, the member's team lost on it, and the board says nothing happened.

The unit rule is right about *why* it exists and wrong about *how much* it withholds. The
two week-total questions above are the only ones that need the whole slate. A member whose
own pick has already been graded and lost is not waiting on a total — they are waiting on
the possibility that the week ends up reviving them.

## Decision

**1. A member is eliminated before their week completes if and only if at least one member
who entered the week alive has a graded pick that does not eliminate them.** A win, or a
push they advance on under `pushTieResolution` — a cancelled game always, a tied final when
the setting says advance. Call that member a *confirmed survivor*. Once one exists, every
alive member whose own pick is graded and eliminating goes out immediately.

The condition is exactly the negation of the revival rule. Revival fires only when *every*
member who entered the week alive leaves it eliminated (spec §Game Mode 2 — Everyone
eliminated in the same week), so one confirmed survivor makes revival provably impossible
for that week, whatever the ungraded games go on to do. With revival off the table, a
graded losing pick is a final answer, and holding it back buys nothing but the delay the
owner hit.

**This protects the pick-in-the-gap rule rather than breaking it, and that is the
non-obvious part.** ADR-0025 lets a member who has already busted keep submitting picks
until their elimination settles, *because* revival might bring them back and their next
week's pick has to be sitting there legitimately when it does. Eliminating them early would
refuse them that pick — the endpoint refuses a member whose settled state says eliminated.
The confirmed-survivor test is precisely the guarantee that this member will **not** be
revived, so the pick it denies them is one they could never have used. The two rules agree
by construction: the gap stays open for exactly as long as revival is still possible, and
closes the moment it isn't.

**2. Eliminations only — no result rows are written early.** The provisional pass writes
`survivor_state` and nothing else. It is tempting to grade every terminal pick mid-week so
the outcome badges appear sooner, and it is wrong: a graded outcome carries `teamConsumed`,
which feeds the `released` ledger, and `resolveReleasedFlags` groups a member's picks across
*weeks* to apply ADR-0025's sticky-release rule. That rule is a whole-season answer — it
looks forward from a released pick to every later pick of the same team — so feeding it a
partial week's consumption data is where it would quietly produce a ledger a full recompute
would not reproduce.

The accepted consequence: a provisionally eliminated member sees that they are out while
their own pick still shows no outcome badge until the week finishes grading. The board's
existing "not graded yet" notice covers it, and a wrong ledger would not.

**3. A missed pick is never provisional.** Only a member whose *own* pick is graded and
eliminating may go early. A member with no pick can still legally take any game in the week
that has not started, so "they missed it" is not true until nothing is left to pick — which
is the spec's own wording, "resolved at settlement after the week completes" (§Game Mode 2 —
Missed pick), and it stands unchanged.

**4. The replay still stops after a partly graded week.** The alive set a partly graded week
leaves is not final — the ungraded picks in it have yet to say anything — so week N+1 must
not be graded against it. The prefix invariant (ADR-0025 decision 6) is untouched: the
provisional pass runs *before* the replay's existing stop on an unsettled week, and the stop
still happens.

**5. The complete-week grader is not modified.** `settleSurvivorWeekProvisionally` sits
beside `settleSurvivorWeek` in `packages/scoring/src/survivor.ts` as a separate pure
function, returning the member ids a partly graded week has already decided and an empty
list — the ordinary case — when no confirmed survivor exists yet. The complete grader is the
most exhaustively tested thing in the repository and the correctness of every settled season
rests on it; a rule about *incomplete* weeks earns its own function rather than a branch
inside that one.

**6. It is derived, like everything else settlement writes.** A full rebuild re-runs the
provisional pass and reproduces the same `survivor_state` (arch D10), and when the week later
completes the complete grade produces the same eliminations plus whatever else the week
decided — a superset, never a contradiction, because the complete grade eliminates on the
same graded picks plus the ones that were still open. Both properties are pinned by tests
rather than argued here.

## Consequences

**The board tells a member they are out as soon as it is true, which is the whole point.**
The lag the owner hit was between a result being on screen and the board acting on it, and
it is now zero for a member whose loss is certain — while a week that could still revive
everybody keeps every one of them alive, exactly as before.

**A season can be decided mid-week, and that is correct rather than a surprise.** ADR-0027
ends a season the moment settlement reduces the league to one member alive, derived from
`survivor_state`. A provisional elimination that leaves one member alive therefore ends the
season before the week finishes — and it should: the members it put out cannot be revived,
so nothing later in that week can change who won.

**A provisionally eliminated member's own pick carries no outcome until the week finishes.**
Decision 2's cost, paid deliberately. Their `survivor_state` row says eliminated and names
the week; `survivor_pick_results` gains its row when the week grades as a unit.

**The completeness rule now has a partner that must not drift from it.** "Which picks can be
graded on their own" is stated in the provisional pass and, from the opposite end, in the
complete grader's blocking check — a game is terminal and, if final, carries both scores.
Two expressions of one test, coupled by comments in each, for the same reason `season.ts`
and `settlement.ts` already restate week completeness at each other.

**Revisit if** lives > 1 ever ships: a member with a life left does not go out on a losing
pick at all, so the confirmed-survivor test stops being the whole safety argument and the
rule needs restating against lives rather than against elimination.
