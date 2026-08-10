# 0035. League home shows season standings only for Pick'em

- **Status:** Accepted
- **Date:** 2026-08-10
- **Related:** mvp-spec.md §Screens, backlog FB-5

## Context

Spec §Screens (locked v0.3) gave League home a "weekly/season toggle for
Pick'em" as the standings' primary view. Real use showed the toggle answering a
question another screen already answers better: League Picks has its own week
selector and presents a week as a leaderboard with each member's weekly and
season record and their picks beneath it — strictly more weekly detail than the
overview's bare weekly board. The overview's selector was therefore a second way
to ask the same question, on the page least suited to answering it, and it cost
a weeks query + scope control on the league's landing screen.

The weekly *leaderboards themselves* are not in question — spec §Standings'
two parallel boards stand, and the weekly board API remains what League Picks'
week detail renders and orders by.

## Decision

League home renders the season-cumulative board only. The scope selector, the
`week` search param on the overview route, and the standings table's week
parameter (client-side) are removed. Weekly performance is reached through
League Picks. Spec §Screens is amended in step ("season standings for
Pick'em").

## Consequences

- The overview simplifies: one query, no control, no unreachable-state
  combinations. Old links carrying `?week=` degrade silently to the season
  board.
- Weekly boards keep exactly one home (League Picks), so future standings
  work (e.g. any movement/streak treatment) has an unambiguous surface.
- Revisit if a mode ships whose primary board is genuinely periodic — the
  overview would then need a scoped board again, and this ADR is the record of
  why Pick'em's isn't one.
