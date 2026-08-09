# 0025. Survivor pick persistence: a settlement-maintained team ledger, and settlement is prefix-ordered

- **Status:** Accepted
- **Date:** 2026-08-07
- **Related:** `docs/mvp-spec.md` §Game Mode 2 (Core Rules, Standings View, Pick Visibility);
  `docs/architecture.md` §Domain Model (amended by this ADR), §Settlement & Scoring,
  §Locking Model, D9–D11; [0009](0009-multi-season-leagues.md) (constraints scope to the
  league-season instance), [0015](0015-pickem-pick-entry-semantics.md) (settlement must
  never be left unrunnable), [0016](0016-per-mode-result-and-standings-tables.md) (the
  per-mode pick/result/standings triple), [0019](0019-week-moves-out-of-scope.md) (an admin
  `cancelled` override replaces the week move), [0023](0023-survivor-is-the-mode-name.md),
  [0024](0024-survivor-settings-carry-a-resolved-range.md); backlog ELM-2, ELM-3, ELM-4

## Context

ELM-2 builds the Survivor pick write path. Four questions have to be answered before a row
can be written, and each of them is answered by something outside the ticket — a constraint
the spec contradicts, a schema sketch that predates the board it has to feed, a gap the spec
leaves open, and a settlement shape that is not Pick'em's.

**The team-consumption constraint contradicts the cancellation rule.** ELM-2 requires
"unique team per member per league **as a DB constraint**", and ADR-0009 scopes such a
constraint to the league-season instance rather than the league. But spec §Game Mode 2 says a
**cancelled** game's pick "resolves as a push — the member survives and the team is **not**
consumed (available for future use)". A plain unique index over (instance, member, team)
would therefore refuse a re-pick the spec explicitly permits: the member holds a row naming
that team, the cancellation returned the team to them, and the index does not know it. Moving
the check into the service is not an escape — it drops the ticket's stated "as a DB
constraint" requirement, and an app-level check races, since two concurrent writes can both
read the same team as unconsumed.

**`survivor_state` exists in the architecture sketch as three words.** It reads
"`lives_remaining` (default 1), `eliminated_at`, revived flags", written before the survivor
board it feeds was specified. Spec §Standings View asks that board for "week eliminated", and
the spec's revival rule ("everyone eliminated in the same week is revived") is not stated as
a once-per-season event.

**The spec is silent on whether an eliminated member may submit a pick.** It grants them
"full pick visibility" (§Game Mode 2, §Pick Visibility) and stops there. Silence at a write
endpoint is not a permission; it is a question the implementation has to answer either way,
and answering it wrong is exploitable rather than loudly broken.

**Survivor settlement has a cross-week dependency Pick'em does not.** Pick'em grades each
pick against its own game; a week settles in isolation. Survivor's two headline rules —
missed-pick elimination and everybody-busts revival — are **week-total facts computed against
the alive-set the previous week produced**. Whether a member missed a pick is only meaningful
if they were alive to miss it, and whether "everyone" busted is a count over that same set.

## Decision

**1. The team ledger is a partial unique index over a settlement-maintained `released`
flag.** `survivor_picks` carries `released boolean not null default false`, and team
consumption is enforced by a **partial** unique index on
`(league_season_id, league_member_id, team_id) WHERE NOT released`.

The database therefore encodes exactly the spec's rule rather than an approximation of it: a
team is consumed while a live pick names it, and a cancellation that releases the team also
releases the index slot, so the member's legal re-pick simply inserts.

Because the spec lets a Survivor member *change* a pick until kickoff — unlike Pick'em, whose
week is immutable once submitted (ADR-0018) — the write path is an **upsert against the
one-pick-per-week unique**, rewriting `team_id` on the existing row. A change of mind
therefore frees the old team's index slot in the same statement that claims the new one, and
there is no second row to leave behind. Delete-then-insert would be the shape that could.

