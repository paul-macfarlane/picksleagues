# 0030. A league season's conclusion is settlement's output, recomputed both ways

- **Status:** Accepted
- **Date:** 2026-08-09
- **Related:** `docs/mvp-spec.md` §End of League, §Game Mode 1 §Standings (which states
  Pick'em's season bound but names no ending — supplied by this ADR);
  `docs/architecture.md` §Settlement & Scoring, §Domain Model, D10 (whose set of pure
  derivations this ADR extends to `league_seasons.status`); `docs/simulator-guide.md`
  §Endpoints;
  [0009](0009-multi-season-leagues.md) (a league's current instance is its newest, derived —
  which is what makes "superseded" derivable too),
  [0025](0025-survivor-team-ledger-and-prefix-ordered-settlement.md) (settlement is
  prefix-ordered, so the replay already knows where a season stopped),
  [0027](0027-survivor-season-ends-at-a-sole-survivor.md) (the two arms of a Survivor
  ending, whose one home this ADR relocates); backlog LG-12

## Context

`league_seasons.status` has had two values since LG-1 and one writer: everything that mints
an instance writes `active`. `concluded` is read in six places — both pick services refuse a
write on it, the join path and the invite explainer refuse an entry, discovery hides the
league, the 10-active-commissioner cap discounts it, and the nightly `settle-sweep` skips it
— and is written by nothing at all. Three consequences, in ascending order of cost.

**Every refusal keyed to it is unreachable.** A member can submit picks into a season that
ended in January, in either mode, and the code that was written to stop them has never run.

**Every league season ever created is recomputed every night, forever.** `settleSweep`
selects on `status = active`, so the filter that was supposed to retire finished seasons
retires nothing. Pick'em's cost per season is bounded by its weeks-with-picks; Survivor's is
a whole-season replay from week one (ADR-0025 explains why it cannot be incremental), so the
nightly bill grows with seasons × weeks and never falls.

**The one question the status answers is instead re-derived, twice, from raw game rows.**
`survivor/season.ts::rangePlayedOut` walks every in-range week's games asking whether they
are terminal — which is precisely what the replay loop in `survivor/settlement.ts` decides
when it chooses whether to break. ELM-4 shipped the two with a pair of comments pointing at
each other and a note that "a stored marker is the right fix if this ever needs a third
caller", because there was no stored answer to read. Drift between them does not produce a
stale number; it crowns a winner mid-season or never crowns one at all.

The obvious repair — have settlement write `concluded` when it finishes — runs straight into
arch D10, which requires that settlement write no state a full recompute wouldn't reproduce.
A one-way flag is exactly such state: an admin override that un-finals a game, or a provider
correction that pulls a score, would leave a season permanently marked finished with no
remedy short of a database edit. And it leaves the second half of the problem untouched, since
a season whose schedule is missing a week's games can never satisfy the rule and so would be
swept forever anyway, long after its league moved on to the next year.

## Decision

**`league_seasons.status` is a materialized derivation maintained by settlement**, on the
same terms as `pickem_standings`, `pickem_pick_results`, `survivor_state` and
`survivor_pick_results` (arch D10). It is written inside the settling transaction, and it is
written in **both directions** — a recompute that finds the season unfinished writes `active`
back. Nothing about the status survives a full recompute that the recompute wouldn't
reproduce, which is what lets an operator correct game data and have every downstream
refusal, filter and board follow.

The rule is one disjunction, in one function
(`services/leagues/conclusion.ts::applyLeagueSeasonConclusion`):

```
concluded  ⇔  superseded  ∨  mode-decided
```

**1. Superseded** — an instance of the same league is bound to a strictly greater
`sport_seasons.year`. Mode-agnostic, and derived rather than asserted: ADR-0009 already
defines a league's current instance as its newest, so "not the current one" is a fact about
rows that a recompute reads the same way every time. This is the arm that retires the awkward
cases the mode rule cannot reach — a season whose schedule was never fully ingested, a league
whose last week holds a game stuck in `postponed` — the moment the league moves on.

**2. Mode-decided** — the mode's own answer, supplied by the settlement that just ran:

- *Pick'em* — every in-range week of the bound season holds at least one game, and every one
  of those games is terminal: `final` with both scores, or `cancelled`. Deliberately
  independent of picks. The spec gives Pick'em no §End of League of its own; its season is
  "the league's start week through its end week" (§Standings), and a league nobody ever
  played still has to end. A `final` game with null scores is a provider fault that holds the
  season open until an override fixes it — the same bar Survivor's replay already applies,
  and the correct one, since a downstream refusal should not fire while the data is still
  wrong.
- *Survivor* — ADR-0027's two arms, read straight off the replay rather than recomputed: it
  graded every in-range week without breaking, or it broke on the sole-survivor reduction.

