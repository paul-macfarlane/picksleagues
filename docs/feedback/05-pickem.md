# NFL Pick'em epic — feedback log

Rounds of human review feedback on `backlog/05-pickem.md` and how each item resolved.
See [README](README.md) for the convention.

## Round 1 — 2026-07-27

Review of PRs #18 (`feat/pkm-wave-1`), #19 (`feat/pkm-wave-2`), #20 (`feat/pkm-wave-3`).
All items were applied to `feat/pkm-wave-3` at the reviewer's direction — waves 1 and 2
keep their original naming, so the stack only reads consistently once #20 merges.

| # | Item | Resolution |
| --- | --- | --- |
| W1-1 | `routes/picks.ts` and the schemas are named generically, but a Pick'em pick is mode-specific; wanted repo-wide | **Done** — mode-scoped rename across DB tables, Zod schemas + OpenAPI components, API routes/services, HTTP paths, web modules, query keys, and components (`fdfa7cf`). Codified as an engineering rule so the next mode doesn't re-litigate it. |
| W1-2 | Settings form needs a warning before a change discards everyone's picks | **Done** — inline warning + confirm dialog with real counts, backed by a new `GET /leagues/{id}/pickem/pick-summary`; `pickemSettingsInvalidatePicks` moved to `packages/schemas` and the client parses through `LEAGUE_SETTINGS_SCHEMAS` so both surfaces share the rule *and* its inputs. A failed or errored summary query fails safe (warn + confirm without a count) rather than reading as "nothing at risk". The client's answer is advisory — the server's transactional read is authoritative — so a concurrent second commissioner can still see the two disagree. ADR-0015 updated. |
| W1-3 | Why `side` instead of a team id — referential-integrity risk? Could it change? | **Answered, kept, guarded.** `side` is deliberate: schedule sync `UPDATE`s `home_team_id`/`away_team_id` in place when the provider corrects a game, so a team-id pick would silently point at the wrong team or match neither and make settlement throw. It has no dangling-reference risk (the pick FKs `games`; `side` selects a column of that row) and spreads are home-relative, so `side` is what scoring consumes directly. Residual risk — a home/away *swap* silently repoints an existing pick — is now surfaced by `warnOnTeamCorrectionWithPicks`. |
| W2-1 | Are `pick_results`/`standings` really shared across modes, or Pick'em-specific? | **Forked per mode** → `pickem_pick_results`, `pickem_standings`. This deviates from locked architecture D9; recorded as **ADR-0016** with architecture.md and engineering.md amended. Spec evidence: Elimination's board is a survivor board with no points or rank, and March Madness ranks one row *per bracket*. `packages/scoring/src/standings.ts` stays generic — the ranking core was the only real reuse. |
| W3-1 | No code feedback | — |

**Decisions the reviewer made this round:** fork the tables rather than widen them with
nullable per-mode FKs; mode-scope HTTP paths as well as code; warn with real counts
rather than a static caveat.

**Carried forward:** `/admin/leagues/{id}/rebuild` keeps its mode-agnostic name and
dispatches to Pick'em only — it becomes a real per-mode dispatch when Elimination and
March Madness settlement land.

## Round 2 — 2026-07-27 (UX, after hands-on testing)

Eleven items from using the app. Landed on `feat/pkm-ux`, branched off
`feat/pkm-wave-3` so PR #20 stayed reviewable as the epic. Built by six agents over
disjoint file sets, then reviewed as one diff — the cross-agent inconsistencies that
parallelism invites were the review's main quarry, and it found several.

