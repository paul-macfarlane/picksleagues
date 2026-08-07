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

## Round 5 — settled pick margin (2026-07-29)

| # | Item | Resolution |
| --- | --- | --- |
| 4 | Show the win/loss/push margin on *completed* games too, in the pick card and in League Picks? | **Yes.** A graded row now reads `Correct · by 10`: the badge keeps the verdict, the number adds only the magnitude. The framing in the request is the justification — the standings' `Diff` column already sums these, so showing the per-pick contribution makes a tiebreaker auditable against the week that produced it instead of taking the total on faith. Verified at 390px: the commissioner's four settled picks read `by 10`, `by 4`, `by 4`, `by 17`, and the Diff column above them reads `+35`. |
| 5 | Does League Picks belong in its own tab? | **Yes — own tab (owner's call).** The Pick'em tab bar is now Overview / My Picks / League Picks / Members / Settings, each pick surface week-scoped on its own `?weekId=` and defaulting to the current week. Overview's standings-scope selector governs the board alone. |

**Why the settled phrasing is not the provisional phrasing.** "Covered by 7.5" would have
been the natural extension, and it is wrong here: the outcome badge sits twelve pixels
away asserting the same thing in the app's settled vocabulary, and two verdicts in two
vocabularies on one line is how a member starts wondering which one is authoritative.
The division is verdict-from-the-badge, magnitude-from-the-number, and it happens to make
both pick types read identically — `Incorrect · by 3` means "missed the spread by 3" in
ATS and "lost by 3" in SU without needing separate copy.

**Two states deliberately say nothing.** A push has no magnitude to state, whether it
landed exactly on the number or the game was cancelled out from under it. And a game that
has gone final but whose picks have **not graded yet** shows nothing at all: settlement is
a job, so that window is real, and a bare "by 10" with no badge beside it to give it
direction is worse than silence. That second case is why `pickStandingLabel` keys the
settled branch on *the grade existing* rather than on `status === FINAL` — the obvious
status check would have produced a directionless number during exactly that window.

**The extraction this forced.** Both pick surfaces had been restating the same three-part
guard inline (status check, null-score guard, `pickMargin` call), which is precisely how
they would have come to disagree about when a number may appear next to a pick — the same
class of drift that produced round 3's "8 of 5 picks". The rule now lives once, in
`pickStandingLabel`, and both surfaces call it with no local conditions of their own.
`pickMarginLabel` was renamed `provisionalMarginLabel` in the same pass: with two
phrasings in play, a name that doesn't say which one it is was an invitation to reach for
the wrong one.

**Item 5's real defect wasn't placement.** The week detail only appeared once a member
moved Overview's standings *scope* selector off "Season", which made the whole league's
picks a side effect of a standings control, left the most common pairing (season
standings while checking this week's picks) unreachable, and advertised itself nowhere —
nothing on Overview suggested that changing a dropdown would reveal a second card. Its
own tab fixes discoverability and the coupling together.

**A recommendation of mine was wrong, and the owner was right to push on it.** I argued
against the five-tab option partly on "two week states to keep in sync". There is no sync
burden: they are independent search params on independent routes with no shared store.
The only real question was whether switching tabs should *carry* the week, and the answer
is no — each surface defaults to the current week, which is what a member wants on the
tab they just opened. Worth remembering that "two states" and "two states to keep in
sync" are different claims, and only the second is a cost.

**A latent `TabNav` bug surfaced immediately.** The bar is `overflow-x-auto` and its
comment claimed it "scrolls rather than wraps", but its links had neither `shrink-0` nor
`whitespace-nowrap` — so at 390px "My Picks" and "League Picks" each compressed and wrapped
their own label, doubling the bar's height instead of overflowing it. Every tab in the app
had been a single short word until this round, so the container's stated behaviour had
never actually been exercised. Caught by looking at a phone-width screenshot; no assertion
would have flagged it.

**One extraction.** The two pick tabs are the same page frame around different content, so
the week-select shell (weeks query, its pending/error/empty states, and the
default-to-current-week rule) lives in `LeagueWeekPicker` rather than being copied. Its
`children` is a function so the resolved week arrives as a non-optional string — otherwise
both callers would restate a `{weekId && …}` guard the shell already enforces. Named
generically rather than `pickem*` because Elimination's weekly slate is the second mode
that will use it unchanged.

## Round 6 — pick-surface focus + League Picks rework (2026-07-29)

| # | Item | Resolution |
| --- | --- | --- |
| 1 | Rename the pick-entry route to `/my-picks` | Done (`7591649`). No redirect from `/picks` — the branch is unmerged and the old path was never shared. |
| 2 | My Picks should show only games I picked or can still pick | **Built**, with the predicate widened — see below. Owner accepted the three costs named up front: rows vanishing mid-Sunday, the full slate no longer existing anywhere in the app, and the need for an empty state ("You didn't make any picks this week."). |
| 3 | League Picks: collapsible per member, sorted by weekly success, records and ranks shown | **Built.** Rows stay compact (see the pushback below); each member is a `<details>` open by default, ordered by the server's weekly rank with the season standing as the fallback, and headed by week + season record. |
| 4 | Simulator banner handles mobile poorly | The link was a member of the same `flex-wrap` row as the text, so `ml-auto` pushed it onto a line of its own at phone width — right-aligned under nothing, reading as a stray third row. It is now a sibling of a wrapping text column and stays beside it, vertically centred; the `·` separator hides below `sm`, where the scenario takes its own line and a trailing separator would dangle. |

**The rule that makes item 2 work is not the one that was asked for**, and the difference
is the whole design. "Show it if I can still pick it" is right in one direction and wrong
in the other:

- **The cap alone must not hide a game.** At the cap with *unlocked* picks, a member can
  still switch into an unpicked game — ADR-0015 replaces the whole week, so changing your
  mind usually means picking a *different* game. Hiding the target traps them. This is
  precisely the objection that defeated the round 2 and round 3 versions of this idea.
- **Openness alone must not show one.** At the cap with every pick locked there is no slot
  to free, so an unstarted game is unreachable however open it looks.

Both are satisfied by gating on the *week's* operability rather than the *game's*:
`held || (open && hasOperableControl(...))`. Sharing that predicate with the save bar is
deliberate — unpicked open games exist to be changed into, so they live and die with the
control that saves changes, and the screen becomes the week in review in the same render
the bar retires in.

**The testing gap was real and is now closed.** The merge-gate fixture has four games and
a cap of four, so "open" and "reachable" never diverge in it — the structural blind spot
that let round 3's action-bar bug ship, and one that would have left this filter untested
while looking covered. The journey now also drives a second league over the same slate
with a cap of 2, asserting both directions at the two clock positions it already passes
through: unpicked-and-kicked-off vanishes while swap targets remain, then the slate
collapses to the member's own two picks once nothing is operable. Confirmed by reverting
the filter and watching the E2E fail on exactly that assertion.

**Pushback that was accepted:** reusing the *editor's* row on League Picks. That row is
built around controls — two side buttons with `aria-pressed`, disabled states, cap logic,
the substitute dialog — all inert for another member's pick and roughly four times the
height of a compact line. The shared vocabulary already exists (`TeamLogo`,
`PickOutcomeBadge`, `GameStatePill`, `gameStateLabel`, `pickStandingLabel`); what differs
is layout, and it differs because the tasks differ. Collapsing would have solved the
height problem the tall row creates, but at the cost of cross-member comparison — "who
else took the Cowboys" reads down one column today and would have meant expanding two
members and scrolling past a thousand pixels. Compact rows plus collapse keeps both.

**A comparator bug caught by writing the test for the case, not the happy path.** The
first ordering used `rankA - rankB` with an `Number.isFinite` guard to skip unranked
members. But a ranked member against an unranked one yields `1 - Infinity === -Infinity` —
a correct *sign* that the finite check discards, silently falling through to the season
tiebreak and letting a season leader outrank someone who actually won the week. Comparing
(`x === y ? 0 : x < y ? -1 : 1`) instead of subtracting handles both sentinels, since
`Infinity === Infinity`. Verified by restoring the buggy version and watching the intended
test — and only that test — fail.

## Round 7 — settled copy + collapse default (2026-07-30)

| # | Item | Resolution |
| --- | --- | --- |
| 1 | "by X" is unclear on a resolved game | **Conceded — my round 5 call was wrong.** Settled picks now read as the past tense of the reading they replace: `covered by 7.5` / `short by 2.5` in ATS, `won by 4` / `lost by 2` straight-up. |
| 2 | Collapse League Picks by default | **Agreed, no pushback.** Every member starts closed, the viewer included. |
| 3 | Relative date displays app-wide | **Answered, not built** — see the note below; there is a prerequisite. |

**Why the bare magnitude was wrong.** Round 5 reasoned that the outcome badge owns the
verdict, so the number should carry only the size and never restate it. That protects
against a redundancy that turns out not to be the real risk. The actual problem is that a
lone number does not say *what it measures*, and what it measures genuinely differs by
pick type: 7.5 against the spread is points relative to a number the member accepted,
while 10 straight-up is points on the scoreboard. One word removes the guess.

Tense is what stops the fix from re-introducing the redundancy the original design feared.
"Covering by 7.5" becoming "covered by 7.5" is one sentence resolving, not a second
verdict appearing beside the badge — and a member who watches a game settle sees continuity
rather than a vocabulary change.

**Pushes still show nothing,** and this is deliberate rather than an omission carried
over. The ambiguity above is a property of *numbers without units*; a push has no number
to qualify, so "pushed" next to a badge already reading "Push" would be the one case where
the words really are pure duplication.

**On collapsing: the argument I lost was better than the one I made.** I had defaulted to
expanded to preserve cross-member comparison. But with rank and both records now in the
header, the collapsed page already *is* the comparison — a weekly leaderboard — and
opening a member is the question a reader actually arrives with. I also considered
auto-expanding the viewer's own row and rejected it: their picks have a whole tab of their
own, so that would spend the one open row on the least useful member.

**A measurement mistake worth recording, because it nearly became a bug report.** Checking
the chevron's rotation, my first probe was `memberRow(...).locator("svg").last()` — which
resolves to the last outcome icon in the *collapsed content*, not the chevron, because a
closed `<details>` keeps its children in the DOM. It read `none` in both states and looked
like proof the CSS variant was broken. Scoped to `summary > svg` it read `none` → `0deg`,
which was the transition caught at its first frame; polling showed it settling at `180deg`.
Two wrong readings in a row, both plausible, before the affordance turned out to be fine.
A screenshot taken immediately after a click is mid-animation and is not evidence.

## Round 8 — relative kickoff times, and a clock for the SPA (2026-07-30)

| # | Item | Resolution |
| --- | --- | --- |
| 3 | Relative date displays ("today", "Friday") — typical? worth it? | **Yes to both, and built.** Upcoming kickoffs now read `Today 1:00 PM` / `Tomorrow 8:20 PM` / `Sun 1:00 PM`, falling back to the absolute stamp a week out. Scoped to things that have not happened yet: settled kickoffs, "last updated" stamps and audit rows keep the precise instant. |

**The feature was the easy half.** Every relative label needs a "now", and the browser's
is the wrong one: under the simulator the app clock sits at a different instant — in the
merge-gate journey, three days apart — so a browser-clock label announces that a game the
API has already locked kicks off in three days. That contradiction would appear on exactly
the screens the simulator exists to exercise. Worth noting the time-discipline lint rule
(`no-restricted-syntax` on `Date.now()` / `new Date()`) covers `apps/api` and
`packages/*` but **not** `apps/web`, so nothing would have stopped it shipping. The
engineering rules now carry the SPA half explicitly.

So `/me` — the request every authenticated page already makes — carries the server's
reading, and `apps/web/src/lib/app-clock.ts` keeps the **offset** rather than the instant,
so time keeps moving between fetches instead of freezing at the last response.

**Three designs, two rejected by the linter, and it was right each time.**

1. A context provider deriving the offset in `useMemo`, with `useAppNow()` returning
   `new Date(Date.now() + offset)`. React Compiler's `react-hooks/purity` rejected both
   halves — and correctly: a clock read during render is impure, and two components in one
   pass can straddle a boundary and disagree.
2. Same provider with the offset moved into an effect. `react-hooks/set-state-in-effect`
   rejected that: no render caused this value, so it has no business being render state.
3. What shipped: an **external store**, which is what the thing actually is — a mutable
   value learned from the network and read during render, exactly the case
   `useSyncExternalStore` exists for. The offset is captured in the query layer where the
   response lands (the one moment the browser's clock is a valid reference for the
   server's), and `useAppNow()` subscribes. No provider, no effect, no state.

The third design also removed both caveats the first two had needed documenting: the
snapshot is a minute bucket (`===`-stable, as the store contract requires), so subscribers
re-render each minute and a page left open across midnight stops insisting on yesterday's
answer.

**The assertion that proves it.** Nothing else in the suite can tell the two clocks apart,
because outside the simulator they agree. After the journey advances simulated time three
days, the last game is ~12h out and must read "Today"/"Tomorrow" — a browser-clock label
would still call it three days away and print a weekday. Verified by swapping the offset
out and watching that one assertion fail.
