# Picks Leagues — MVP Product Spec (v0.3)

**Status:** Draft for review
**Companion doc:** *Picks Leagues Architecture* (how it's built)

This document is **standalone and complete**: it contains the full MVP rule set for every game mode. No other rules document is required to build the MVP. Features deferred beyond MVP are listed in *Explicitly Out of Scope* and are not specified here.

## Product Summary

A web app where friends create and compete in sports pick'em leagues. MVP ships three game modes — NFL Pick'em, NFL Elimination, and March Madness Pools — with private invite-link leagues, public league discovery, and standings that update by the next morning after games complete.

## MVP Scope at a Glance

| Area | In MVP |
| --- | --- |
| Game modes | NFL Pick'em (standard scoring), NFL Elimination (1 life), March Madness Pool |
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
- Avatar: pulled from the OAuth provider; no custom uploads.

**Onboarding flow:** OAuth → claim username (first time only) → dashboard. If the user arrived via an invite link, they return to the join flow immediately after.

**Limits:**
- A user may **join** unlimited leagues (one membership per user per league; self-competition is impossible by construction).
- A user may be **commissioner of at most 10 active leagues** (active = created and not yet concluded). Creating a league — or being promoted to commissioner — beyond the cap is blocked with a clear message. Deleting a pre-start league, a league concluding, or being demoted frees a slot. (ADR-0004)

**Account deletion:** permanent and immediate; the profile is **anonymized in place** rather than removed, so picks, results, and standings history survive in every league.
- Username is released (immediately claimable by others); display name is replaced with a "Deleted User" placeholder; the email is replaced with a non-identifying placeholder; avatar, OAuth identities, and all sessions are removed.
- Signing in again with the same provider afterward creates a brand-new account — there is no undelete or reconnection.
- Deletion is **blocked** while the user is the last commissioner of any non-empty active league — they must promote a replacement first (same ≥1-commissioner guard as leaving; ADR-0004).

## Leagues (global rules, all game modes)

### Creation
Any user can create a league (subject to the commissioner cap). Creator becomes a commissioner — leagues may have several (see Commissioner Powers). Flow: choose game mode → name the league → set visibility → configure mode settings → league exists in a pre-start state.

### Visibility
- **Private:** joinable only via invite link.
- **Public:** appears in the discovery list and is joinable directly.

### Invites
- Any commissioner generates invite links containing an opaque code.
- Links may optionally have an expiry and/or max-use cap.
- Visiting a link while signed out routes through sign-in and back to the join screen.
- Any commissioner can revoke an outstanding invite link at any time.
- Invite links work for public leagues too (they're just an alternate path to the same join).

### Membership
- League size: **2 minimum, 100 maximum**.
- Join cutoff: no joins once the league's first week has started (NFL modes) or once the first Round of 64 game has tipped (March Madness). Enforced automatically; not configurable.
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
| Generate/revoke invite links | Anytime (joins still blocked after cutoff) |

Once a league starts: membership and settings are frozen except cosmetics and commissioner promotion/demotion. No mid-season kicks, deletes, leaves, or settings changes — disputes resolve socially, not in-app.

### Pick Visibility (all modes)
A member's picks become visible to other league members **per game, at that game's kickoff/tipoff**. Before kickoff, only the picking member can see their own pick. Eliminated players (Elimination mode) retain identical visibility rights to active players.

### Public Discovery
A browse page listing public leagues that have not passed their join cutoff, with **search by league name**. Each entry shows: name, game mode, member count, start week (or tournament year), and a join button. No filters, categories, or recommendations.

---

## Game Mode 1: NFL Pick'em

A season-long league where members compete to build the best record picking NFL games each week, on both a weekly and a cumulative season leaderboard.

### League Settings
1. **Start Week** — NFL regular season week (1–18) or a playoff round (Wild Card, Divisional, Conference Championship, Super Bowl)
2. **End Week** — regular season week (1–18) or a playoff round, at or after Start Week in season order (playoff rounds follow week 18)
3. **Pick Type** — Straight Up (SU) or Against the Spread (ATS); applies to all picks all season
4. **Picks Per Week** — 1–16 (default 5)
5. **Push/Tie Resolution** — value awarded on an ATS push or SU tie: +0.5 (default), 0, or +1

### Core Rules
- Each week, every member submits up to Picks Per Week picks from the current week's NFL slate. All of the week's games are eligible, including Thursday night; in leagues whose End Week extends into the playoffs, each playoff round's slate is eligible in its week. Preseason and the Pro Bowl are never eligible.
- **Playoff weeks have small slates** (Wild Card 6 games → Super Bowl 1); the fewer-games rule below applies naturally — in a week with fewer available games than Picks Per Week, everyone picks every available game.
- Members choose their own games; overlap with other members is not required.
- **Fewer games than Picks Per Week:** if the week's slate has fewer available games than the configured count, all members pick every available game that week.
- Picks may be submitted individually or in batches, any time before each game's kickoff.
- **Locking:** each pick locks independently at its game's kickoff. Unstarted picks can be added or changed freely until their kickoff.
- **ATS spread acceptance:** in ATS leagues, changing any pick requires accepting the latest spreads on **all** of that member's unstarted picks — spreads cannot be selectively frozen. SU leagues have no spread dependency.
- **Missed/partial weeks:** unpicked slots score zero. There is no auto-submission or default entry. Submitting fewer than Picks Per Week is allowed; only submitted picks can score.

### Scoring
| Outcome | Points |
| --- | --- |
| Correct | +1 |
| Incorrect | 0 |
| Push (ATS) / Tie (SU) | Per league Push/Tie Resolution setting |
| Game cancelled, no re-pick made | Treated as push |

### Standings
Two parallel leaderboards:
- **Weekly** — that week's points only; resets each week.
- **Season** — cumulative points from Start Week through End Week. A week with no submission counts as zero toward the season total. One week of participation is sufficient to appear.

### Tiebreakers (weekly and season)
When members tie on points, rank by **cumulative margin differential** across all their picks in the period:
- **SU:** sum of each picked team's actual margin of victory (positive) or defeat (negative).
- **ATS:** sum of each pick's margin relative to the spread — covers positive, non-covers negative.
- Pushes/ties contribute zero. All picks weigh equally.
- Still tied → members share the rank. No further tiebreaker.

### Cancellations, Postponements & Re-picks
- **Cancelled game:** the pick resolves as a push. The member may **re-pick** by substituting any unstarted game from the same week:
  - SU: no spread acceptance required.
  - ATS: the member accepts the latest spread on the **replacement pick only** (other unstarted picks keep their spreads).
  - If no unstarted games remain, the push stands; no re-pick.
- **Postponed within the same week:** pick resolves normally when played. No re-pick.
- **Moved to a different week:** treated as a cancellation; re-pick rules apply.

### Edge Cases
- Identical pick sets between members are allowed and will tie on points and differential.
- A member who joins after Start Week (but before the join cutoff) simply has zero-point weeks for weeks already completed.

---

## Game Mode 2: NFL Elimination

A survivor pool. Each week, every member picks one team to win (SU or ATS per league setting). Correct → advance. Incorrect or no pick → eliminated. Last member standing wins.

### League Settings
1. **Start Week** — NFL regular season week (1–18)
2. **End Week** — regular season week (1–18), ≥ Start Week
3. **Pick Type** — Straight Up or Against the Spread
4. **Push/Tie Resolution** — on an ATS push or SU tie: member advances and the team is consumed (default), or member is eliminated

### Core Rules
- Elimination is **regular-season only** — playoff weeks are not supported for this mode (weekly team-consumption doesn't fit 2–14-team playoff slates).
- One pick per week per member. Each member has exactly **one life** — a single incorrect pick eliminates.
- **Team reuse:** a member may pick each NFL team at most once per league. Consumed teams are unavailable for that member's future weeks.
- Picks can be made or changed until the picked game's kickoff, and become visible to the league at kickoff.
- **Missed pick:** the member is eliminated (resolved at settlement after the week completes).
- **Everyone eliminated in the same week:** all members eliminated that week are revived and continue. (Applies regardless of elimination cause — wrong picks, missed picks, or a mix.)
- **Cancelled game or game moved to a future week:** pick resolves as a push — the member survives and the team is **not** consumed (available for future use).
- **Postponed within the same week:** pick resolves normally when the game is played.
- Eliminated members remain league members with full pick visibility.

### End of League
The league concludes after End Week resolves. If multiple members are still alive, they are **co-winners** and share first place. There are no extension weeks and no further tiebreaker.

### Standings View
A survivor board: every member with status (alive/eliminated), week eliminated, weekly pick history (revealed per kickoff), and teams consumed.

---

## Game Mode 3: March Madness Pool

A bracket pool for the NCAA Men's Basketball Tournament. Members submit brackets predicting every game from the Round of 64 through the Championship.

### League Settings
1. **Max Brackets Per Member** — 1–10 (default 5)
2. **Scoring Model** — Standard Doubling (default) or Custom (commissioner sets each round's per-correct-pick value independently; any non-negative integer)
3. **Visibility** — Public or Private (global rule, listed here because pools are created per tournament)

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
**Standard Doubling (default):**
| Round | Points per correct pick |
| --- | --- |
| Round of 64 | 1 |
| Round of 32 | 2 |
| Sweet 16 | 4 |
| Elite Eight | 8 |
| Final Four | 16 |
| Championship | 32 |

**Custom:** commissioner-configured per-round values. A pick is correct if the picked team wins that game, regardless of path (a team picked to reach a round via one opponent still scores if it arrives via another).

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
- If the app publishes an incorrect seed/region that is corrected **before** the deadline: all brackets are wiped and members are prompted to resubmit. After the deadline, seedings are frozen for scoring.
- A game postponed within the tournament resolves normally when played.

---

## Core User Flows

1. **Sign up / sign in** — OAuth (Google/Discord) → username claim (first time) → dashboard
2. **Create a league** — mode → name → visibility → settings → share invite link (blocked past 10-active-commissioner cap)
3. **Join a league** — invite link or public discovery → confirm → member
4. **Make picks** — league page → weekly slate (NFL modes) or bracket builder (MM) → submit; edit until per-game lock; ATS spread-acceptance prompt on changes
5. **Check results** — scores and standings refresh every ~5 minutes on game days
6. **Commission** — settings pre-start, invite management, kick/delete pre-start, promote/demote commissioners anytime

## Screens (MVP inventory)

- **Dashboard** — my leagues with pick-status at a glance (picks in / picks needed / locked); create + discover entry points
- **Discovery** — public league browse + name search
- **League home** — standings (primary view: weekly/season toggle for Pick'em, survivor board for Elimination, bracket leaderboard for MM), members, league info, commissioner tools
- **Pick entry** — weekly slate picker (Pick'em/Elimination) or bracket builder (MM)
- **Week/pick detail** — all members' picks for a week/round, revealed per game at kickoff
- **League create/settings** — mode-specific settings forms
- **Profile** — username, display name
- **Join** — invite link landing + confirmation
- **Rules guide** — static in-app reference, one page per game mode, covering scoring, locking, visibility, cancellations, and tiebreakers exactly as specified in this document. Linked from league pages and pick entry.

**UI conventions:** all kickoff times, deadlines, and timestamps display in the **user's local timezone** (browser-detected). Standings pages show a "last updated" timestamp. The UI never claims real-time freshness.

No standalone stats pages, head-to-head views, or historical archives.

## Data Freshness & Expectations

- Game scores refresh approximately every **5 minutes** during game days; pick outcomes, eliminations, and standings update on the same cadence as games go final.
- The app is not real-time within those 5-minute windows — the UI shows a "last updated" timestamp and users refresh/reload to see the latest, with no live push.
- Spreads refresh several times daily; the spread shown and accepted at pick time is the spread of record for that pick.
- Schedule changes (cancellations, moves, postponements) are reflected by the next daily schedule sync; affected picks show push/re-pick status shortly after.
- A nightly reconciliation pass re-verifies all results and standings, so any late stat corrections are reflected by the next morning.

## Testing & Internal Tooling (non-production)

**Season simulator** — available in local and staging environments only, never production. Enables end-to-end validation of scoring, standings, eliminations, bracket progression, and data ingestion without waiting for real games.

Capabilities:
- **Simulated clock:** advance app time week by week (or to arbitrary timestamps) so kickoff-derived locking, join cutoffs, and deadlines behave as they would live
- **Fixture results:** load or hand-edit game outcomes (scores, spreads, finals) for any simulated week, including edge-case fixtures: pushes, ties, cancellations, postponements, week moves, all-eliminated weeks, vacated bracket slots
- **Step-through settlement:** trigger settlement per simulated week and inspect resulting pick outcomes and standings at each step
- **Real-data mode:** alternatively run ingestion against real ESPN data (historical or live) to validate the integration itself
- **Reset:** wipe a test league or the whole environment to a known state

Acceptance bar: every scoring rule and edge case in this spec is reproducible in the simulator.

## Explicitly Out of Scope (MVP)

Confidence scoring · Money Pick · Elimination lives > 1 · Buy-back · Elimination extension weeks ("continue until one winner") · March Madness upset & perfect-round bonuses · other game modes (H2H, App-Wide Pick'em, Win Total Pool, Franchise Pool, App-Wide Bracket) · email of any kind · push notifications & deadline reminders · native mobile apps · custom avatars · league chat/comments · historical season archives · configurable join cutoffs · cross-league pick accuracy stats · real-time score updates

## Decisions Log

| Decision | Outcome |
| --- | --- |
| Pick'em scoring | Standard only; Confidence + Money Pick deferred |
| Cancellation re-picks | In MVP (standard-scoring rules) |
| Elimination lives | Fixed at 1; buy-back deferred |
| Elimination end-of-league | Co-winners share rank; no extension weeks |
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