| # | Item | Resolution |
| --- | --- | --- |
| 1 | Odds missing for the 2026 season — bug? | **Yes, a real one.** `nflSeasonYearFor` returns `utcYear - 1` Jan–Jul, so all offseason a bare `sync-odds` targeted the *concluded* season, no-op'd, and never saw next season's already-ingested games. Not harmless: locking is `kickoff > now`, so an ATS league created in the offseason refuses every pick with `spread_unavailable`. `sync-odds`/`sync-scores` now roll forward to `seasonYear + 1` — query-only, never creating a row. Skipped runs also stopped reporting as successes. |
| 2 | Standings name truncated on mobile; want consistent user display | Shared `UserIdentity`: display name primary, `@username` secondary where there's room, dropped rather than truncating the name on tight surfaces. Email stays the session menu's exception (the viewer's own, possibly pre-claim, account). Codified in engineering.md. |
| 3 | Show wins/losses/pushes | Three columns on `pickem_standings`, tallied in the mode-agnostic `aggregateStandings`. Ranking deliberately unchanged — spec §Tiebreakers is points then differential; W-L-P is display data. |
| 4 | Sortable standings columns | Pure `sortStandingsRows`; server-assigned `rank` travels with its row and is never recomputed, so ties keep sharing a rank. |
| 5 | Team logos in the picks UI | Pure render — the pipeline already ran end to end and `apps/web` simply never referenced the fields. |
| 6 | Submitting requires scrolling past 16 games | Fixed action bar carrying progress and Save. `fixed`, not `sticky`: `Card`'s `overflow-hidden` would clip a sticky descendant. |
| 7 | Sticky league header and tabs? | **Tabs yes, header no.** Tabs are navigation and one line tall; the header is a title block already read, and pinning it would cost a large share of a 375px viewport on exactly the long-scroll screens. Offset by a measured `--app-header-height` because the sim banner changes the header's height. |
| 8 | Collapse to made picks after submitting? | **No — keep the full slate, mark what's picked.** ADR-0015's whole-week replace means changing your mind usually means picking a *different* game, which a made-picks-only view can't show. |
| 9 | Times show seconds | `formatDateTime` was a bare `toLocaleString()`; fixed in the helper so all 20 call sites follow. |
| 10 | Native date picker | shadcn CLI at the repo's `base-nova` style → Base UI popover + `react-day-picker` calendar. Verified it generated Base UI, not Radix. |
| 11 | Admin editing of games/scores/status | **ADM-2 built**: `PUT /admin/games/:id/override`, `admin_audit`, re-settlement via the existing `settlePicksForGames`. |

**Scope change:** `admin_audit` moved from ADM-3 into ADM-2 — engineering.md requires
every override to write it, which an override endpoint can't satisfy against a table
that doesn't exist. ADM-3 keeps the audit view. Rebuild auditing stays owed, and the
rule now says so instead of overclaiming.

**The round's most instructive defect** was ADM-2's unlock guard, which took three
attempts and is worth recording as a pattern rather than a bug.

Each attempt fixed the predicate and left the *scope condition* alone, so the invariant
kept widening while the set of requests that check it didn't:

1. **Transition test** (`was locked && would unlock && not scheduled`) — escapable,
   because the conjuncts read different halves of one request's own before/after pair.
   A status-only edit never touched the kickoff and so never tripped it; a three-step
   edit reached the same state one legal step at a time.
2. **Result test on status** (`!locked(after) && isStarted(after.status)`) — missed that
   only `SCHEDULED` hides scores in the UI, so `postponed` over a scored game rendered
   the outcome beside a pickable row.
3. **Result test on status *or* score**, still gated by `touchesLockState` — re-opened
   the hole through a score-only request, which is the likeliest real action on that
   screen (the form defaults the status select to "no override", so correcting a score
   sends scores alone and skips the guard).

The formulation that holds evaluates the **whole** invariant on both resolved states and
refuses only when it newly holds. No single request can move the row from non-violating
to violating, so no sequence can either — induction over requests, not a per-request
diff — while a row already violating from a provider bug stays editable.

Each attempt was caught by a different mechanism (evaluator, then the implementer
flagging its own work, then a re-read of a comment that no longer matched the code), and
each time what got verified was the line that changed rather than the condition guarding
it. Worth remembering the next time a guard is tightened: re-derive the scope, not just
the predicate.

## Round 3 — pick-screen polish, after hands-on testing (2026-07-28)

Six items from playing a simulated week through the UI. Landed on `feat/game-clock`
alongside the settled-pick grades from the previous exchange.

| # | Item | Resolution |
| --- | --- | --- |
| 2 | Week-detail picks misalign on mobile | Each pick is now a two-line block at phone width (pick, then game state), one line at `sm`+. It was a single wrapping flex row, so a short matchup fitted beside its status while a long one wrapped — the same information landed somewhere different on every row, which is what made the list hard to scan. |
| 3 | Backlog: user-editable profile image | Filed as **ID-4**, with the questions worth settling while planning it (URL allowlist vs any `https:`, broken-image behavior, and whether an arbitrary third-party image on a league-facing surface needs a trust-and-safety rule first). |
| 4 | Overview tab reads inactive once a standings period is picked | Router compares search params alongside the path by default, and `exact: true` makes that comparison a full equality — so the tab's own `?week=` made it non-matching. `includeSearch: false`: a tab marks a section, and the section is the path. |
| 5 | Hide unpicked/locked games once everything locks? | **Keep the full slate (owner's call).** Games lock one at a time through a Sunday, so a shrinking list is a moving target mid-scroll, and the games you passed on are the context for judging the ones you took. The *action bar* retires instead: once nothing is operable, a permanently-disabled Save is noise, so the bar unmounts and hands its count to the card header. Shipped once wrong — see below. |
| 6 | "In progress" indicator | New `GameStatePill`, on both the editor and the week detail. Takes the badge slot from "Locked" — an in-progress game has kicked off by definition, so the lock is implied and the live state is the fact worth the space. Deliberately static and never the word "Live": scores arrive on a sync job, so the UI must not read as a feed (same rule behind `gameStateAsOfLabel`). |
| 7 | Sticky bar showed "8 of 5 picks" | **Real bug.** The editor seeded its selection map from the slate *at mount* and never re-filtered it. A background refetch (tab away and back) brings in games that have since locked; those picks joined the retained set while staying in the selection map, and `heldCount` added the two. Any navigation remounted and re-seeded, which is why a refresh "fixed" it. The rule now lives in `isClosedToPicks` and is applied on every render, so the two sets stay exactly complementary. |

**The miscount was the round's only real defect, and its shape is worth keeping.** The
buggy line was a *filter applied once* where the data it filtered kept changing —
correct at mount and progressively wrong afterwards, in a component that remounts on
almost every path a developer would take to reach it. Deriving both maps from one
predicate on every render removes the window rather than narrowing it.

Its regression test needed the same care. The first attempt asserted the count
immediately after firing the visibility event and passed against the *pre-refetch*
render — green for the wrong reason. It now waits on a marker that can only appear once
the new slate has landed, and was confirmed by reverting the fix and watching it fail;
the same was done for the tab-active fix. A test written for a bug it has not been shown
to catch is a guess.

**Item 5 shipped wrong the first time, and the miss is the more interesting half.**
The bar was gated on "is any *game* still open", which sounds like the same question and
isn't. A week whose later kickoffs are hours away always has open games — so a member at
their pick cap with every pick already locked, who can operate no control on the screen,
still got the pinned bar and a Save that could never enable. Exactly the state the item
was about.

The condition that holds is "can any control be operated", mirroring a row's own two
gates: the game is open, *and* adding a new pick isn't refused by the cap. A held pick on
an open game therefore stays operable — giving it up is what frees the slot — while an
unpicked open game is dead weight once the cap is reached.

The lesson is about where the first version got its condition. It was derived from the
screen's *content* (what games exist) rather than from the member's *capability* (what
they can press), and those coincide in every state the merge-gate journey happens to
reach — its fixture has exactly as many games as picks allowed, so the cap and the slate
close together. The gap only opens when the cap is smaller than the slate, which is the
ordinary configuration for a real NFL week. A UI predicate about whether to show a
control belongs downstream of whether that control can do anything, not alongside it.

## Round 4 — provisional pick standing + score attribution (2026-07-29)

Two items raised as questions during round 3's review, both answered "build it".

| # | Item | Resolution |
| --- | --- | --- |
| 1 | Show whether an in-progress pick is currently winning/losing/pushing? | **Yes, as a reading rather than a verdict.** Written into the spec under §UI conventions before building. The value is real and concentrated in ATS: applying a home-relative spread to an away-first score is three steps a member will not do for five picks mid-Sunday. The constraints are what make it safe — a signed magnitude ("covering by 7.5", "up 4") never an outcome word, no colour and no glyph, only while in progress, beside the existing "as of" stamp, and **never aggregated** into a projected standing. |
| 2 | Unclear who has which score on a pick card | Every score now names its teams (`MIA 17 – BUF 27`) instead of rendering a bare away-first pair. One formatter in `gameStateLabel`, so both pick surfaces change together; the admin tables keep the raw `scoreText`, where the teams already have their own columns. |

**The anti-drift decision worth recording:** the provisional margin is computed by
`packages/scoring`'s `pickMargin` — extracted from the private `marginForPick` that
settlement already used — rather than reimplemented in the web app. Duplicating four
lines of sign arithmetic would have been easier, and the failure it invites is the one
that would cost the most trust: a row reading "covering by 3" and then grading
"Incorrect" with no score change in between. `apps/web` now depends on
`@picksleagues/scoring`, which the purity rule permits (it forbids what that package may
import, not who may consume it).

Extracting it surfaced a latent wart: negating a zero margin yields `-0`, which is
numerically zero but not `Object.is`-equal to it. Harmless in every comparison the code
performs, but this value is persisted as the tiebreaker `differential` and formatted for
display, so it is now normalised at the source. Found by a unit test asserting the new
export directly — the transitive coverage through `settlePickemWeek` never compared a
zero margin by identity.
