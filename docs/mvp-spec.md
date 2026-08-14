# Picks Leagues — MVP Product Spec (v0.3)

**Status:** Draft for review
**Companion doc:** *Picks Leagues Architecture* (how it's built)
**Amendments:** v0.3 stays locked and is amended by recorded ADRs rather than re-versioned. ADR-0018 (a Pick'em week is one atomic, immutable submission; push fixed at +0.5; no Pick'em tiebreaker), ADR-0019 (week moves out of scope, in both NFL modes), ADR-0020 (Pick'em's Start Week + End Week settings become one three-option season range, resolved to concrete weeks at league creation; the presets themselves were later retired by ADR-0031), ADR-0023 (Game Mode 2 is named **Survivor**; it was called "Elimination" in this document's original v0.3 text and in every ADR numbered below 0023), ADR-0024 (Survivor has no season-range setting — the server resolves and stores a regular-season range), ADR-0025 (a Survivor member cannot submit a pick once their elimination has settled), ADR-0026 (Survivor is straight-up only — its Pick Type setting is removed; Pick'em keeps its own), ADR-0029 (invite links are generated pre-start only; revoking one stays available anytime), ADR-0031 (Pick'em is regular-season only — the Season Range setting and its Postseason/Full Season presets are removed; the server resolves and stores the regular-season range, as ADR-0024 already does for Survivor), ADR-0032 (invite links are bare opaque codes — the optional expiry and max-use caps are removed; revocation is an invite's only lifecycle), ADR-0033 (Survivor's Push/Tie Resolution setting is removed, fixed at its default — a tie advances with the team consumed — leaving Survivor with no league settings at all), and ADR-0034 (March Madness scoring is Standard Doubling only and the pre-deadline seed-correction wipe is an admin-by-hand procedure — both cut before the mode was built) are reflected in the rules below.

This document is **standalone and complete**: it contains the full MVP rule set for every game mode. No other rules document is required to build the MVP. Features deferred beyond MVP are listed in *Explicitly Out of Scope* and are not specified here.

## Product Summary

A web app where friends create and compete in sports pick'em leagues. MVP ships three game modes — NFL Pick'em, NFL Survivor, and March Madness Pools — with private invite-link leagues, public league discovery, and standings that update by the next morning after games complete.

## MVP Scope at a Glance

| Area | In MVP |
| --- | --- |
| Game modes | NFL Pick'em (standard scoring), NFL Survivor (1 life), March Madness Pool |
| Auth | Google + Discord OAuth |
| Leagues | Private (invite links) + Public (browse/search discovery) |
| Standings freshness | Scores and standings refresh every ~5 minutes on game days |
| Notifications | None — users check the app |
| Platform | Responsive web (mobile-first) |
| Internal | Season simulator in test environments |

## Users & Identity

**Sign-in:** Google or Discord OAuth only. No email/password and no email sending of any kind.

**Profile:** every user has a **unique username** and a **display name**.
- Username rules: 3–20 characters; letters, numbers, and underscores only; uniqueness is case-insensitive (stored and displayed lowercase). Chosen at first sign-in; changeable at any time to any unclaimed name; the old name is released immediately.
- Display name: prefilled from the OAuth provider; freely editable.
- Avatar: prefilled from the OAuth provider; a user may override it from the profile screen with an `https:` image URL of their own, and clearing the override reverts to the provider's. The app stores a link, never image bytes — there are still no uploads. (ADR-0022)

**Onboarding flow:** OAuth → claim username (first time only) → dashboard. If the user arrived via an invite link, they return to the join flow immediately after.

**Limits:**
- A user may **join** unlimited leagues (one membership per user per league; self-competition is impossible by construction).
- A user may be **commissioner of at most 10 active leagues** (active = created and not yet concluded). Creating a league — or being promoted to commissioner — beyond the cap is blocked with a clear message. Deleting a pre-start league, a league concluding, or being demoted frees a slot. (ADR-0004)

**Account deletion:** permanent and immediate; the profile is **anonymized in place** rather than removed, so picks, results, and standings history survive in every league.
- Username is released (immediately claimable by others); display name is replaced with a "Deleted User" placeholder; the email is replaced with a non-identifying placeholder; avatar (both the provider value and any member-set override, ADR-0022) is removed, along with OAuth identities and all sessions.
- Signing in again with the same provider afterward creates a brand-new account — there is no undelete or reconnection.
- Deletion is **blocked** while the user is the last commissioner of any non-empty active league — they must promote a replacement first (same ≥1-commissioner guard as leaving; ADR-0004).

## Leagues (global rules, all game modes)

### Creation
Any user can create a league (subject to the commissioner cap). Creator becomes a commissioner — leagues may have several (see Commissioner Powers). Flow: choose game mode → name the league → set visibility → configure mode settings → league exists in a pre-start state.

### Visibility
- **Private:** joinable only via invite link.
- **Public:** appears in the discovery list and is joinable directly.

### Invites
- Any commissioner generates invite links containing an opaque code, **pre-start only** — once the league starts no new link can be minted, because the join cutoff below would refuse every use of it. (ADR-0029)
- A link is a bare opaque code: no expiry, no use cap. Revocation (below) is its only lifecycle — nobody handing a link to friends sets an expiry, and the leak case was already answered by revocation. (ADR-0032)
- Visiting a link while signed out routes through sign-in and back to the join screen.
- A pasted link **previews as an invitation**, naming the league, its mode, and the spots left, so a link in a group thread reads as an invite from a friend rather than as an advert for the app. A revoked or unknown code previews generically — it must not report whether a code was ever real. This is the one read in the product answered without a session, and its scope is exactly those fields; see ADR-0038 for what that discloses and why the bound is where it is.
- Any commissioner can revoke an outstanding invite link at any time, including after the league has started — a link minted pre-start outlives the start, so killing a leaked one has to stay possible for as long as the link does. (ADR-0029)
- Invite links work for public leagues too (they're just an alternate path to the same join).

### Membership
- League size: **2 minimum, 100 maximum**.
- Join cutoff: no joins once the league's first week has started (NFL modes) or once the first Round of 64 game has tipped (March Madness). Enforced automatically; not configurable.
  - A Pick'em league created mid-week starts at the next week whose first kickoff is still ahead (ADR-0020's rule, kept by ADR-0031), so between its creation and that kickoff it has a short window in which members can still be invited and join, after which membership freezes at the same cutoff as any other league. That short window is **intended**: it is the existing cutoff meeting a new creation path, not an exception to it.
- A league that never reaches 2 members by its start simply proceeds; standings with one member are valid but trivially uninteresting. No auto-cancellation.
- Leaving: a member may leave a league **pre-start only** — once the league starts, membership is frozen and there is no mid-season leaving. The last commissioner of a league with other members must promote a replacement before leaving; a commissioner who is the only member deletes the league instead. (ADR-0004)

### Commissioner Powers
A league has **one or more commissioners**, all with identical powers, and must have **at least one at all times** — any demotion, kick, leave, or account deletion that would leave zero commissioners is blocked. (ADR-0004)

| Power | Availability |
| --- | --- |
| Edit cosmetic fields (league name) | Anytime |
| Edit league settings | Pre-start only; settings lock at league start |
| Kick members | Pre-start only |
| Delete league | Pre-start only |
| Promote a member to commissioner | Anytime (subject to the recipient's cap) |
| Demote a commissioner (including stepping down) | Anytime, while at least one commissioner remains |
| Generate invite links | Pre-start only (a link minted after the start could never be used) |
| Revoke invite links | Anytime (a pre-start link outlives the start, so it stays killable) |

Once a league starts: membership and settings are frozen except cosmetics, commissioner promotion/demotion, and revoking an outstanding invite link. No mid-season kicks, deletes, leaves, settings changes, or new invite links — disputes resolve socially, not in-app.

### Pick Visibility (all modes)
A member's picks become visible to other league members **per game, at that game's kickoff/tipoff**. Before kickoff, only the picking member can see their own pick. Eliminated players (Survivor mode) retain identical visibility rights to active players.

### Public Discovery
A browse page listing public leagues that have not passed their join cutoff and are not already full, with **search by league name** and a **filter by game mode**. Each entry shows: name, game mode (given visual prominence — it is the attribute that decides whether a member wants the league at all), member count against the cap and the spots remaining, start week (or tournament year), the mode's member-facing settings summary, and a join button.

The settings summary is per mode and is a *chosen* subset, never the stored settings: Pick'em shows pick type and picks per week — the two settings that decide what the league asks of a member each week — and Survivor shows none, having no member-facing configurable setting. A member must be able to tell what they are signing up for before they join.

Entries are ordered by **remaining space, fullest first** (creation order as the tiebreak), so a league close to playing fills before an empty one, and are served **10 per page**. No categories or recommendations — the two filters run over data the list already carries, and nothing here is editorial. (ADR-0037.)

---

## Game Mode 1: NFL Pick'em

A season-long league where members compete to build the best record picking NFL games each week, on both a weekly and a cumulative season leaderboard.

### League Settings
1. **Pick Type** — Straight Up (SU) or Against the Spread (ATS); applies to all picks all season
2. **Picks Per Week** — 1–16 (default 5)

**Pick'em has no season-range setting.** The mode is regular-season only, so the regular season is the only range it can ever run, and a control offering one option is not a choice. The league's week range is instead resolved server-side when settings are written — regular-season week 1 through week 18, advanced past any week already under way so the league is never born already-started — and stored as the concrete week refs the join cutoff and settlement compute on. Once the league starts, the range it resolved to is fixed. Commissioners see the resolved range read-only. (ADR-0031, applying ADR-0020's mid-week resolution rule the same way ADR-0024 does for Survivor.)

### Core Rules
- Each week, every member submits **one set of picks** — the week's full required set, in a single submission — from the current week's NFL slate. All of the week's games are eligible, including Thursday night. Preseason, the playoffs, and the Pro Bowl are never eligible — Pick'em is regular-season only (ADR-0031).
- Members choose their own games; overlap with other members is not required.
- **Fewer games than Picks Per Week:** if the week's slate has fewer available games than the configured count, all members pick every available game that week.
- **One submission per week, and it is final.** A week's picks go in together, in one submission, behind a confirmation stating that it cannot be undone. Once it lands, no pick in that week can be changed, replaced, or removed — there is no second submission and no editing. A misclick is permanent for that week.
- **Locking:** each pick locks independently at its game's kickoff — the moment it becomes visible to the rest of the league and, for a member who has not submitted yet, the moment its game drops out of what they can still pick.
- **ATS spread acceptance:** in ATS leagues, the member accepts the spreads shown at submission time, on the whole set, in the one write that creates it. Spreads cannot be selectively frozen, because there is only ever one write. SU leagues have no spread dependency.
- **Missed/partial weeks:** a submission must be the **full required set** for the week, which is Picks Per Week or the number of games still unlocked and pickable at the moment of submission, whichever is smaller. A member who submits after some of the week's games have kicked off submits a full set of what can still be picked; the games that already locked are forgone and score nothing. A member who never submits scores zero for the week — there is no auto-submission and no default entry. This is deliberately **not** a weekly deadline: locking stays per game, and submitting late costs picks rather than the week.
- **Pick window:** only the current week can be submitted — or the next week, once every game in the member's current-week submission has finished. A member who never submitted waits for the week to turn over. A current week holding no games opens the next week for everyone — there is nothing in it to resolve. Picking further ahead is refused (ADR-0036).

### Scoring
| Outcome | Points |
| --- | --- |
| Correct | +1 |
| Incorrect | 0 |
| Push (ATS) / Tie (SU) | +0.5 |
| Game cancelled | Treated as push |

### Standings
Two parallel leaderboards:
- **Weekly** — that week's points only; resets each week.
- **Season** — cumulative points from the league's start week through its end week. A week with no submission counts as zero toward the season total. One week of participation is sufficient to appear.

**Ties (weekly and season):** members who tie on points **share the rank**. There is no tiebreaker, and nothing is shown behind the rank to separate tied members.

### Cancellations & Postponements
- **Cancelled game:** the pick resolves as a push, and the push **stands** — there is no substitute pick, whether or not unstarted games remain in the week.
- **Postponed within the same week:** pick resolves normally when played.

### Edge Cases
- Identical pick sets between members are allowed and will tie on points, sharing the rank.
- A member who joins after the league's start week (but before the join cutoff) simply has zero-point weeks for weeks already completed.

---

## Game Mode 2: NFL Survivor

A survivor pool. Each week, every member picks one team to win **straight up**. Correct → advance. Incorrect or no pick → eliminated. Last member standing wins.

### League Settings

**Survivor has no league settings.** Every rule that was once a setting is fixed by the mode: on a tie the member **advances and the team is consumed** — the game was played, so the team is spent, and NFL ties are too rare (one or two a season) to earn a knob (ADR-0033, which retired the Push/Tie Resolution setting at that default). The remaining fixed rules are below.

**Survivor has no Pick Type setting.** The mode is straight up only, so a pick carries no spread and there is nothing to accept at pick time. Picks stay changeable until kickoff (below), and against-the-spread grading is priced at pick time — the two together would let a member re-pick the same team purely to be re-graded against a friendlier line, which rewards refreshing rather than picking. Pick'em keeps its own Pick Type, because its week is a single immutable submission and has no second write to shop with. (ADR-0026.)

**Survivor has no season-range setting.** The mode is regular-season only, so Regular Season is the only range it can ever run, and a control offering one option is not a choice. The league's week range is instead resolved server-side when settings are written — regular-season week 1 through week 18, advanced past any week already under way so the league is never born already-started — and stored as the concrete week refs the join cutoff and settlement compute on. Commissioners see the resolved range read-only. (ADR-0024, applying ADR-0020's mid-week resolution rule.)

### Core Rules
- Survivor is **regular-season only** — playoff weeks are not supported for this mode (weekly team-consumption doesn't fit 2–14-team playoff slates).
- One pick per week per member. Each member has exactly **one life** — a single incorrect pick eliminates.
- **Team reuse:** a member may pick each NFL team at most once per league. Consumed teams are unavailable for that member's future weeks.
- Picks can be made or changed until the picked game's kickoff, and become visible to the league at kickoff.
- **Pick window:** only the current week can be picked — or the next week, once the member's current-week pick has resolved without eliminating them (a win, a tie, or a cancellation's push). A loss or a missed pick opens nothing; the next week becomes pickable when it becomes current. A current week holding no games opens the next week for everyone — there is nothing in it to resolve (ADR-0036).
- **Missed pick:** the member is eliminated (resolved at settlement after the week completes).
- **Everyone eliminated in the same week:** all members eliminated that week are revived and continue. (Applies regardless of elimination cause — wrong picks, missed picks, or a mix.)
- **Cancelled game:** pick resolves as a push — the member survives and the team is **not** consumed (available for future use). A game the provider moves to another week is not a modelled event in either NFL mode (ADR-0019); an admin corrects it with a `cancelled` status override, which lands here.
- **Postponed within the same week:** pick resolves normally when the game is played.
- Eliminated members remain league members with full pick visibility.
- **Eliminated members cannot pick.** Once a member's elimination has *settled*, the pick endpoint refuses them. A pick made before that settlement — in the gap between busting and the week being settled — is accepted and simply grades to nothing; that gap is what keeps the revival rule above honest, since revived members' next-week picks were legitimately made while they still read as alive (ADR-0025).

### End of League
The league concludes at whichever comes first: the last week of its resolved range settles, or settlement leaves **exactly one member alive**. The members alive at that moment win it — if there are several, they are **co-winners** and share first place. There are no extension weeks and no further tiebreaker.

A sole survivor ends the season because ending it is what settles the result: no further week is played, so there is no later pick that could change who won, and a decided winner is never asked to play on against nobody. Being the only member a league ever had is not the same thing — the season ends when it has been *reduced* to one. (ADR-0027.)

### Standings View
A survivor board: every member with status (alive/eliminated), week eliminated, weekly pick history (revealed per kickoff), and teams consumed.

---

## Game Mode 3: March Madness Pool

A bracket pool for the NCAA Men's Basketball Tournament. Members submit brackets predicting every game from the Round of 64 through the Championship.

### League Settings
1. **Max Brackets Per Member** — 1–10 (default 5)
2. **Visibility** — Public or Private (global rule, listed here because pools are created per tournament)

**There is no Scoring Model setting.** Scoring is Standard Doubling for every pool — a friends' pool doesn't tune per-round values, and the Custom model was cut before the mode was built (ADR-0034).

### Bracket Structure
- The tournament field is 68 teams; the **First Four is not picked**. Picks open once all First Four games conclude and the 64-team field is set.
- Rounds picked: Round of 64 (32 games), Round of 32 (16), Sweet 16 (8), Elite Eight (4), Final Four (2), Championship (1) — **63 picks per bracket**.
- Each bracket also requires a **Championship Score Prediction**: a whole-number estimate of the combined final score of the Championship game (tiebreaker).

### Submission & Locking
- All brackets must be submitted before the first Round of 64 game tips off.
- A bracket is accepted only when complete: all 63 picks + Championship Score Prediction. No partial brackets.
- Brackets are **immutable** after the deadline.
- Members may submit up to the pool's Max Brackets; each is labeled ("Bracket 1", "Bracket 2"), tracked, and scored independently. Unused bracket slots carry no penalty.
- A member with no submitted bracket by the deadline has no entry.

### Scoring
**Standard Doubling:**
| Round | Points per correct pick |
| --- | --- |
| Round of 64 | 1 |
| Round of 32 | 2 |
| Sweet 16 | 4 |
| Elite Eight | 8 |
| Final Four | 16 |
| Championship | 32 |

A pick is correct if the picked team wins that game, regardless of path (a team picked to reach a round via one opponent still scores if it arrives via another).

### Standings
Single cumulative pool leaderboard, updating as games complete. One row **per bracket** (a member with multiple brackets appears once per bracket, with member name shown). No per-round reset.

### Cancellations & Vacated Teams
- If a game is cancelled or a team is disqualified/vacated mid-tournament: that game's pick resolves as a **push** (no points, no penalty).
- The affected slot **auto-advances** through the bracket. Downstream picks involving that slot remain live and score at full value if correct.
- If the auto-advanced team later loses, picks on it simply miss; picks on its opponents score normally.

### Tiebreaker
When brackets tie on points: closest **absolute difference** between the Championship Score Prediction and the actual combined final score wins. Over and under are treated identically. Equidistant brackets share the rank; still-tied brackets share the rank. Applies across members and between one member's own brackets.

### Edge Cases
- Identical brackets (same 63 picks, same score prediction) are allowed and tie completely.
- Original Selection Committee seeds and pairings are used throughout; there is no re-seeding.
- If the app publishes an incorrect seed/region that is corrected **before** the deadline: an admin handles it by hand — correcting the data and telling affected members to resubmit — rather than an automated wipe-and-resubmit flow (ADR-0034; a once-a-tournament case at this scale). After the deadline, seedings are frozen for scoring.
- A game postponed within the tournament resolves normally when played.

---

## Core User Flows

1. **Sign up / sign in** — OAuth (Google/Discord) → username claim (first time) → dashboard
2. **Create a league** — mode → name → visibility → settings → share invite link (blocked past 10-active-commissioner cap)
3. **Join a league** — invite link or public discovery → confirm → member
4. **Make picks** — league page → weekly slate (NFL modes) or bracket builder (MM) → submit. Pick'em: the week's full set goes in one confirmed, irreversible submission, which is also where ATS spreads are accepted. Survivor: the week's pick can be changed until its game kicks off. March Madness: a bracket can be revised until the first Round of 64 tip, then freezes.
5. **Check results** — scores and standings refresh every ~5 minutes on game days
6. **Commission** — settings pre-start, invite links generated pre-start and revocable anytime, kick/delete pre-start, promote/demote commissioners anytime

## Screens (MVP inventory)

- **Dashboard** — my leagues with pick-status at a glance (picks in / picks needed / locked), each card naming when the league starts or, once it has, the week it is on; the create and browse entry points sit together here, since getting into a league is one job with two answers
- **Discovery** — public league browse, name search, and mode filter (ADR-0037)
- **League home** — standings (primary view: season standings for Pick'em (ADR-0035 — weekly boards live on the League Picks screen), the survivor board for Survivor, bracket leaderboard for MM), members, league info, commissioner tools
- **Pick entry** — weekly slate picker (Pick'em/Survivor) or bracket builder (MM); each NFL game row opens its **matchup stats sheet** (below)
- **Week/pick detail** — all members' picks for a week/round, revealed per game at kickoff

Pick entry and week/pick detail are **sibling sections of a league, each week-scoped on its own** ("My Picks" / "League Picks"). Entering your own picks and reading the league's are different tasks on different cadences, and neither may be reachable only as a side effect of another surface's control. Each defaults to the current week rather than inheriting one from wherever the member came from.

**Pick entry has two states, and shows what each one is for.** An unsubmitted week is an editable sheet the member assembles: the games they can still pick, a save control that stays inactive until the sheet holds the week's full required set, and an explicit confirmation that submitting is irreversible before anything lands. A submitted week is **read-only** — their picks, with the spreads they accepted, which is the week in review rather than a slate to scan past. A member who picked nothing sees a stated empty result, never a blank card.

**Week/pick detail is ordered by the week's standing, best first,** with each member's weekly and season record beside their name and their picks collapsed beneath it — including the viewer's own, whose picks have their own screen. The page therefore opens as a weekly leaderboard and expands into detail on request. The order is the standings' own rank (§Standings), where members tied on points share it and nothing is drawn between them, never a second ranking invented for this screen. Ordering by settled results cannot disclose a hidden pick: points come only from graded picks, and a graded pick's game is final and therefore already revealed.
- **League create/settings** — mode-specific settings forms
- **Profile** — username, display name
- **Join** — invite link landing + confirmation
- **Rules guide** — static in-app reference, one page per game mode, covering scoring, locking, visibility, cancellations, and tiebreakers exactly as specified in this document. Linked from league pages and pick entry.

**UI conventions:** all kickoff times, deadlines, and timestamps display in the **user's local timezone** (browser-detected). Standings pages show a "last updated" timestamp. The UI never claims real-time freshness.

**Upcoming kickoffs and deadlines read relative to now** — "Today 1:00 PM", "Tomorrow 8:20 PM", "Sun 1:00 PM" — falling back to the absolute stamp a week out, where a weekday name stops distinguishing itself from today. A week's slate is nearly always inside that window, so the relative form is the one that answers "when do I need to have picked". It is scoped to things that have *not happened*: settled kickoffs, "last updated" stamps, and audit rows keep the precise instant, because "yesterday" beside a final score is less use than a date.

That "now" is the **application's clock, never the browser's** (architecture D13). Under the simulator the two sit at different instants, so a browser-clock label would announce that a game the API has already locked kicks off tomorrow. The clock reaches the client on the session bootstrap response, and the client keeps the *offset* so time continues to move between fetches.

Scores are always shown with **each number attached to its team** (`NE 19 – SEA 21`), never as a bare pair — away-first order is a convention a member should not have to know to read their own pick.

**Provisional pick standing.** While a game is in progress, a pick shows where it currently stands against the score of the last sync: in ATS, its margin relative to the spread it accepted; in straight-up, its margin on the scoreboard. This is a **reading, not a verdict**, and the distinction is enforced in the presentation:

- It is stated as a signed magnitude ("covering by 7.5", "short by 2.5", "up 4"), never as an outcome word ("winning", "correct") — a magnitude reads as a snapshot, and a snapshot is what it is.
- It never borrows the settled outcome's colour or iconography. A graded pick's badge is the only thing in the app that asserts a result.
- It is computed from the **same function settlement grades on**, so a provisional reading can never contradict the outcome that replaces it.
- It appears only while the game is in progress, alongside the existing "as of" timestamp, and is **never aggregated** — there is no live projected score, standing, or leaderboard. Standings continue to update only as games go final.

This is not a live feed and does not change the freshness model below: it is a derivation over already-ingested data, refreshed on the same ~5-minute cadence as everything else.

**Settled pick margin.** Once a pick has graded, the row states the size of the result in the **past tense of the reading it replaces** — "covering by 7.5" becomes "covered by 7.5", "up 4" becomes "won by 4". A bare magnitude is not enough: a lone number does not say what it measures, and what it measures differs by pick type (points against an accepted spread, or points on the scoreboard). Tense is what keeps it from reading as a second verdict beside the outcome badge — one sentence resolving, not a new vocabulary appearing. Three consequences:

- A **push shows no margin.** There is no number to qualify, so the badge carries it alone — this is the one case where the words would be pure duplication.
- A game that has ended but whose pick has **not graded yet** shows nothing. The settlement sweep is a job, so that window is real, and a reading with no badge beside it to confirm it is worse than silence.
- The number is the **same measurement the in-progress reading showed**, now taken over a final score — which is what lets the tense do the work: one sentence resolving, not a new one appearing. It states the size of the result this member just got on this pick, and nothing more: it is never summed, and standings are points alone.

**Matchup stats sheet (ADR-0040).** Every NFL game row — pick entry in both modes, and the read-only slate preview — opens a per-game sheet of ingested stats, **tiered so help never becomes a wall of numbers**: the **basic** tier (default) shows each team's record, streak, points scored/allowed per game, and key injuries (statuses other than Questionable); the **advanced** tier, one explicit toggle away, adds league scoring ranks, home/road splits, point differential, last-five form, ATS record, the full injury report, and ESPN's FPI win probability — the one *prediction* on the surface, shown only here and always attributed to ESPN FPI. Stats carry the ingestion's "as of" stamp (freshness model below); until the current season has games, team stats fall back to last season's, labeled with the season they describe; whatever the provider hasn't published yet (early-season ATS, a missing injury report) is omitted, never faked. A third **results** segment (STAT-9) shows both teams' season game logs side by side — week, opponent, score, W/L, newest first, an in-progress game carried as a dated live score — served entirely from already-ingested games, with the same labeled prior-season fallback until a team has started games.

No standalone stats pages, head-to-head views, or historical archives — the matchup sheet is scoped to one game's pick decision, which is the carve-out ADR-0040 records, not a doorway to any of those.

## Data Freshness & Expectations

- Game scores refresh approximately every **5 minutes** during game days; pick outcomes, eliminations, and standings update on the same cadence as games go final.
- The app is not real-time within those 5-minute windows — the UI shows a "last updated" timestamp and users refresh/reload to see the latest, with no live push.
- Spreads refresh several times daily; the spread shown and accepted at pick time is the spread of record for that Pick'em pick. Survivor is straight up and stores no spread (ADR-0026).
- Schedule changes (cancellations, postponements) are reflected by the next daily schedule sync; a cancelled game's picks show as pushes shortly after.
- Team stats and injury reports (the matchup stats sheet) refresh **daily**; the sheet shows its own "as of" stamp rather than implying game-day freshness (ADR-0040).
- A nightly reconciliation pass re-verifies all results and standings, so any late stat corrections are reflected by the next morning.

## Testing & Internal Tooling (non-production)

**Season simulator** — available in local and staging environments only, never production. Enables end-to-end validation of scoring, standings, eliminations, bracket progression, and data ingestion without waiting for real games.

Capabilities:
- **Simulated clock:** advance app time week by week (or to arbitrary timestamps) so kickoff-derived locking, join cutoffs, and deadlines behave as they would live
- **Fixture results:** load or hand-edit game outcomes (scores, spreads, finals) for any simulated week, including edge-case fixtures: pushes, ties, cancellations, postponements, all-eliminated weeks, vacated bracket slots
- **Step-through settlement:** trigger settlement per simulated week and inspect resulting pick outcomes and standings at each step
- **Real-data mode:** alternatively run ingestion against real ESPN data (historical or live) to validate the integration itself
- **Reset:** wipe a test league or the whole environment to a known state

Acceptance bar: every scoring rule and edge case in this spec is reproducible in the simulator.

## Explicitly Out of Scope (MVP)

Confidence scoring · Money Pick · Survivor lives > 1 · Buy-back · Survivor extension weeks ("continue until one winner") · March Madness upset & perfect-round bonuses · other game modes (H2H, App-Wide Pick'em, Win Total Pool, Franchise Pool, App-Wide Bracket) · email of any kind · push notifications & deadline reminders · native mobile apps · custom avatars · league chat/comments · historical season archives · configurable join cutoffs · cross-league pick accuracy stats · real-time score updates · Pick'em pick editing after submission · Pick'em cancellation re-picks · a configurable Pick'em push/tie value · custom Pick'em week ranges (the regular season is the only range — ADR-0031) · Survivor against-the-spread picks

## Decisions Log

| Decision | Outcome |
| --- | --- |
| Pick'em scoring | Standard only; Confidence + Money Pick deferred |
| Cancellation re-picks | Shipped, then removed (ADR-0018); a cancelled game's pick pushes and the push stands |
| Pick'em pick entry | One submission per week, confirmed and immutable (ADR-0018) |
| Pick'em push value and ties | Fixed at +0.5, no setting; tied members share the rank with no tiebreaker (ADR-0018) |
| Pick'em season range | No range setting — regular-season only; the server resolves and stores the range (ADR-0031, which retired ADR-0020's three presets) |
| Game Mode 2 name | Ships as **NFL Survivor**, the industry-standard term; called "Elimination" in the original v0.3 text (ADR-0023) |
| Survivor season range | No range setting — the server resolves and stores a regular-season range (ADR-0024) |
| Survivor pick type | Straight up only; the Pick Type setting removed, since changeable picks plus pick-time spreads reward refreshing (ADR-0026) |
| Survivor push/tie | Fixed at advance-with-team-consumed; the Push/Tie Resolution setting removed — NFL ties are too rare to earn a knob (ADR-0033) |
| MM scoring model | Standard Doubling only; the Custom per-round-values setting cut before the mode was built (ADR-0034) |
| MM seed-correction wipe | Admin-by-hand procedure, not an automated wipe-and-resubmit flow (ADR-0034) |
| Survivor lives | Fixed at 1; buy-back deferred |
| Survivor end-of-league | Co-winners share rank; no extension weeks |
| MM bonuses (upset, perfect round) | Deferred |
| Auth | Google + Discord OAuth; no email infrastructure |
| Identity | Unique username (3–20, `a-z 0-9 _`, case-insensitive) + display name |
| League creation cap | Max 10 active leagues as commissioner per user |
| Visibility | Private + Public with browse/search discovery |
| Public league abuse | No mitigation needed — no chat/UGC surface beyond league names |
| Commissioner powers | Kick/delete pre-start; promote/demote commissioners anytime; settings lock at start |
| Notifications | None |
| Timezones | User's local timezone everywhere |
| Rules guide | In-app static reference per mode, MVP rules only |
| Season simulator | Local + staging tooling; disabled in production |
