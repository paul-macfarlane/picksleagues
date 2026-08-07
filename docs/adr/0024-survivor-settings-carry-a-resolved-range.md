# 0024. Survivor settings carry a resolved season range, not a chosen one

- **Status:** Accepted
- **Date:** 2026-08-07
- **Related:** [0020](0020-season-range-presets.md) (the preset machinery and the
  mid-week resolution rule this reuses; its §Scope deferred Elimination to this
  build-out), [0023](0023-survivor-is-the-mode-name.md) (the mode's name),
  [0009](0009-multi-season-leagues.md) (per-instance settings; renewal copies
  verbatim), [0008](0008-league-season-binding.md) (`leagueStartAt` derivation),
  [0007](0007-game-data-ingestion-model.md) (Survivor is regular-season only);
  `docs/mvp-spec.md` §Game Mode 2 League Settings; backlog ELM-1
  (`backlog/06-survivor.md`, "Season range" header)

## Context

Spec §Game Mode 2 League Settings, as written at v0.3, asks a Survivor
commissioner for a Start Week and an End Week — two regular-season week numbers,
rendered as dropdowns in the create form and the settings editor, exactly as
Pick'em's used to be.

ADR-0020 replaced that pair for Pick'em with a three-option season-range preset
(Regular Season / Postseason / Full Season), resolved server-side against the bound
season and the injected Clock at creation and stored as the concrete
`startWeek`/`endWeek` refs everything downstream already computes on. Its §Scope
explicitly held the line at Pick'em: "Presets reach Elimination at its build-out,
not as a side effect of this one." This is that build-out, and the owner already
ruled on the answer (2026-08-02, recorded in the epic header under "Season range").

The answer is forced by a rule the mode already has. **Survivor is regular-season
only** (ADR-0007, 2026-07-22 — weekly team-consumption does not fit 2–14-team
playoff slates). Of ADR-0020's three presets, Postseason and Full Season are
therefore both illegal for this mode, and Regular Season is the only one left. A
select with one option is not a choice; it is a required click that can only
produce one answer, and shipping it would teach commissioners that a decision
exists where none does.

What the range refs are *used for* does not go away, though, and that is why the
setting cannot simply be deleted. `leagueStartAt` (ADR-0008/0009), the join cutoff,
week-range checks, and pick-invalidation comparisons all compute directly on stored
`startWeek`/`endWeek`. Whatever replaces the dropdowns still has to produce those
refs.

## Decision

**Survivor's season range leaves the settings form entirely and is resolved
server-side.** The create/update **input** carries `{ pickType, pushTieResolution }`
and nothing else — not a range, and not a preset field either, since the one
legal preset is implicit in the mode. The **stored** settings shape is unchanged:
the same concrete `startWeek`/`endWeek` week refs are written, so nothing
downstream of resolution learns that anything changed.

Resolution reuses Pick'em's helper rather than restating it, against a fixed
nominal range of regular-season week 1 through regular-season week 18:

- **Start** = the later of (a) regular-season week 1 and (b) the next
  regular-season week whose first **effective** kickoff
  (`min(coalesce(override_kickoff_at, kickoff_at))` across the week's games) is
  still after `clock.now()` — ADR-0020 §The mid-week resolution rule, verbatim.
- **End** = regular-season week 18, unadjusted.
- **No games in the season** (the provisional-season path, ADR-0009) → fall back to
  regular-season week 1.

Reusing that rule rather than pinning week 1 unconditionally is what keeps a
Survivor league from being **born already-started**: a league created on a Sunday
afternoon in week 6 would otherwise store a start week whose games have kicked off,
which means its join cutoff has already passed and its members are locked out of a
league they have not been invited to yet. Reuse also carries the rule's edge
behavior unchanged — a season with games but no future regular-season kickoff left
(a league created during the playoffs) resolves to nominal and is then refused by
`createLeague`'s `start_week_passed` 409, rather than silently creating a league
whose season is over.

Resolution runs when settings are **written**, which is only ever pre-start
(settings lock at league start, spec §Commissioner Powers): at creation, and again
on any pre-start settings save.

## Consequences

**One fewer setting on the form, and no lost capability.** The create form and the
settings editor render Pick Type and Push/Tie Resolution only. Nothing a
commissioner could previously express is gone: every legal Survivor range was
already the regular season.

**The resolved range is displayed read-only where the dropdowns were.** A
commissioner still needs to know which weeks their league covers — that fact drives
the join cutoff and the last week that scores. Removing the control is not the same
as hiding the answer, and a league whose covered weeks are invisible is a support
question waiting to happen.

**Renewal keeps ADR-0009's verbatim settings copy, which means a renewed league can
carry a stale resolved range.** `renewLeagueSeason` copies settings verbatim for
every mode, by recorded decision. So a league created mid-season — stored start =
regular week 5 — renews into the next season still carrying regular week 5, and
post-rename the form has no range control to correct it with. The remedy is the
existing one: **any pre-start settings save re-resolves the range server-side**,
because resolution runs on write. This is exactly what Pick'em relies on today; no
re-resolution at renewal exists there either. The owner confirmed keeping the
verbatim copy (2026-08-07) rather than deviating from ADR-0009 for one mode.

**The wire shape and the stored shape diverge, deliberately** — the same split
ADR-0020 made for Pick'em, and for the same reason: if the input accepted
`startWeek`/`endWeek`, a client could dictate the refs this ADR says are resolved
server-side against the clock. The stored shape is the resolved fact; the wire shape
is the request that produces it.

**Revisit if** Survivor ever stops being regular-season only (ADR-0007 is the thing
that would have to change first), at which point more than one preset becomes legal
for the mode and ADR-0020's select — not this ADR's absence of one — is the right
shape again.
