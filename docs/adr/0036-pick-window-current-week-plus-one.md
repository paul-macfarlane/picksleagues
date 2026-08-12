# 0036. Picks are windowed to the current week, plus the next once resolved

- **Status:** Accepted
- **Date:** 2026-08-10
- **Related:** mvp-spec.md §Game Mode 1 Core Rules / §Game Mode 2 Core Rules, ADR-0025, ADR-0031, ADR-0033, backlog FB-16 / FB-17

## Context

Staging testing showed a Survivor member could submit a pick two weeks ahead of
the current week, and Pick'em would allow the same — it merely *looked*
enforced, because ATS spreads only get posted close to kickoff (an
ingestion-schedule side effect, and no guard at all for straight-up leagues).
Both write paths validated only week-in-range plus per-game kickoff locks;
nothing constrained *which* week relative to now.

Picking far ahead is unwanted in both modes: in Survivor it commits teams
before the member knows whether they're even alive to use them, and in both
modes it turns "the week's slate" into a season-long buffet the spec never
described. The owner's rule: only the current week is pickable — or the next
week, once the current one has resolved for you.

Timing constraint: Survivor settlement is week-atomic (ADR-0025) — a Sunday
winner's result row does not exist until the whole week settles after Monday
night. Gating the unlock on settlement rows would hold the window shut for
days after the member's own game ended.

## Decision

A **pick window**, enforced in both modes' write transactions and served to the
UI as `pickWindowOpen` on each week-picks response, computed by one shared gate
(`isWeekInsidePickWindow`, `apps/api/src/services/league-weeks.ts`) so refusal
and rendered flag cannot disagree. Writes outside it refuse with the new
`week_not_open` (409).

1. **The current week is always inside the window.** Current week =
   `resolveCurrentWeekId` (the one in progress, else next to start), the app's
   single existing definition, over the league's own in-range weeks.
2. **The next in-range week is inside once the current week has resolved for
   this member**, derived from the picked games' terminal state — not
   settlement rows — so the window opens the moment the games end:
   - *Survivor:* their current-week pick's game is terminal and didn't
     eliminate them — final win, final tie (ties advance, ADR-0033), or
     cancelled (push). A loss does **not** unlock, even though the
     everyone-out revival may later revive them: revival is a whole-week
     answer only settlement can give, and the next week becomes current on
     its own by then. A missed pick resolves nothing.
   - *Pick'em:* every game in their own submission is terminal (final with
     scores, or cancelled). No submission → nothing resolves → wait for the
     week to turn.
3. **Everything else is outside** — two or more weeks ahead always refuses.
   Past weeks are already refused by per-game locks; the window adds no
   fourth state for them.
4. **A current week with no games opens the next week for everyone.** It has
   nothing to pick or resolve, and exists in-range only through ADR-0031's
   start re-resolution window — refusing there would close pick entry
   entirely until the empty week's dates pass.

## Consequences

- FB-16's bug is closed in both modes, and Pick'em's window no longer depends
  on how far ahead the odds sync happens to post lines.
- ADR-0025's note that revived members' next-week picks "were legitimately made
  while they still read as alive" is narrowed: a busted-but-unsettled member
  can no longer make a next-week pick at all (their pick was a loss), so
  revived members pick the next week after revival settles — by which point it
  is current or a day from it. Current-week picking in the bust gap is
  unchanged.
- A final-without-scores game (provider fault) reads unresolved and holds the
  window shut until an admin score override corrects it — consistent with how
  settlement treats the same fault.
- The UI renders closed weeks as a notice instead of a sheet, gated on the
  server-computed flag, never a client-side re-derivation.
- Revisit if a mode ships whose entry cadence isn't weekly (March Madness
  submits one bracket against a single lock instant — no window at all).
