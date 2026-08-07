# 0018. A Pick'em week is one atomic, immutable submission

- **Status:** Accepted
- **Date:** 2026-08-04
- **Supersedes in part:** [0015](0015-pickem-pick-entry-semantics.md) rule 1 (whole-week replace
  with a retention boundary) and the PKM-7 substitute path it required; [0017](0017-pickem-pick-uniqueness-is-per-week.md)'s
  *motivation* — its constraint stands
- **Related:** [0019](0019-week-moves-out-of-scope.md) (week moves out of scope — the fifth collapse
  of the same decision set); `docs/mvp-spec.md` §Game Mode 1 (Core Rules, Locking, ATS spread
  acceptance, Scoring, Tiebreakers, Cancellations); `docs/architecture.md` §Spread strategy,
  §Locking Model, D10–D11, D15; backlog SIMP-1 (`backlog/12-simplification.md`)

## Context

Pick'em shipped with a rule surface far larger than the game needs, and the surface is not
made of independent rules: almost every intricate one exists to make **editing** safe.

- ATS re-prices every unstarted pick on any change, which ADR-0015 made *structural* by
  deleting and reinserting the member's whole unstarted set on each submission.
- That wholesale replace then needed a **retention boundary** — which picks a submission is
  allowed to destroy — because a locked, cancelled, or moved pick must survive a body that
  does not mention it.
- Retention deliberately left the batch endpoint no way to relinquish a retained pick, so the
  spec's cancellation substitute became unreachable and needed **its own endpoint** (PKM-7),
  which ADR-0015 itself describes as "the exact opposite of rule 1".

Three rules, one cause. Remove editing and all three collapse together.

Three smaller costs sit alongside them, each permanent and each buying nothing observable. The
`Push/Tie Resolution` league setting exists so a commissioner can make a push worth a full
point; nobody asked for it, and it makes a cancelled game worth the same as a correct pick.
The standings tiebreaker carries `differential` through scoring → settlement → two NOT NULL
columns → the wire → a `Diff` column, to break ties in a friends-and-family pool. And
`odds_snapshots` accumulates a row per game per odds sync as an audit trail with no reader —
while the audit that actually matters, *what number this member accepted*, is already
denormalized on the pick as `spread_at_pick`.

Two adjacent questions were ruled while deciding this, and both belong here because the rule
below is unsafe without them: whether a league-wide weekly deadline should replace per-game
locking (2026-08-02), and what "full set required" means for a member who has not submitted
when the week's first game kicks off (2026-08-04).

## Decision

**1. A week's picks are one atomic, immutable submission.** A member submits the full required
set for a week, in one call, behind a confirmation that says the submission cannot be undone;
after it lands, no pick in that week may be changed, replaced, or removed. There is no second
write path.

This **supersedes ADR-0015 rule 1**. Wholesale replace, the retention boundary, and the
`picksAllowed - retainedCount` cap arithmetic all describe an operation that no longer exists:
a submission only ever inserts. It also removes the reason PKM-7 existed at all — the
substitute endpoint was rule 1's inverse, and an inverse of a deleted rule has nothing to
invert. ATS's "all unstarted picks accept the latest spreads" survives as a tautology rather
than a mechanism: there is exactly one write, so no spread can be selectively frozen.

It also **supersedes ADR-0017's motivation** — but not its constraint, and both halves matter:

- The cost ADR-0017 reasoned about was a member blocked from picking a game in week 2 because
  they held a week-1 pick on it. That situation was reachable **only through a provider week
  move**, which ADR-0019 puts out of scope, so the motivation no longer describes anything
  the product can reach.
- `unique (league_member_id, game_id, week_id)` **stays exactly as ADR-0017 left it**, as the
  database backstop for per-week uniqueness. It is the constraint the write path's duplicate
  check is checked against, and narrowing it back would be a migration bought with nothing.

**ADR-0015 rule 3 survives, and becomes load-bearing in a new way.** A settings change that
would strand picks (Pick Type changed, Picks Per Week changed **in either direction**, week
range narrowed) still clears the instance's picks inside the settings transaction, still
refuses with `picks_locked` once any pick has locked. It is now **the only path by which a
member re-submits a week** — the reset deletes the very picks whose existence makes the week
immutable — and it is therefore also the only remedy for a submission a member regrets.

That "either direction" is a consequence of decision 2 below, not an independent choice.
Under the old editable rules a *raised* Picks Per Week stranded nobody: a member simply went
back and added picks. Immutability removes that path, so a raise would leave everyone who had
already submitted permanently below the new required size with no way to comply. Clearing is
the only outcome every member can satisfy.

**2. The required set is sized against the *unlocked* pickable slate at submission time.**
(Ruled 2026-08-04.) A naive reading of "full set required" — `submissions.length` must equal
`picksAllowed` — is wrong and would be harmful. `picksAllowed` is
`min(picksPerWeek, pickable games)`, and `pickable` does **not** exclude games that have
already kicked off: `apps/api/src/services/slate.ts:124` sets `pickable` from
`!isUnplayedStatus(...)`, while `locked` is a separate field computed from the kickoff. So once
the week's first game starts, a member who has not yet submitted would be asked for more picks
than the slate can still supply, and would be locked out of the week permanently. That is an
implicit league-wide weekly deadline — the exact shape the decision below refuses.

The rule is therefore: **a full set of what can still be picked.** The required size is
`min(picksPerWeek, unlocked pickable games)` evaluated inside the submitting transaction.
Games that locked before the member submitted are forgone; they were never picks, so nothing
scores, consistent with the existing rule that unpicked slots score zero. Per-game locking is
untouched.