**The status means "settlement has nothing left to grade", which is not quite the same
question as "who won" — and Survivor is where they come apart.** ADR-0028 lets a reduction
become certain *inside* a week that cannot be graded as a unit: one member is confirmed safe,
every other alive member's pick has already lost, and the season is over even though the week
has produced no result rows. The board must say so at once ("says who won as soon as it is
true", ADR-0027). The status must **not**, because writing it there retires the season from
the nightly sweep while that very week is still ungraded — and the games still open in it are
by construction picked by nobody left alive, so the incremental path, which finds a season
only through a pick on the changed game, would never bring it back. The week would stay
ungraded forever, and the winner's own pick would show no outcome on a board calling them the
winner.

So the provisional arm crowns without retiring: `resolveSurvivorSeasonState` ORs the stored
status with a reduced-to-one test over `survivor_state`. That is the cheap half of the old
derivation, not the duplicated half — a count over the alive set, not a second reading of
whether the schedule has finished. `rangePlayedOut` stays deleted.

**3. Renewal closes the instance it supersedes**, by calling the same function with no mode
answer. The superseded arm fires against the newer row renewal inserted moments earlier in
the same transaction, so renewal is not a second rule — it is the first arm, applied at the
moment it becomes true instead of on the next sweep.

**4. The Survivor board, pick endpoint and dashboard glance read the stored status, plus the
one arm it cannot carry.** `resolveSurvivorSeasonState` stays the single home for the
question: it keeps ownership of *who won* — the alive set, from `survivor_state` — and takes
`decided` from `league_seasons.status`, which its callers already hold, ORed with the
reduced-to-one test above for the window where the reduction is certain but the week is not
yet graded. All three surfaces go through it, so they cannot disagree with each other.

`rangePlayedOut` and the week/game loading behind it are deleted, and that is the duplication
ELM-4 documented: a second walk of the game rows restating settlement's *completeness* rule.
What survives is a count over the alive set, which restates nothing.

## Consequences

**The nightly sweep retires seasons, and that costs a safety net.** A concluded season leaves
`settleSweep`'s working set, which is what makes Survivor's whole-season replay affordable
across years. The incremental path still reaches it when a game it holds a **pick** on is
corrected — `settlePicksForGames` selects league seasons by `pick.game_id` — and such a
rebuild reopens the season if it is no longer finished. But a correction to a game *nobody in
that league picked* reaches nothing: no pick matches, and the sweep has stopped looking. In
Survivor that is most of a week's slate, and the un-finaling of an in-range game there should
wipe every later week's grading (ADR-0025's prefix rule) but will not.

So the D10 escape hatch for a concluded season is the **admin rebuild**
(`POST /admin/leagues/:id/rebuild`), which is status-blind, and not the nightly job. This is
a deliberate, recorded trade (owner, LG-12) — the alternative is sweeping concluded seasons
whose bound season has seen a game change since they last settled, which is the fix to reach
for if an operator ever hits this. It is narrow because the status is only written when
settlement has nothing left to grade: reaching it takes an admin correction, to a season that
had finished, on a game that league did not pick. The one path that would have reached it
*without* an operator — the mid-week reduction above — is exactly why the provisional arm
does not write the status.

A related variant is unreachable by any trigger: a game **newly inserted** into an in-range
week never enters `settlementAffectedGameIds` at all, since ingestion reports only an existing
game's status or week changing. A season that concluded before that game existed reopens only
on an admin rebuild.

**Every `concluded` refusal becomes reachable, and that is a behavior change to watch.** A
member cannot pick into a finished season; a finished league leaves public discovery; a
commissioner's finished league stops counting against the 10-active cap, freeing a slot; the
omit-`leagueId` form of `/sim/settle` stops targeting it. Each is what the code already said
and none had ever happened. The cap in particular is spec-intended (§Users & Identity Limits
counts active leagues) but has been inert since LG-2.

In Survivor the pick refusal stays **narrowed to the winner**. ADR-0027 §4 is explicit that
elimination outranks conclusion — "a member who went out in week 6 is told they are out
rather than that a season they lost is over" — and a decided season's winners are exactly its
alive set, so everyone else falls through to `member_eliminated`. Refusing the whole league on
the bare status would be the shorter code and the worse answer.

**One newly-reachable reader was a hole, and is closed here rather than inherited.** Account
deletion's last-commissioner guard (`users.ts`) filtered on the current instance being
`ACTIVE`. That filter was vacuous while nothing wrote `concluded`; with a writer it would let
the sole commissioner of a finished league delete their account, leaving a league with members
and no commissioner. Renewing into the next season is commissioner-only
(`LEAGUE_ACTION.RENEW_SEASON`) and no code path grants the role, so the league would sit inert
on every remaining member's dashboard permanently. The guard now counts every non-empty
league, concluded included, preserving ADR-0004's ≥1-commissioner invariant. A finished league
is not a disposable one.

**The flag can flap while an operator is mid-correction.** Clearing a score reopens the
season and restoring it re-closes it, with the pick refusal following each step. That is the
price of D10 purity and it is the right price: the alternative leaves a wrongly-finished
season with no remedy in the product at all.

**Renewal has to take settlement's lock, not just the league's.** A rebuild of the prior
instance in flight during a renewal computes `superseded` against a snapshot that predates
renewal's INSERT, so it would write `active` back over renewal's `concluded`. Renewal
therefore takes `lockLeagueSeasonRow` on the instance it is closing before writing — the same
row lock every settler already takes — which serializes the two and lets whichever runs
second read the other's committed state. This costs nothing in lock ordering: settlement takes
only the league-season lock, so there is no path that acquires these two in the opposite
order.

**Revisit if a mode ever needs conclusion to mean something a recompute can't see** — an
operator manually ending a league, say, or a forfeit. That is a decision with a writer other
than settlement, and it would need a column of its own rather than a third arm here.
