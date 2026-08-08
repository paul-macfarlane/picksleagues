# 0028. The everyone-out rule is a Survivor league setting, and with revival off the last group standing co-wins

- **Status:** Accepted
- **Date:** 2026-08-08
- **Related:** `docs/mvp-spec.md` §Game Mode 2 (League Settings, Core Rules, End of League — all three
  amended by this ADR); `docs/architecture.md` §Settlement & Scoring, D10;
  [0024](0024-survivor-settings-carry-a-resolved-range.md) (Survivor's settings shape),
  [0025](0025-survivor-team-ledger-and-prefix-ordered-settlement.md) (settlement is prefix-ordered,
  and `survivor_state` absence means alive),
  [0027](0027-survivor-season-ends-at-a-sole-survivor.md) (the season-state derivation this extends);
  backlog ELM-10

## Context

Spec §Game Mode 2 states the everyone-out rule as though it were the rule: "all members eliminated
that week are revived and continue". It is one of several answers real survivor pools give when the
whole surviving field busts in the same week. Pools also **end there and split** the pot between the
members who got that far, **void the week and re-run it** against the next slate, or simply **continue
with nobody** and let the range run out unwon. Revival is common, and it is a reasonable default; it
is not the standard, and a league that wanted one of the others had no way to say so.

The owner ruled it should be a commissioner setting. Making it one contradicts a locked document, so
it is recorded here before any code moves.

**Void-and-re-run is not built and gets no placeholder.** Re-running a week means un-settling one:
reversing graded results, handing back consumed teams, and re-opening picks that members made and saw
each other make. That breaks the pick immutability the mode's visibility rule depends on and needs
settlement machinery nothing else in the repository has. If it is ever wanted it is its own ticket
with its own ADR — a value in this setting's set that no code honours would be a promise the product
does not keep.

## Decision

**1. The setting has exactly two values.** `revive` — every member eliminated in an everyone-out week
comes back and the season continues, which is what every league does today and what every stored
settings row will keep doing — and `co_win`, below. `revive` is the default, so this change is
invisible to leagues that never touch it.

**2. Under `co_win`, the members alive going into the emptying week are its co-winners, and the
season ends there.** They are **not** revived: settlement eliminates them, correctly, because they
lost their picks. Losing is what ended the season, and pretending otherwise would put a live member
in a league with no week left to play. What the setting changes is who the season names as its
winner, not what the grader saw.

**3. The winners are derived, never stored.** Under `co_win` the alive set is empty, so ADR-0027's
`winnerMemberIds` cannot come from it. It comes from `survivor_state` instead: the members whose
`eliminatedWeekId` is the **latest** elimination week in season order. That set is provably the final
alive set — if the league went to zero, everyone alive going into that week was eliminated *in* it,
and nobody already out was eliminated a second time — so it needs no new column and no new write path.

This is a third arm on the derivation ADR-0027 already owns in
`apps/api/src/services/survivor/season.ts`, not a new subsystem: same one home, same three callers
(the board serializer, the pick endpoint, the dashboard glance), same property arch D10 asks of every
mode's settled state — recomputable from (picks, results, settings) at any time.

**4. The setting is additive, with a Zod `.default()`.** Settings JSONB evolves additively or ships a
data migration; a `.default()` means every settings row written before this field existed still parses,
materializing `revive`. No migration, and no divergence between stored settings and the current schema.

**5. It does not invalidate stored picks.** Settlement reads it at grading time, exactly as it reads
Push/Tie Resolution, so no pick made under the old value becomes ungradeable under the new one. The
commissioner may flip it mid-season and the next replay simply grades the season the other way —
which is the honest behaviour for a derived result, and the same one an admin score override already
produces.

## Consequences

**Every existing league behaves exactly as it did.** The default is today's rule, and the settlement
path that implements it is unchanged for it.

**A `co_win` winner is eliminated *and* a winner at the same time, and every surface that ranks those
two facts had to be re-checked.** The dashboard glance previously answered "eliminated" before it
answered "won", which was right while winners were the alive set and is wrong now — it would tell the
member who just won that they are out. It now tests winner membership first. The board carries both
facts on one row and must not print them as unrelated: the week that ended a co-winner's season is
the week they were last standing in, and it reads as that rather than as "out in week 17" beside a
"Co-winner" pill. The pick endpoint's split is unchanged and now load-bearing in a second case: a
winner is refused with `league_concluded`, everyone else with `member_eliminated`.

**ADR-0027 is untouched by this, and was never conditional on it.** Its sole-survivor arm is
self-securing — ending the season is what removes the later pick that could unsettle it — so a
configurable revival rule cannot reach a season that rule has already ended. What this ADR answers is
the case that never passes through a sole survivor at all: the final **two or more** alive members all
busting in one week, taking a league from several standing straight to nobody standing.

**A season can still un-decide itself**, on the same terms ADR-0027 records: an admin override that
reverses the emptying week's result restores the alive set and the derivation follows it.

**Revisit if** a pool asks for void-and-re-run (its own ticket, per the Context above), or if a
second mode wants a configurable everyone-out rule — at which point the question is whether the
*resolution vocabulary* generalizes, not this setting's storage.
