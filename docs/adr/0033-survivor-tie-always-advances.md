# 0033. Survivor's Push/Tie Resolution is fixed at its default; the setting is removed

- **Status:** Accepted
- **Date:** 2026-08-09
- **Related:** [0026](0026-survivor-is-straight-up-only.md) and
  [0024](0024-survivor-settings-carry-a-resolved-range.md) (the same reasoning
  applied to Survivor's other two settings, which this completes — the mode now
  has no league settings at all), [0028](0028-survivor-provisional-elimination.md)
  (whose tie edge case this simplifies); `docs/mvp-spec.md` §Game Mode 2 League
  Settings; backlog SWP-5 (`backlog/15-scope-sweep.md`)

## Context

Survivor's one remaining league setting was Push/Tie Resolution: on a
straight-up tie, advance with the team consumed (default) or eliminate. NFL
ties run one or two a season, so the setting rules on an event most leagues
never see — and a setting nobody changes is a control offering one option,
the exact reasoning that already removed Survivor's Pick Type (ADR-0026) and
season range (ADR-0024). It cost a radio group on two forms, a value set and
enum on the wire, a settings parameter threaded through the whole scoring
package, and an eliminate branch in grading with test rows to match.

## Decision

**A tie always advances the member, with the team consumed.** The game was
played, so the team is spent; the member did not lose, so they survive. The
setting is removed rather than hidden:

- `SurvivorSettingsSchema` stores only the resolved week range;
  `SurvivorSettingsInput` becomes an empty object — a Survivor league has no
  rule left for a commissioner to choose, and the settings surfaces show only
  the read-only range line. A stale client still sending
  `pushTieResolution` has it stripped, not refused (the ADR-0024/0026
  tolerance, extended).
- `packages/scoring` takes no settings at all: `settleSurvivorWeek`,
  `settleSurvivorWeekProvisionally`, and grading lose the parameter, and the
  tie branch hardcodes advance-with-team-consumed. A stored row still
  carrying the retired key parses (stripped) — but because the value was read
  at grading time, a recompute of an eliminate-on-tie league's season would
  now grade its tied members as advanced, cascading through every later
  week's results under prefix-ordered replay (ADR-0025). That semantics
  change is accepted solely because there are no active leagues in any
  environment (owner, 2026-08-09).
- The provisional-elimination rule (ADR-0028) gets simpler at the edges: a
  tied final is now always a confirmed survivor, so the eliminate-on-tie
  case that could hold a provisional elimination open disappears.
- The cancellation rule is untouched and now stands alone as the only other
  push: a cancelled game returns the team and the member survives (spec
  §Game Mode 2 — Cancelled game).

## Consequences

- Survivor joins its range (ADR-0024) and pick type (ADR-0026) in being
  fully rule-fixed: creating a Survivor league asks for nothing beyond the
  league-generic fields, and the settings editor has nothing Survivor-shaped
  to edit — which also means no Survivor settings edit can ever strand a
  pick from the form (the server-side start re-resolution remains the one
  invalidating change).
- **Lost: eliminate-on-tie leagues.** A league that wants ties to kill would
  need this ADR reopened; the restore is re-adding the enum, the parameter,
  and the branch — mechanical, and justified only by a real league asking.
- The wire enum `SurvivorPushTieResolution` leaves the contract; stale
  clients' bodies are stripped rather than refused.
