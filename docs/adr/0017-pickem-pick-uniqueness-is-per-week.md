# ADR-0017: Pick'em pick uniqueness is per week, not per season

- **Status:** Accepted
- **Date:** 2026-07-30
- **Supersedes part of:** the `pickem_picks` constraint set introduced with PKM-2
- **Related:** ADR-0015 (pick entry semantics), ADR-0003 (migrations race the deploy)

## Context

`pickem_picks` carried `unique (league_member_id, game_id)`. Nothing scoped it to
a week, so a member could hold at most one pick on a given game for the whole
season.

That reach was never asked for. Pick'em's Core Rules (spec §Game Mode 1) say only
that each week a member submits up to Picks Per Week picks **from that week's
slate**. There is no once-per-game rule anywhere in them. The once-per rule the
spec does contain belongs to **Elimination** (§Game Mode 2): *"a member may pick
each NFL team at most once per league"* — a different mode, and a **team** ledger
rather than a game one. `docs/architecture.md` §D9 and the engineering rules both
list that constraint as Elimination's ("unique team per member per season",
"unique team per member per league (elimination)"). The Pick'em table's own
comment cited "spec §Core Rules" for a rule that isn't in them.

The cross-week scope only becomes reachable through a **provider week move**: a
game the member picked in week 1 is repointed to week 2. The week-1 pick is
retained and settles as a push (ADR-0015). The member then cannot pick that game
in week 2, where it is an ordinary game for everyone else.

Two costs followed, and the second is the serious one:

1. **A game is silently off their menu.** Every other member may pick it.
2. **A pick slot is lost outright when the cap meets the slate.** `picksAllowed`
   is `min(picksPerWeek, pickable games)`, computed from the slate globally and
   not per member. In a 16-game week with Picks Per Week 16, the member sees a cap
   of 16, can place only 15, and the 16th is refused. This also contradicts the
   spec's own **"Fewer games than Picks Per Week"** rule, which says all members
   pick *every available game* in a short week — unreachable for a member holding
   a blocked game.

The argument for keeping the block was that allowing both picks lets one matchup
yield the week-1 push *plus* a week-2 result — up to 1.5 points from one game.
That argument is wrong, because **each pick costs a slot**. Two slots returning at
most 1.5 is *below* the 2.0 two ordinary picks are worth. Allowing the re-pick is
neutral-to-slightly-negative for the member who does it; it was never an
advantage, so there was no harm being prevented.

## Decision

Scope the constraint to the week:

```
- unique (league_member_id, game_id)
+ unique (league_member_id, game_id, week_id)
```

A member may hold one pick per game **per week**. The same game picked in two
different weeks — only reachable after a provider week move — is legal, and each
pick settles by its own week: the pick whose week no longer matches the game's
resolves as `moved` → push, the one that matches grades normally. Settlement
needed no change; it already keys on that comparison.

Same-week duplicates remain impossible. The batch endpoint's `seen` set and the
repick path's `alreadyPicked` check both refuse them, `lockLeagueMemberRow`
serializes a member's concurrent submissions, and the constraint stays as the
backstop behind all three.

## Consequences

- Migration `0018` drops the old constraint and adds the week-scoped one. The new
  constraint is strictly **more permissive**, so rows written by the previous
  deploy always satisfy it — safe in either order across the migration/deploy
  race (ADR-0003).
- The reverse of that race does need care: new code against the *old* constraint
  would still raise on the now-legal cross-week insert. `isDuplicatePickViolation`
  therefore matches both constraint names, so that window serves a typed
  `duplicate_pick` rather than a logged 500. The old name can be dropped once
  0018 is applied everywhere.
- Two integration tests that asserted `duplicate_pick` for the cross-week case now
  assert success. Their describe block is renamed for what it now pins.
- Elimination is unaffected. Its team-reuse ledger is a separate rule on a
  separate table (ELM-2), and per ADR-0016 it does not share Pick'em's.
- Not addressed here: whether a member *should* be told their pick's game moved
  into a week they are picking. Today they simply see the game as pickable. That
  is a UI affordance question, not a constraint one.