`released` is written **only by settlement** — never by the pick endpoint — and is set true
when the pick's game resolves to status `cancelled`. "Resolves" means `override_* ??
provider_*`: since ADR-0019 removed `moved` from the status set, an admin `cancelled`
override is the mechanism by which a real week move reaches this flag at all.

**2. Release is sticky once it has been relied upon.** A full recompute clears `released`
only while **no later `NOT released` pick by the same member on the same team exists**.

The failure this prevents is total, not cosmetic. A game is cancelled; settlement releases
the team; the member legally re-picks that team in a later week; an admin then reverts the
cancellation. Without the sticky rule the recompute recreates two live ledger rows for the
same (member, team), collides with the partial unique index, and aborts — leaving that
league-season **permanently unsettleable**. That is precisely the failure class ADR-0015 §3
refused for Pick'em: a stranded row taking down settlement with no remedy short of a database
edit. With the sticky rule settlement always completes. The reverted game's pick grades
normally for survival, and the team having effectively been used twice is the audited
consequence of the operator's flip-flop (`admin_audit` records the override and its prior
value), not something a member did.

**Refusing the override was considered and rejected.** Games are shared across every league
that picked them, so one member's re-pick in one league would block a correction to shared
game data for *all* of them — and a game that was truly played would be left with no legal
correction path at all. The operator must always be able to make the game data true; this
ADR chooses where the resulting anomaly lands.

**3. `survivor_state` is a settlement-maintained ledger keyed by instance and member.**
`league_season_id` + `league_member_id` (unique pair), `lives_remaining int not null default
1` — the deferred-feature column the architecture already names — `eliminated_week_id`
nullable FK, `revived_count int not null default 0`, `updated_at`.

Rows are minted at settlement, and **absence of a row means alive with one life**. That is
what keeps the table a pure derivation (arch D10) rather than something the join path has to
maintain: no join, renewal, or membership edit writes here, so a full recompute reproduces
the table exactly, and a league that has never settled is correctly described by an empty
table rather than by rows nobody has audited.

This **refines** the architecture's sketch ("`lives_remaining` (default 1), `eliminated_at`,
revived flags"). A week ref answers the question the survivor board actually asks — spec
§Standings View wants "**week eliminated**" — where a timestamp would have to be mapped back
onto a week by every reader that displays it, each doing it slightly differently. A count
records revival history that a boolean discards; the spec's revival rule can in principle
fire more than once in a season, and a flag cannot say it did.

**4. `survivor_pick_results` completes the per-mode triple, and lands with ELM-4.**
`survivor_pick_id` (unique, cascade), `league_season_id`, `league_member_id`, `week_id`,
`outcome`, `settled_at` — and deliberately **no points column**. ADR-0016 already established
that survive/eliminate has no points and that Survivor's board is not a ranking; a nullable
points column would be a column this mode never writes, which is the shape that ADR rejected.

It is named in this ADR rather than deferred to ELM-4's own record because the engineering
rules treat the per-mode `<mode>_picks` / `<mode>_pick_results` / `<mode>_standings-or-state`
set as **one** design, and a reader of this ADR needs the whole persistence picture to judge
the rest of it. The table ships beside the settlement that writes it.

**5. An eliminated member cannot submit a pick, judged on *settled* state.** The pick
endpoint refuses a member whose settled `survivor_state` says eliminated, with a
`member_eliminated` refusal.

The subtlety is the word *settled*. Between a member busting and their week actually
settling, `survivor_state` still reads alive, and picks made in that window are **accepted by
design**. Settlement is the moment of truth — the spec makes this explicit for missed picks,
"resolved at settlement after the week completes" — and the lag is what keeps the revival
rule honest: members keep picking until settlement declares the week, so when *everyone*
busts, the revived members' next-week picks were legitimately made and are already sitting
there rather than having been refused by an endpoint that guessed ahead of the settlement.
A pick landed in the lag window by a member whose elimination then settles grades to nothing
and consumes nothing.

The spec grants eliminated members full **visibility** and says nothing about entry. This
rule fills that gap rather than deviating from it; `docs/mvp-spec.md` §Game Mode 2 now states
it alongside the visibility rule.

**6. Survivor settles per completed week, prefix-ordered.** A league-season week settles only
when (a) every game in it is terminal — resolved status final or cancelled — **and** (b)
every in-range prior week is already settled. A change to the inputs of an already-settled
week re-settles **from that week forward**: the incremental path is "replay from the earliest
affected week", never "settle the affected week alone".

This is load-bearing rather than an optimization. Missed-pick elimination and revival are
week-total facts over the alive-set the previous week produced, so a later week settling
against a wrong alive-set produces wrong eliminations — not a stale number, a wrong member's
season ending. And an override that flips a week-3 outcome invalidates every downstream
alive/eliminated/revived state, so leaving the replay to the nightly sweep would show wrong
member-visible survivor state for up to a day. Pick'em needs no such invariant because
per-game settlement carries no cross-week dependency, which is the whole reason this one has
to be written down.

## Consequences

**The database now states the spec's team rule exactly, including its exception.** A member
whose game is cancelled can re-pick that team and the index agrees; nobody has to remember an
app-level carve-out, and the race an app-level check would have had does not exist.

**`released` is a stored flag on a table whose other truths are derived, and that is a real
cost.** It is legitimate only because settlement owns every write to it and a full recompute
reproduces it — with the one deliberate exception in rule 2, where recompute preserves a
release that a later pick has relied on. That exception is the price of never being
unsettleable, and it is the thing to re-examine first if this design ever misbehaves.

**Flip-flopping an override can leave a member having used one team twice.** This is visible
and attributable rather than hidden: the override and its prior value are in `admin_audit`,
and the survivor board shows the member's consumed teams. No automated remedy is offered,
because every automated remedy either voids a legal member action or refuses a legal operator
one.

**Settlement ordering constrains ELM-3 and ELM-4's job design.** The settle path takes a
league-season and a starting week, not a week alone, and the admin rebuild is the same replay
from the instance's first week. A caller that wants "just this week" has to prove the prefix
is settled, which the (b) precondition enforces rather than trusts.

**Absence-means-alive means every reader of `survivor_state` must left-join, not join.** A
member with no row is alive with one life; an inner join silently drops exactly the members
who have not been settled yet, which on an unsettled league is all of them.

**Revisit if** lives > 1 ships (rule 3's `lives_remaining` stops being a constant and
elimination stops being a single week ref), or if a second mode acquires a
settlement-maintained consumption ledger — at which point the `released` mechanism is worth
generalizing rather than copying.
