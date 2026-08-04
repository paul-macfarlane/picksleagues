# 0020. Season-range presets replace explicit Start Week / End Week

- **Status:** Accepted
- **Date:** 2026-08-04
- **Related:** [0008](0008-league-season-binding.md) (`leagueStartAt` derivation),
  [0009](0009-multi-season-leagues.md) (per-instance settings, provisional seasons); `docs/mvp-spec.md`
  §Game Mode 1 League Settings, §Membership (join cutoff); `docs/architecture.md` D11, D13, D15;
  backlog SIMP-17 (`backlog/12-simplification.md`)

## Context

Pick'em league settings today ask a commissioner for two `(week type, week number)` pairs —
Start Week and End Week — rendered as two dropdown pairs in both the create and settings forms.
That is more precision than the shape of a real Pick'em league ever needs: leagues run for the
regular season, the postseason, or the whole thing, and picking week numbers by hand to express
one of those three answers is friction with no corresponding decision behind it.

The resolved range is not cosmetic, though. `leagueStartAt` (ADR-0008, carried per-instance by
ADR-0009), the join cutoff, `nflSeasonOrdinal` week-range checks, and
`pickemSettingsInvalidatePicks` all compute directly on `startWeek`/`endWeek` refs. Whatever
replaces the two dropdowns has to keep producing those same refs — this is a form simplification,
not a change to what the system computes on.

## Decision

**Season-range presets replace explicit Start Week / End Week in Pick'em league settings.** One
select — Regular Season, Postseason, Full Season — replaces the two `(week type, week number)`
dropdown pairs the create and settings forms carry today.

### The three presets

Their nominal ranges are the season's own boundaries, in the week vocabulary the spec already
uses (§Game Mode 1 League Settings — regular-season weeks 1–18, then the playoff rounds Wild
Card, Divisional, Conference Championship, Super Bowl, in that order):

- **Regular Season** — regular-season week 1 through regular-season week 18.
- **Postseason** — Wild Card through Super Bowl.
- **Full Season** — regular-season week 1 through Super Bowl.

Each preset is a member-facing label for a nominal week range within the league's bound season
(ADR-0008/0009); it is not itself the stored range.

### Dropped: explicit custom ranges

Picking an arbitrary start week and end week is dropped as a capability. Nothing about the
storage shape forecloses it: the system still resolves and stores a concrete `startWeek`/
`endWeek` pair regardless of which preset produced it, so a fourth "Custom" option — if demand
appears — would simply write those two refs directly instead of having them resolved from a
preset name. This is restorable, not designed out.

### The resolved range is stored, not re-derived

At league creation, the preset is resolved once against the bound season and the clock, and the
concrete `startWeek`/`endWeek` refs are stored on the instance alongside the preset label. Reads
do not re-run resolution.

This matters because a league's own start week must not drift under it as the clock moves. If
"Regular Season" were re-derived from the preset name on every read, a league created in week 3
would keep reporting a start of "whatever the regular season's first week is" — which, read again
after the season has advanced, computes a different answer than it did the day the league was
created. A running league's start boundary would silently move. Storing the resolution at
creation pins it the same way every other one-time decision about a league instance is pinned.

