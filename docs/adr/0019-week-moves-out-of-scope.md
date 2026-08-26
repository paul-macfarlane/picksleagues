# 0019. Week moves are out of scope; an admin `cancelled` override covers the real case

- **Status:** Accepted (amended by [0046](0046-remove-sports-data-overrides.md): the `cancelled` override remedy becomes a documented SQL edit)
- **Date:** 2026-08-04
- **Supersedes in part:** [0015](0015-pickem-pick-entry-semantics.md) rule 2, insofar as it
  names `moved` as an unplayable status alongside `cancelled`
- **Related:** [0018](0018-pickem-atomic-immutable-weekly-submission.md) (the other four collapses
  of the same decision set); [0017](0017-pickem-pick-uniqueness-is-per-week.md) (the cross-week
  duplicate this makes unreachable); `docs/mvp-spec.md` §Game Mode 1 (Cancellations,
  Postponements & Re-picks); `docs/architecture.md` §Manual Sports Data Overrides, §Domain Model,
  D10, D15;
  backlog SIMP-2 (`backlog/12-simplification.md`)

## Context

The product models a **week move** — a game the provider repoints from one week to another —
as a first-class event, and pays for it in six places that are permanently live:

- a synthesized `MOVED` status in settlement, where a pick's week not matching its game's week
  produces a push (`apps/api/src/services/pickem/settlement.ts:152`,
  `game.weekId === weekId ? game.status : MOVED`);
- a read-path summary loader (`loadMovedGameSummaries`) whose only job is to describe such a
  pick back to the member;
- two UI branches, on the member's own sheet and on the league week detail;
- a simulator scenario that exists solely to drive it;
- and `moved` as a member of the wire `GameStatus` enum and of the admin status-override
  option set.

The NFL does not move games between weeks. Games get flexed to a different **time slot** inside
their week, which is a kickoff change and not this; games get postponed, which the product
already handles as a game played later in the same week; games get cancelled, which the product
already handles as a push. A genuine week move is a once-a-decade event: the clear modern
instance is the 2020 pandemic season, when the league did reshuffle games across weeks — under
a public-health emergency, with weeks of notice, and with the whole sport watching. That is the
scale of thing it takes, and it is the scale of thing an admin is certain to be aware of before
the product needs to grade anything.

Meanwhile the mechanism itself is fragile in a way its cost does not buy back. The synthesis
sits at the *provider* tier, below `override_status`, deliberately, because there is no
`override_week_id` and `sync-schedule` rewrites `games.week_id` on every run — so a persistent
provider error placing a game in the wrong week would otherwise make those picks permanently
uncorrectable. The admin's remedy for a bad week move is therefore *already* a status override.
Which raises the question this ADR answers: if the override is the remedy, what is the status
for?

## Decision

**Week moves are out of scope.** `moved` ceases to be a distinct game status:

- it leaves `GAME_STATUS` and therefore the wire enum and the generated client;
- it leaves the admin status-override option set;
- `UNPLAYED_GAME_STATUSES` shrinks to `cancelled` alone, so "will never be played in this week"
  and "cancelled" become the same statement;
- the settlement synthesis at `settlement.ts:152` is deleted — a pick's game now always grades
  by that game's own `override_status ?? status`, with the coalesce order unchanged.

**The once-a-decade real case is handled by an admin `cancelled` status override** on the moved
game. Under ADR-0018 a cancelled game's pick resolves as a push and the push stands, so the
affected members are made whole by a single admin action on one row, in the surface admins
already use for every other provider correction, with the `admin_audit` row that override
already writes.

### The accepted failure mode is silent cross-week grading, not stranding

This is the part worth stating precisely, because the intuitive description of the risk is the
wrong one. Nothing is *stranded*: a pick whose game left the week is not orphaned, does not
fail to load, and does not take settlement down.

The opposite happens. Settlement loads a week's picks and then loads their games **by
`pick.gameId`** (`settlement.ts:134-137`), not by week. With the `MOVED` synthesis deleted, a
genuinely moved game's old-week pick still loads its game, still finds a real final score, and
**grades against that game's result from its new week**. The member takes a real win or a real
loss in a week whose slate no longer contains the game. Their standings move, and every number
involved is internally consistent — which is exactly why nothing catches it. Once the moved
surfaces are deleted there is no branch, no status, no UI row and no log line in which the
divergence between the pick's week and the game's week can announce itself.

**Detection is therefore operational, not automatic.** An admin notices the move at
schedule-sync review and applies the `cancelled` override, after which the pick pushes like any
other cancellation. `docs/runbooks/pickem-regression.md` gains an operator note saying how such
a move would be noticed and what to do about it; that note is owed by SIMP-13 and is not
written here.

### Why the trade is accepted

A status that exists solely to model an event that does not occur costs a branch in settlement,
a read-path summary loader, two UI branches, a simulator scenario, and a wire enum member —
permanently, on every future change to any of them — against a failure the admin override
already covers. The cost is certain and recurring; the event is hypothetical. If the event does
occur, the remedy is one override away, and the window before an admin applies it is a
mis-graded pick in a friends-and-family pool, not a data-integrity failure.

## Consequences

**The product loses its only automatic detection of provider week movement.** Before this, a
move announced itself as a push and a labelled row; after it, a move is indistinguishable from
normal grading until a human looks. This is the whole of the accepted risk and it is not
mitigated in code — the mitigation is the runbook note (SIMP-13) and the override.

**ADR-0017's motivation becomes unreachable in practice, while its constraint stands.** The
cross-week duplicate pick that ADR-0017 legalized — the same game picked in week 1 and again in
week 2 — was reachable *only* through a week move. With moves out of scope, nothing in the
product produces that state. `unique (league_member_id, game_id, week_id)` nonetheless stays as
the per-week uniqueness backstop, for the same reason ADR-0018 keeps it: it is the constraint
the write path's duplicate check is checked against, and narrowing it back would be a migration
that buys nothing and re-introduces a rule the spec never contained.

**ADR-0015 rule 2 keeps its substance with a smaller set.** Unplayable games are still shown
but not pickable, still do not raise `picksAllowed`, and a submission naming one is still
`game_not_pickable`. The set is now `cancelled` alone. `postponed` remains deliberately
outside it.

**Easier.** `isUnplayedStatus` and the cancellation rule become the same idea under one name.
Settlement's game-status resolution is a plain `override_status ?? status` with no
week-comparison special case, which makes it the same rule as every other overridable field
(arch D15). The moved-pick read path, its UI branches, and the `week-move` simulator scenario
are deleted rather than maintained.

**Revisit if** the NFL actually moves a game between weeks and the operational path proves too
slow — the signal would be members noticing a mis-graded pick before an admin does. Restoring
the status is mechanical; restoring it *plus* the pick-side surfaces would be a larger rebuild,
and this ADR is the record of why they were removed together.
