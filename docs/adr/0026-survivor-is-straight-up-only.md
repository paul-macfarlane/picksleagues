# 0026. Survivor is straight-up only; the Pick Type setting is removed

- **Status:** Accepted
- **Date:** 2026-08-07
- **Related:** `docs/mvp-spec.md` §Game Mode 2 (amended by this ADR); `docs/architecture.md`
  §Spread strategy, §Domain Model, §MVP Rule Scope (all amended by this ADR);
  [0018](0018-pickem-atomic-immutable-weekly-submission.md) (a Pick'em week is one atomic,
  immutable submission — the reason this collision is Survivor's alone, and the ADR that
  collapsed `odds_snapshots` into a single current spread),
  [0024](0024-survivor-settings-carry-a-resolved-range.md),
  [0025](0025-survivor-team-ledger-and-prefix-ordered-settlement.md); backlog ELM-1, ELM-2,
  ELM-3

## Context

Survivor carries two rules that are each defensible alone and, taken together, hand the win to
whoever refreshes the page most often.

- **A Survivor pick can be changed until the picked game's kickoff** (spec §Game Mode 2 Core
  Rules). This is deliberate: a member who picks on Tuesday and reads Saturday's injury report
  should not be stuck.
- **An ATS pick is graded against the spread stored at pick time** — `spread_at_pick` on the
  pick row, the same rule `packages/scoring/src/pickem.ts` applies to Pick'em. This is also
  deliberate: the number the member accepted is the number they are judged against.

Together they are a **one-way ratchet**:

- Take a team at −3. The line drifts to −1. Re-pick that same team and you are now graded at
  −1, which is strictly easier — you need to win by more than one point instead of more than
  three.
- The line drifts to −6 instead? Keep the −3 you already hold, and change nothing.

The member never loses by re-checking, so the optimal strategy is simply to re-check often.
That is a pure attention edge with no skill in it — it rewards the member who had the app open
on Friday afternoon, not the one who read the matchup better. And it bites harder in Survivor
than the same mechanic would anywhere else, because a Survivor pick is the member's **single
life** rather than one of a dozen weekly picks: the shopped half-point is the difference
between a season and an exit.

**Pick'em does not have this problem, and the reason is structural.** ADR-0018 made a Pick'em
week one atomic, immutable submission, so a member who accepts −3 has no second write in which
to accept −1. There is nothing to shop. Survivor deliberately keeps changeability, so the
collision exists here and only here.

**No UI can fix it**, which is why this is a rule change and not a screen change. Today the
Survivor sheet shows each team's *current* line and never shows the number the member actually
locked in, so the ratchet is live but invisible. That is not a position worth defending: a
member cannot see their own number, and the arrangement is not even neutral — it advantages
whoever tracks lines outside the app against whoever trusts the screen. The honest fix is to
show it ("you hold −3; the line is now −1"), and the honest fix makes the ratchet the
*advertised* interaction: the app would be telling every member, every week, exactly when
re-picking is free money. Every truthful presentation of this mechanic makes it worse.

**Alternatives considered.**

- **Grade ATS at the closing line instead of at pick time.** This genuinely kills the ratchet:
  every member on a game is graded against the same number, so re-picking buys nothing and the
  reason to refresh disappears. It is rejected on **cost, not on merit** — ADR-0018 collapsed
  `odds_snapshots` into a single current `games.spread`, so there is no line history to grade
  from, and capturing a per-game closing number means reintroducing a capture job, a storage
  shape, and a definition of "closing" that the current schema actively fights. **This is the
  option to revisit first** if ATS Survivor is ever actually wanted.
- **Make ATS picks immutable while straight-up picks stay changeable.** Rejected. A rule whose
  *shape* changes with a league setting is a rule every member has to learn twice, and gets
  wrong the first time they join a league configured the other way. It is also unkind in the
  specific case changeability exists for: a member who picks early and then sees injury news is
  told their league happened to pick the variant where that is their problem.

**And the fact that decides it: nobody has asked for ATS Survivor.** Survivor pools are
overwhelmingly played straight up. The ratchet is being carried for a configuration with no
demand behind it.

## Decision

**1. Survivor is straight-up only. The Pick Type setting is removed from Survivor** — from its
settings schema, from its wire input, and from its settings form. A Survivor pick is correct
when the picked team wins the game, full stop.

**Pick'em is untouched.** It keeps its own Pick Type setting and its full ATS behaviour; this
decision is about a mechanic that only exists where picks are changeable.

**2. Survivor stores no spread and performs no spread handshake.**
`survivor_picks.spread_at_pick` is dropped, the Survivor pick request carries no spread, and
the ATS acceptance handshake — the `spread_stale` and `spread_unavailable` refusals that
Pick'em's write path uses to reject a submission made against a moved line — **does not exist
on the Survivor write path**. There is no line to have moved.

**3. Push/Tie Resolution survives, narrowed to a straight-up tie.** (Owner decision,
2026-08-07.) The setting now reads: on a **tie**, the member advances and the team is consumed
(default), or the member is eliminated. The ATS push half of it goes with rule 1.

This is worth being honest about: NFL regular-season ties run roughly **0–2 per season across
the entire league**, so most Survivor leagues will never see this setting fire. It is kept
because it is already built and because on the rare week it does fire it decides whether a
member's season continues — which is not a question to answer by an implicit default nobody
chose.

**4. Stored Survivor settings are migrated.** ELM-1 already shipped `pickType` into stored
Survivor settings rows, so the key exists in the database today. Those rows are rewritten
rather than left to diverge from the schema: the engineering rules require a settings-JSONB
change to be either additive with a Zod `.default()` or accompanied by a data migration, and a
*removal* cannot be the former.

## Consequences

**The ratchet is gone, and with it the reason to refresh.** A Survivor member changing their
pick now changes only *which team* they are on. There is no number attached to the pick, so
there is nothing that re-picking can improve except the pick itself, which is the judgement the
mode is supposed to test.

**Surface this deletes.** `pickType` from the Survivor settings schema, input, and form;
`spread_at_pick` from `survivor_picks`; the `spread_stale` and `spread_unavailable` refusals
from the Survivor write path; and the ATS half of ELM-3's grading matrix — Survivor settlement
now grades one question, did the picked team win, against one input, the game's resolved
result.

**No Survivor setting a commissioner can change in the form invalidates picks any more.** Pick
Type was the last one — the range is server-resolved (ADR-0024) and Push/Tie Resolution changes
how a tie *grades*, not whether a stored pick is still legal. So the settings editor's "this
will discard picks" warning can never fire for a Survivor league, and its client-side machinery
is removed rather than left as a branch no state can reach.

**The server-side reset stays, and stays tested.** That is not the same thing as the warning: a
re-resolved start week can still strand picks outside the league's range, which is ADR-0015's
"a league re-enters pre-start mid-season" scenario and is genuinely reachable. Removing a
warning the UI can no longer justify is not a reason to remove the server rule that protects
settlement from a stranded row.

**Harder / accepted.** A league that wants ATS Survivor cannot have it, and there is no setting
to turn it back on. Anyone who wants it is asking for a rule change, not a configuration
change — which is the correct place for that conversation, given what the rejected alternatives
above cost.

**Revisit if** ATS Survivor is genuinely asked for. Do not restore the removed design: grade at
the **closing line**, not at pick time. Grading everyone on a game against the same number is
what makes ATS compatible with a changeable pick, and it is the only one of the alternatives
above that removes the ratchet rather than trading it for a rule members must learn twice. The
work it implies is line history the schema does not currently keep.