**This is not a conflict with D11.** D11 governs *state that changes on its own* — lock status,
which is why `locked = kickoff_at <= clock.now()` is computed on every read rather than flipped
by a job. `leagueStartAt` itself stays exactly that kind of derived value: it is still computed
from the stored start week's games (`MIN(kickoff)` over the week, `override_kickoff_at ??
kickoff_at`, per ADR-0008/0009) every time it is read, never cached. What this ADR stores is a
different kind of thing — a **setting**, the commissioner's configuration choice of which weeks
the league covers — and settings have always been stored; nothing in D11 asks a `picksPerWeek` or
a `pickType` to be re-derived from first principles on every read either. Preset resolution is the
one-time act of turning a commissioner's choice into the two week refs the system already computes
on. It is not caching a derivation; it is writing down a decision, the same way any other setting
is written down.

### The mid-week resolution rule

Resolution runs at league creation, and again if a commissioner changes the preset in the
pre-start settings editor — the same path, against the clock as it stands at that moment. It
never runs on a read, and it cannot run at all once the league has started, because settings
lock at league start (spec §Commissioner Powers). "Resolved at creation" is therefore shorthand
for "resolved when the setting is written, which is only ever pre-start". Resolution reads the
**injected Clock** only — never
`Date.now()`, never SQL `now()` (arch D13):

- **Start** = the later of (a) the preset's nominal start week and (b) the next week whose first
  kickoff is still in the future.
- **End** = the preset's nominal end week, unadjusted.

"First kickoff" means the week's **effective** kickoff: `min(coalesce(override_kickoff_at,
kickoff_at))` across the week's games — the same expression the lock derivation uses to decide
whether a game (and, transitively, a week) has started. Reusing it here means resolution and lock
derivation can never disagree about which week has already begun.

The reason for the "later of" clause: without it, a league created on a Sunday afternoon, after
that week's early games have already kicked off, would resolve its nominal start week as its
stored start — and be born already-started. Its join cutoff would already have passed and its
members would already be locked out of a league they haven't been invited to yet. Advancing the
start to the next week whose first kickoff is still in the future avoids that; a league is never
born already-started.

### The no-games fallback

A league may be created against a **provisional** season — one whose weeks hold no games yet
(the offseason path, ADR-0009). With no kickoffs to compare, "the next week whose first kickoff is
still in the future" has nothing to evaluate. Resolution falls back to the **preset's nominal
start week** in that case. This is a real, reachable path — leagues are creatable for most of the
year against a season with no schedule yet — not a defensive branch guarding against data that
never occurs. Once real ingestion overwrites the provisional season in place, the stored range
does not retroactively change; it was resolved and stored once, at creation, per the rule above.

### The wire shape diverges from the stored shape

The create and update **input** carries the preset only. The server resolves the range and stores
it; the client never supplies `startWeek`/`endWeek` directly. This is deliberate: if the input
schema accepted explicit `startWeek`/`endWeek` fields, a client could set them and have them win,
which would mean the client is dictating the resolved refs this ADR says are resolved
server-side, at creation, against the clock. The stored schema and the wire schema are allowed to
diverge for exactly this reason — the stored shape is the resolved fact, the wire shape is the
request that produces it.

### Scope: Pick'em only, for now

This ADR governs Pick'em league settings only. Elimination keeps its explicit regular-season week
pair — `EliminationSettingsSchema` is untouched by this decision — until that mode is built out on
its own terms (epic 06). Presets reach Elimination at its build-out, not as a side effect of this
one. (Ruled by the owner, 2026-08-04.)

### The consequence this creates, and where it is answered

A league created mid-week — after the mid-week resolution rule has already advanced its start past
that week — still has a short window between creation and the resolved start week's first kickoff
during which the league is joinable, exactly as any pre-start league is. This is the existing
join-cutoff rule (spec §Membership) meeting a new creation path, not a change to the rule itself;
the window is short because resolution deliberately picks the *next* upcoming week rather than
leaving the league pinned to a week that has already begun. `docs/mvp-spec.md` states this
explicitly as part of SIMP-21; it is not restated here.

## Consequences

**Stays working unchanged, because the resolved refs are what gets stored:** `leagueStartAt`
(ADR-0008/0009) keeps deriving from a stored `startWeek` exactly as before; the join cutoff keeps
consulting `leagueStartAt`; `nflSeasonOrdinal` week-range checks keep comparing against stored
`startWeek`/`endWeek`; `pickemSettingsInvalidatePicks` keeps comparing old and new stored ranges to
decide whether a settings change strands picks. None of these needed to learn about presets —
presets are a resolution step that happens once, upstream of all of them.

**Simpler commissioner-facing settings.** One select instead of two week-number dropdown pairs, on
both the create form and the settings editor.

**Lost: fine-grained custom ranges.** A commissioner who wants a league running weeks 4–15 of the
regular season, say, cannot express that. This is accepted as a real capability loss, not an
oversight — restorable as a fourth "Custom" preset option if demand actually appears, at which
point it writes `startWeek`/`endWeek` directly rather than needing new storage.

**A provisional-season league's resolved range is fixed at creation and does not track later
schedule corrections.** If the real schedule, once ingested, turns out to place the regular
season's actual first week one earlier or later than the provisional placeholder assumed, an
already-created league's stored `startWeek` does not move. This is the same trade-off every
stored setting on a `league_seasons` instance already accepts (ADR-0009) — provisional data
existing at all is itself a deliberate choice to let leagues be created early, and it comes with
the possibility of a placeholder being slightly wrong. A commissioner can still adjust settings
pre-start.

**Revisit if** commissioners routinely ask for a range no preset expresses — the signal for
restoring a "Custom" option — or if Elimination's build-out (epic 06) finds the same three-preset
shape fits it too, at which point the scope restriction above is lifted deliberately rather than
by accident.
