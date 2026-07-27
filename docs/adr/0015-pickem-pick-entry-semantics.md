# 0015. Pick'em pick entry: whole-week replace, unplayable games are unpickable, and a settings change resets picks

- **Status:** Accepted
- **Date:** 2026-07-27
- **Related:** `docs/mvp-spec.md` §Game Mode 1 (Core Rules, Locking, ATS spread acceptance, Cancellations, Pick Visibility); `docs/architecture.md` §Locking Model, D9–D11, D15; backlog PKM-2, PKM-7

## Context

`PUT /leagues/:id/picks/week/:weekId` is the only write path for Pick'em picks. The spec
fixes its hard edges — picks lock per game at kickoff, ATS edits re-price every unstarted
pick, cancelled games push, picks are hidden until kickoff — but leaves four questions the
implementation had to answer, and answering them wrong is silently exploitable rather than
loudly broken.

**What does a submission mean?** The spec says picks may be submitted "individually or in
batches" and that "changing any pick requires accepting the latest spreads on **all** of that
member's unstarted picks — spreads cannot be selectively frozen." A per-pick endpoint cannot
express that rule without the client making N calls that must all succeed together.

**Can a member pick a cancelled game?** The spec says a cancelled game's pick "resolves as a
push", and a push is worth the league's Push/Tie Resolution value — `+0.5` by default and
`+1.0`, i.e. the same as a correct pick, under `full_point`. Nothing in the spec says a
cancelled game leaves the slate, because the spec is describing what happens to a pick you
*already had*.

**Settings are editable pre-start; picks are also open pre-start.** The spec locks settings
"at league start", and a league starts when its first week starts. But a member picks week 1
*before* week 1 begins, so a commissioner can legally change the rules under picks that were
legal when made. Switching Pick Type to ATS leaves picks with no spread at all.

**What may other members see before kickoff?** The spec is explicit that pick *content* is
hidden. It is silent on whether the fact that someone has submitted is hidden — while
§Screens requires a dashboard showing "pick-status at a glance".

## Decision

**1. A submission replaces the member's replaceable picks for the week, wholesale.** The body
carries the member's complete intended set of unstarted picks for that week; the server
deletes the ones it supersedes and inserts the submission. This makes the ATS rule structural
rather than enforced: every unstarted pick is re-written at the current spread on every edit,
so spreads *cannot* be selectively frozen because there is no operation that would freeze one.

A pick that is **not replaceable is retained, never dropped.** Absence from the submission
means "I am not changing that", not "delete it". Three picks are unreplaceable:

- a **locked** pick, whose game has kicked off (spec §Locking — locked picks are immutable);
- a pick whose **game has left the week**. A provider week move repoints `games.week_id`
  while the pick keeps its own, so the pick is no longer addressable from this week's slate;
- a pick on a **cancelled or moved** game, which resolves as a push the spec says stands
  (§Cancellations: "If no unstarted games remain, the push stands").

The third case is why retention keys on `pickable` and not on `locked` alone. A cancellation
that lands *before* the scheduled kickoff leaves the game unlocked, so a `locked`-only rule
would delete that pick on the member's next unrelated edit — while an otherwise identical
cancellation landing *after* the kickoff would retain it. Same spec situation, opposite
outcome, decided by a timestamp that means nothing for a game that will never be played.

Submitting a locked game is a `pick_locked` 409 rather than a silent no-op, so a stale client
learns its slate moved instead of believing an edit landed.

**The cap bounds what a submission may add, not what the member ends up holding.**
`submissions.length > max(0, picksAllowed - retainedCount)` is the refusal. Retained picks
are not something the member chose to keep, and a shrinking slate (a cancellation) can push
`retainedCount` over the cap on its own; a total-based check would then refuse an empty
submission, which only ever deletes and so can never breach a cap.

**2. Cancelled and moved games are shown but not pickable.** `SlateGame.pickable` is false for
any status in `UNPLAYED_GAME_STATUSES` (`cancelled`, `moved`), a submission naming one is a
`game_not_pickable` 409, and such games do not raise `picksAllowed`. The spec's
"fewer games than Picks Per Week" rule says members pick every *available* game — an unplayable
game is not available.

