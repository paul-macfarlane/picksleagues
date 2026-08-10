# 0031. Pick'em is regular-season only; the season-range presets are removed

- **Status:** Accepted
- **Date:** 2026-08-09
- **Related:** [0020](0020-season-range-presets.md) (the preset machinery this
  removes; its mid-week resolution rule survives), [0024](0024-survivor-settings-carry-a-resolved-range.md)
  (the shape Pick'em now matches), [0007](0007-game-data-ingestion-model.md)
  (the "playoffs are MVP scope" owner decision this reopens; postseason
  *ingestion* is unchanged), [0021](0021-unseeded-playoff-games-excluded-at-ingestion.md)
  (stands — it governs ingestion, not league settings);
  `docs/mvp-spec.md` §Game Mode 1 League Settings; backlog SWP-1
  (`backlog/15-scope-sweep.md`)

## Context

Pick'em shipped with a three-preset Season Range setting — Regular Season,
Postseason, Full Season (ADR-0020) — because ADR-0007 recorded an owner
decision that playoffs are MVP scope. The support that decision bought is
week-ordering across the regular/postseason boundary, short-slate handling
(which the generic fewer-games-than-picks rule already covers), preset
availability endpoints, and a preset select on two forms.

The 2026-08-09 scope sweep (SWP-1) asked what a real league would miss. The
app serves friends and co-workers; a friends' Pick'em league is a
regular-season ritual that ends when the season does. Survivor already
reached the same conclusion from its own rules (ADR-0024): one legal range,
resolved server-side, no control. Keeping a three-way choice for Pick'em
alone means every range-touching surface — resolution, availability
endpoints, settings editors, the invalidation predicate — carries a branch
the audience won't take.

## Decision

**Pick'em is regular-season only.** The Postseason and Full Season presets
are cut, and with only one preset left, the setting itself goes — matching
Survivor's ADR-0024 shape exactly:

- The wire shape carries no range and no preset: `PickemSettingsInput` is
  `pickType` + `picksPerWeek`. A stale client still sending
  `seasonRangePreset` has it stripped, not refused — the same tolerance
  ADR-0024 records for Survivor's retired fields.
- The server resolves the one legal range — regular-season week 1 through
  week 18 — against the bound season and the clock on every settings write,
  applying ADR-0020's mid-week resolution rule unchanged (a league is never
  born already-started). The resolved refs are stored; commissioners see the
  range read-only.
- The stored schema's week refs are regular-only; a postseason ref in a
  stored Pick'em range is a bug, not a configuration.
- The preset availability endpoints (`GET /pickem/season-range-presets`,
  `GET /leagues/{id}/pickem/season-range-presets`) are deleted. With no
  choice to inform, the create form behaves as Survivor's already does: the
  server's `start_week_passed` refusal at submit is the enforcement.
- `pickemSettingsInvalidatePicks` loses its narrowing-end clause — the end
  week is fixed at 18 with no path that lowers it, and an inert clause reads
  as protection the code does not provide (the reasoning
  `survivorSettingsInvalidatePicks` already records). The start-advance
  clause stays: server-side re-resolution can still move the start under an
  unchanged request.

**Postseason ingestion is unchanged.** ADR-0007's sync jobs keep ingesting
seasontypes 2 and 3, and ADR-0021 keeps governing unseeded playoff rounds:
weeks and games are the data layer's mirror of the real season, feed the
admin browsers, and cost nothing to keep. What this ADR removes is the
league-facing consumption — no mode's settings can name a postseason week
anymore. The week-ordering scale (`nflSeasonOrdinal`) also stays: postseason
*rows* still exist in the season, so clipping a league's week list against a
regular-season range still has to place Wild Card after week 18.

This reopens and narrows two recorded decisions: ADR-0007's "playoffs are
MVP scope" now applies to ingestion only, and ADR-0020 is superseded — its
preset vocabulary is gone, while its mid-week resolution rule survives as
applied here and in ADR-0024.

## Consequences

- Both NFL modes now resolve the identical fixed range through the identical
  path; the mode-neutral resolver stops carrying a per-preset branch, two
  endpoints and their web hooks are deleted, and the create form and settings
  editor lose a select in favor of the read-only range line Survivor already
  renders.
- **Lost: playoff and full-season Pick'em leagues.** Restorable the way
  ADR-0020 said custom ranges were: the stored shape still carries concrete
  week refs, so a future range option writes refs, not schema surgery. The
  postseason data it would consume is still being ingested.
- Lost: the create form's pre-submit "nothing startable" hint, which was
  built on the preset availability endpoint. Pick'em now learns a dead
  season at submit time via `start_week_passed` — the exact behavior
  Survivor has always had.
- A stored *Regular Season* row written under ADR-0020 still parses: the
  retired `seasonRangePreset` key is stripped by the schema, and the refs it
  sits beside are what everything downstream computes on. A stored Postseason
  or Full Season row would **not** parse — its refs are postseason, which the
  regular-only schema rejects into the logged 500. That is acceptable only
  because there are no active leagues in any environment (owner, 2026-08-09),
  which is why this ships as a cut with no data migration.
- **Revisit if** a real league asks to keep picking through the playoffs;
  that request reopens this ADR with the restore path above.