"What can still be picked" means what the write path would actually accept, and a lock is not
the only thing that stops it. **In an ATS league a game carrying no line is refused on sight**
(`spread_unavailable`), so it is excluded from the required set on exactly the same footing as
a locked one. Counting it would deadlock the week — include it and the submission is refused
for the missing line, omit it and the same submission is refused as incomplete — which is this
decision's own failure mode reached through a different door. Straight-up leagues have no
spread dependency, so nothing is excluded there.

This is not exploitable. Fewer picks means fewer possible points, so submitting late is
self-penalizing rather than an advantage worth engineering against.

**3. Cancellation is a push, full stop.** A pick on a cancelled game resolves as a push, and
the push **stands whether or not unstarted games remain in the week**. There is no substitute
flow, no re-pick, and no conditional branch on the state of the rest of the slate.

ADR-0015 rule 2 keeps its substance — a cancelled game is shown but not pickable, and offering
it would mint free push points — but loses one of its two stated reasons for keeping such rows
visible: "PKM-7's re-pick flow starts from exactly that row". The row stays visible for the
other reason, which is the one that was always sufficient: the member needs to see why a pick
pushed. (`moved` leaves that set entirely; see ADR-0019.)

**4. Push is fixed at 0.5, and there is no tiebreaker.** The `Push/Tie Resolution` league
setting goes. A push is worth half a point in every Pick'em league, and members who tie on
points **share the rank with nothing shown behind them** — no differential, no secondary sort,
no displayed separator between tied members.

Elimination's own push/tie setting is untouched by this. It is not the same concept wearing
the same name: Elimination's resolution decides whether a member **advances or is eliminated**,
which is a survival question with no point value in it, and it stays until that mode is built
out on its own terms.

**5. Only the latest spread is kept.** A game carries its current spread on the game row, where
`override_spread ?? spread` resolves it like every other overridable game field (arch D15), and
the odds sync becomes an idempotent update rather than an append. `odds_snapshots` and its
admin history reader go. What a member accepted is already denormalized on the pick row as
`spread_at_pick`, which is the audit that mattered; the snapshot table was history nothing
read.

### Rejected: a league-wide weekly pick deadline

(Owner decision, 2026-08-02.) A single weekly cutoff — Sunday 1pm ET, say — was considered as
the thing that makes a submission "complete" and was rejected. It solves a paper-league
problem, collecting everyone's sheet before the games start, that this app does not have: the
app already knows each game's kickoff and already derives lock state from it, for free, per
game (arch D11). Adopting a deadline would add a timezone-bearing league setting, a playoffs
exception, and a Thursday-night carve-out, in order to replace a rule that costs nothing and
is already correct.

**Per-game locking at kickoff stays untouched**, and decision 2 above exists precisely so that
"full set required" does not smuggle a weekly deadline back in through the size check.

### What stays

Naming these explicitly because they look like editing machinery and are not:

- **`spread_stale` and `spread_unavailable` validation at first submit.** The line still moves
  between page load and submit, so a submission still has to state the spreads it accepted and
  still gets refused when they have moved. Immutability removes the *second* submission, not
  the first one's ATS handshake.
- **`pick_locked`**, refusing a submission that names a game which has already kicked off.
- **Per-game locking at kickoff**, derived and never stored.
- **`pickMargin` and the per-pick margin phrase.** They grade picks and describe an individual
  result; they were never the tiebreaker, and they survive on their own merits.

## Consequences

**The member-visible cost is real and is accepted: a submission cannot be corrected.** A
misclick is permanent for that week. This is why the submission sits behind an explicit
irreversibility confirmation rather than a plain Save, and why the settings-reset of ADR-0015
rule 3 is the sole remedy — a commissioner action, pre-start-only, refused once anything has
locked. That is a deliberately narrow escape hatch, not a general undo, and a league that
wants a correction after kickoff does not get one.

**`pickem_pick_results.differential` and `pickem_standings.differential` lose their reason to
exist.** Both are NOT NULL columns carrying a value computed only to break ties, and with
decision 4 nothing reads them. They are dropped rather than left nullable and unread; a column
whose only remaining property is that nothing uses it is a future reader's trap.

**Easier.** The write path only ever inserts, so there is no retention computation, no
delete-and-reinsert re-pricing, no `picksAllowed - retainedCount` arithmetic, and no class of
refusal that only editing could produce. The `moved`/cancelled/locked retention triad, the
substitute endpoint, and the accept-latest-spreads bar disappear together. Scoring's push
lookup collapses to a constant, and `rankStandings` sorts on one number.

**Harder / accepted.** The client must assemble a complete sheet before it can submit anything,
so a member who wants to "lock in Thursday and decide Sunday" cannot: they either submit early
against a full slate or submit later against a smaller one (decision 2). Standings will show
ties with no separation, which is the intended outcome rather than missing information.

**Revisit if** editing is ever genuinely needed — for instance if leagues start reporting that
the settings-reset escape hatch is being used routinely, which would mean immutability is
being worked around rather than accepted. Restoring editing means restoring the re-pricing,
retention, and substitute rules as a set; they were never separable.

The epic's remaining tickets are the implementation. `backlog/12-simplification.md` SIMP-3
onward carries this decision into `docs/mvp-spec.md` and `docs/architecture.md`, then into
scoring, schemas, the migration, the write path, settlement, and the UI.