They stay **visible** on the slate because the member needs to see why a pick pushed, and
PKM-7's re-pick flow starts from exactly that row.

`postponed` is deliberately excluded: a postponement inside the week is played later and
resolves normally. `UNPLAYED_GAME_STATUSES` lives in `packages/schemas` as one definition
consumed by both `packages/scoring` (push-on-unplayed) and the pick slate (unpickable),
because the two rules are the same rule and must not drift.

**3. A settings change that would strand picks clears them.** In `updateLeague`, inside the
same transaction as the settings write: if Pick Type changed, Picks Per Week was *lowered*, or
the week range *narrowed*, the instance's picks are deleted and members re-pick. A change that
cannot strand a pick — Push/Tie Resolution, which scoring reads at settlement time; Picks Per
Week *raised* — clears nothing.

The alternative was to let settlement cope. It cannot: `settlePickemWeek` throws on an ATS
pick with no spread, deliberately, because the only alternatives are grading it against a
number that does not exist or silently skipping it. A stranded pick would therefore take down
the whole league-week's settlement, permanently, with no admin remedy short of a database edit.
Refusing the settings change outright was rejected as user-hostile for something the
commissioner is explicitly allowed to do.

**But clearing is refused (`picks_locked`, 409) if any pick on the instance has locked.** The
tempting justification — "it's pre-start, so nothing has locked" — is false. `isPreStart`
treats a *null* start as pre-start, and a league's start is null when its start week holds no
games; the schedule sync now deliberately preserves emptied weeks that still hold picks
(see the last paragraph), so a league whose start week empties out silently re-enters
"pre-start" mid-season. Trusting that boundary would let a settings edit delete picks that
were already locked and revealed to the league. The reset therefore asks the picks directly
rather than inferring their state from a league-level date.

**4. `hiddenPickCount` discloses how many picks another member has submitted, never which.**
Another member's `picks` array contains only games that have kicked off; the count of the rest
travels alongside it. Pick *content* — game and side — stays hidden, which is what the spec
protects.

## Consequences

Easier: the ATS "all unstarted picks" rule needs no enforcement code, because the write
operation cannot express a partial re-price. Settlement never receives a pick it cannot grade,
so its throws stay true bug signals. The dashboard and week view can show "5 picks in" without
a second endpoint.

Harder/accepted: the client must send the member's whole unstarted set and must filter locked
games out of the body — the OpenAPI description says so explicitly, and a mistake is a 409,
not corruption. Every submission mints new pick ids and resets `created_at` for picks that did
not change; this is acceptable because `pick_results` is a pure derivation recomputed from
(picks, results, settings) at any time (arch D10) and cascades from the pick row, so id churn
costs a recompute rather than data.

A commissioner who lowers Picks Per Week pre-start silently discards everyone's picks. It is
logged (`league.settings-reset-picks`) but there is no UI warning yet — worth adding to the
settings form before launch, and the reason the predicate is deliberately narrow.

**PKM-7 needs its own path, and that path must be able to *remove* a retained pick.** The
spec's cancellation re-pick is the one case where ATS acceptance applies to "the
**replacement pick only** (other unstarted picks keep their spreads)" — the exact opposite of
rule 1. That is a genuinely different operation, not a variant of this one, so it gets its own
endpoint rather than a flag that inverts this one's central invariant.

This is a hard requirement rather than polish: retention deliberately gives the batch endpoint
no way to relinquish a retained pick, so the substitute half of §Cancellations ("the member
may re-pick by substituting any unstarted game from the same week") is *unreachable* until
PKM-7 ships a delete. A member holding a cancelled-game pick in a full week is capped until
then. Revisit rule 1 only if a second such exception appears.

`pickem_picks.week_id` is `ON DELETE RESTRICT`, which means a pick can block deletion of a
week. The schedule sync's convergence sweep already skipped weeks holding games and now also
skips weeks holding picks; without that guard a single pick into a superseded provisional week
would abort every schedule sync from then on.
