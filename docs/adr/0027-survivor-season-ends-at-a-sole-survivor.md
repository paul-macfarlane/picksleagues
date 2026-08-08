# 0027. A Survivor season ends the moment one member is left standing

- **Status:** Accepted
- **Date:** 2026-08-08
- **Related:** `docs/mvp-spec.md` §Game Mode 2 (Core Rules, End of League — amended by this
  ADR), §Screens — Dashboard; `docs/architecture.md` §Settlement & Scoring, D10;
  [0016](0016-per-mode-result-and-standings-tables.md) (Survivor's board is not a ranking),
  [0024](0024-survivor-settings-carry-a-resolved-range.md) (the resolved range this rule
  short-circuits), [0025](0025-survivor-team-ledger-and-prefix-ordered-settlement.md)
  (settlement is prefix-ordered, and `survivor_state` absence means alive); backlog ELM-9,
  ELM-10, LG-12

## Context

Spec §End of League concludes a Survivor league on one condition: "the league concludes once
the last week of its resolved range has settled". A Survivor league's range is the whole
regular season (ADR-0024), so with the range rule alone a league whose second-to-last
opponent went out in week 6 keeps asking its last member for a pick every week until
January — twelve weeks of picking against nobody, with a board that refuses to call them the
winner until the range runs out.

The owner hit exactly this while testing the settlement work, and ruled that the season
should end there. That contradicts a locked document, so it is recorded here before any code
moves.

**Ending early is safe because ending is what makes it safe.** Once one member is left
alive, the only mechanism that could still change who wins is another pick — and this rule
ends the season, so there is none. No further week is played, nothing further is graded, and
the winner is not asked to keep playing alone. The range rule was only delaying the
announcement of a result settlement had already produced.

**Three surfaces ask the question, and none of them owned it.** The board serializer had a
private `isSeasonConcluded`; the pick endpoint had a `league_concluded` refusal reachable
only from a `league_seasons.status` value nothing in the repository ever writes; the
dashboard glance had no notion of an ended season at all and would have gone on saying "Pick
needed" to a member who had won. A rule this consequential answered in three places is one
that drifts in three directions.

## Decision

**1. A Survivor season is decided when either of two things is true:** every in-range week of
its resolved range has played out (the spec's existing rule), **or** settlement has reduced
the league to exactly one member still alive. Whichever happens first ends the season. The
members alive when it ends are its winner or co-winners, unchanged.

The sole-survivor arm requires **settlement to have eliminated at least one member**. It is
the *reduction* to one that decides a season, not the arithmetic of a league that only ever
had one member in it: a solo league is not won before its first kickoff, and a member alone
in a league nobody joined keeps being offered their week.

**2. The decided state is derived, not stored.** It is computed from league membership,
`survivor_state`, and the in-range weeks' game statuses — the same evidence, resolved through
the same override precedence (arch D15), that settlement itself grades on. Nothing writes
`league_seasons.status = concluded`; persisting conclusion is LG-12's job, and when it lands
this rule becomes the thing that *decides* what to persist rather than something to rewrite.
The pick endpoint therefore checks both: the stored status, and this derivation.

Deriving keeps the property arch D10 asks of every mode's settled state — recomputable from
(picks, results, settings) at any time. A stored flag would be wrong for as long as the job
meant to flip it was late, and wrong in the other direction the moment an admin override
revived a week that had already ended the season.

**3. It has one home.** `apps/api/src/services/survivor/season.ts` answers "is this season
decided, and who won it" for the board serializer, the pick endpoint, and the dashboard
glance. The board's `isSeasonConcluded` — which restated settlement's week-completeness rule
in a second place — is folded into it, so the completeness rule now has one copy on the read
side and one in the grader, coupled by a comment in each.

The answer is resolved for many league-seasons in one batch, because the dashboard glance
resolves every league a member is in on a single request and must not become an N+1 there.

**4. The dashboard glance gains a `won` state**, reported to a member who is alive in a
decided season — which, since winners *are* the alive set, is exactly the members who won it.
Elimination still outranks it, so a member who went out in week 6 is told they are out rather
than that a season they lost is over.

## Consequences

**A decided league stops asking for picks, and says who won as soon as it is true.** The
board names the winner mid-season, the pick endpoint refuses further submissions with the
`league_concluded` refusal that existed but was unreachable, and the dashboard says "Winner"
instead of "Pick needed". Nothing waits on a range that can no longer change the outcome.

**ELM-10 owns a different question, and this rule does not depend on it.** Making the
everyone-out revival rule configurable cannot reach a season this rule has already ended:
with no further week there is no bust to revive from, so nothing here becomes conditional on
that setting. What ELM-10 does have to answer is the case that never passes through a sole
survivor at all — with revival disabled, the final **two or more** alive members can all bust
in the same week, taking a league from several standing straight to nobody standing. Who wins
then is the everyone-out week's question, and the spec has no answer for it today.

**A season can un-decide itself, and that is the honest behaviour.** An admin override that
reverses a week's result, or a member joining before the cutoff, changes the alive set and
the derivation follows it. A stored flag would have kept claiming a winner the results no
longer support. What a derivation cannot do is undo something a member was told; the risk is
bounded to display and refusals, since nothing irreversible happens at conclusion.

**The board and the pick endpoint now pay a few extra queries** for facts they partly held
already — membership and `survivor_state` — because the shared answer loads its own evidence
rather than being handed fragments by each caller. That is the cost of the single home, and
it is the right trade at this scale; the seam to revisit, if it ever matters, is passing
pre-loaded rows in rather than splitting the rule again.

**Revisit if** LG-12 persists league status (the derivation becomes the writer, and the
readers can then read the column), or if a mode without single-elimination wants the same
early ending — at which point what generalizes is "the season is decided when no remaining
result can change the winner", which is a per-mode question rather than a shared one.
