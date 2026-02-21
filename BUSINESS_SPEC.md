# PicksLeagues — Business Logic Specification

> This document describes **what** the product does and **how it behaves** — not how it's built. It is intended as a framework-agnostic specification for building the application while preserving all business rules and user-facing behavior.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [User Accounts & Profiles](#2-user-accounts--profiles)
3. [Leagues](#3-leagues)
4. [League Membership & Roles](#4-league-membership--roles)
5. [Invitations](#5-invitations)
6. [NFL Weeks & Scheduling](#6-nfl-weeks--scheduling)
7. [Picks](#7-picks)
8. [Scoring & Standings](#8-scoring--standings)
9. [Odds & Spreads](#9-odds--spreads)
10. [Live Scores & Game Results](#10-live-scores--game-results)
11. [NFL Data Sync](#11-nfl-data-sync)
12. [User Flows](#12-user-flows)
13. [Permissions](#13-permissions)
14. [Business Constants](#14-business-constants)
15. [Future Features (Planned)](#15-future-features-planned)

---

## 1. Product Overview

PicksLeagues is an NFL Pick'Em app. Users create or join private leagues, make weekly game picks (straight-up or against the spread), and compete on a season-long leaderboard.

- **Sport**: NFL
- **Visibility**: Private leagues only (invite-based)
- **Authentication**: Social login only (Google, Discord) — no email/password

### Core Loop

1. User signs up via social login and sets up their profile
2. User creates a league or joins one via invite
3. Each NFL week, the user selects a configured number of game winners before the pick lock deadline
4. After games finish, picks are automatically scored
5. A season-long leaderboard tracks each member's wins, losses, pushes, and total points

---

## 2. User Accounts & Profiles

### 2.1 Registration

- Users sign up exclusively through OAuth (Google, or Discord)
- On first login, a profile is automatically created:
  - **Username**: randomly generated from the user's email, guaranteed unique, max 50 characters
  - **Name**: parsed from the OAuth provider's display name
- The user is then directed to a profile setup screen where they can customize these fields before entering the app

### 2.2 Profile Fields

| Field      | Rules                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------- |
| Username   | 3–50 characters. Must be unique. The value `"anonymous"` is reserved and cannot be used. |
| Name       | Required string                                                                          |
| Avatar URL | Optional. Must be a valid URL if provided.                                               |

Users can edit their own profile at any time. Users can search for other users by username or name (used when sending direct invites).

### 2.3 Account Deletion

Account deletion is a **soft anonymization** — the user's identity is scrubbed but their historical data (picks, standings) is preserved for league integrity.

**Process:**

1. **Blocked if** the user is the sole commissioner of any league that has other members. They must transfer the commissioner role first.
2. If the user is the sole member of any league, those leagues are deleted entirely.
3. The user is removed from all league memberships.
4. All authentication data is deleted (sessions, linked accounts).
5. The user's name is set to `"anonymous"`, email to `"anonymous"`, and all profile fields are cleared (username → `"anonymous"`, name → `"Anonymous User"`, avatar removed).
6. Historical picks and standings remain in place, now associated with the anonymized identity.

---

## 3. Leagues

### 3.1 Creating a League

When creating a league, the user configures:

| Setting        | Description                                         | Constraints                                                                                  |
| -------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Name           | Display name for the league                         | 3–50 characters                                                                              |
| Image          | Optional logo/avatar URL                            | Valid URL or empty                                                                           |
| Season Format  | Which portion of the NFL season the league covers   | One of three presets (see below)                                                             |
| League Size    | Maximum number of members                           | 2–20, default 10                                                                             |
| Picks Per Week | Number of game picks each member must make per week | 1–16, default 5                                                                              |
| Pick Type      | How picks are evaluated                             | "Straight Up" (just pick the winner) or "Against the Spread" (pick against the point spread) |

All leagues are **private** (invite-only).

#### Season Format Options

Instead of arbitrary start/end weeks, leagues must choose one of three preset formats:

| Format             | Weeks Included                                   |
| ------------------ | ------------------------------------------------ |
| **Regular Season** | Week 1 through Week 18                           |
| **Postseason**     | Wild Card through Super Bowl (Pro Bowl excluded) |
| **Full Season**    | Week 1 through Super Bowl (Pro Bowl excluded)    |

A league can only have **one season per NFL year**.

The creator automatically becomes the league's **commissioner** and is initialized with a standing of 0 points.

### 3.2 Updating a League

- **Name and image** can be changed by commissioners at any time, including during the season.
- **All other settings** (season format, size, picks per week, pick type) can only be changed when the league is **not in-season**.
- **League size** can never be set below the current number of members.

### 3.3 In-Season Detection

A league is considered **"in-season"** when the current date falls within any NFL week that is part of the league's chosen season format. For example, a "Regular Season" league is in-season from the start of Week 1 through the end of Week 18. This status gates many operations (see [Permissions](#13-permissions)).

### 3.4 Offseason Behavior

When a league is **not in-season** (offseason), the following activities are available:

- Members can leave the league
- Commissioners can edit all league settings (name, image, season format, size, picks per week, pick type)
- Commissioners can delete the league
- New members can be invited and join
- Commissioners can remove members

Picks cannot be made during the offseason. The UI should clearly communicate when a league is in the offseason.

### 3.5 Season Rollover

Leagues are **persistent** — they carry over from one NFL year to the next automatically. When a new NFL season begins:

- The league starts a new season based on its configured season format.
- **Standings reset to 0** for all members (wins, losses, pushes, points, rank).
- **Prior season standings are preserved** and can be viewed as historical records.
- Membership and roles carry over unchanged.
- No action is required from the commissioner — the league is ready to go when the new season's games are synced.

### 3.6 Deleting a League

Only commissioners can delete a league. Deletion removes all associated data: members, invites, picks, and standings.

---

## 4. League Membership & Roles

### 4.1 Roles

| Role             | Description                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| **Commissioner** | League creator or promoted member. Has full management access (settings, invites, member management). |
| **Member**       | Standard participant. Can make picks and view league data.                                            |

A league can have multiple commissioners.

### 4.2 Role Changes

- Commissioners can promote any member to commissioner or demote a commissioner to member.
- A commissioner **cannot demote themselves** if they are the only commissioner (there must always be at least one).

### 4.3 Removing Members

- Commissioners can remove other members, but **only when the league is not in-season**.
- When a member is removed, their historical picks and standings data remains.

### 4.4 Leaving a League

A member can leave a league under these conditions:

- The league is **not in-season**
- AND either:
  - They are the **sole member** (which deletes the league), OR
  - They are **not the sole commissioner** (another commissioner exists)

---

## 5. Invitations

There are two types of invitations: **Direct** and **Link**.

### 5.1 Direct Invites

- Created by a commissioner, targeting a specific user by searching their profile.
- Only **one pending direct invite** per user per league is allowed.
- The invitee sees the invite on their home page and can **accept** or **decline**.
- Configurable: assigned role (commissioner or member), expiration (1–30 days, default 7).

### 5.2 Link Invites

- Created by a commissioner, generating a unique shareable URL.
- **Anyone** with the link can use it to join (no per-user limit).
- The invite link can be **previewed without logging in** (shows league name and assigned role).
- **Joining** requires the user to be logged in.
- Configurable: assigned role, expiration (1–30 days, default 7).

### 5.3 Joining Validation

When any invite is accepted (direct or link), these checks apply:

1. The league must **not be at capacity** (current members < max size).
2. The league's season must **not be in progress**.
3. The invite must **not be expired**.

Upon joining, the new member is initialized with a standing of 0 points for the current season.

### 5.4 Auto-Cleanup on Full Capacity

When a new member joins and the league reaches its maximum size, **all remaining pending invites** for that league are automatically deleted.

### 5.5 Invite Revocation

Commissioners can manually deactivate/delete any active invite at any time.

### 5.6 Invite Management Availability

Commissioners can only create new invites when:

- The league is **not at capacity**
- The league is **not in-season**

---

## 6. NFL Weeks & Scheduling

### 6.1 Concepts

The NFL season is divided into **weeks** (e.g., "Week 1", "Wild Card", "Divisional Round"). Each week has:

- A label and sequence number defining its order in the season
- A start date and end date
- A calculated pick lock time

### 6.2 Pick Lock Time

Each week has a **pick lock time** — the deadline after which picks can no longer be submitted:

| Season Type    | Lock Time                                                       |
| -------------- | --------------------------------------------------------------- |
| Regular Season | Next **Sunday** after the week starts, at **1:00 PM Eastern**   |
| Postseason     | Next **Saturday** after the week starts, at **1:00 PM Eastern** |

### 6.3 Current Week Resolution

When a user views their league, the system determines the "current week":

- If a week is currently active (today falls between its start and end date, within the league's configured week range), that week is shown.
- If no week is currently active, the **next upcoming week** is shown.

### 6.4 Week Navigation

Users can browse to previous and future weeks using prev/next navigation. This allows viewing historical picks and results.

### 6.5 Excluded Weeks

- Pre-season and off-season weeks are excluded.
- **Pro Bowl** weeks are excluded.

---

## 7. Picks

### 7.1 Submission Rules

All of the following must be true for picks to be accepted:

1. The user **is a member** of the league.
2. Picks are for the **current week only** — users cannot submit picks for past or future weeks.
3. The week's **pick lock time has not passed**.
4. The user must submit picks for **exactly** `min(league's picks-per-week setting, number of games that haven't started yet this week)` games.
5. No **duplicate games** — each game can only be picked once per submission.
6. Every picked game must be in the current week and must **not have started yet**.
7. The selected team must be a valid participant (home or away) in the corresponding game.
8. For **Against the Spread** leagues: the current spread is **frozen into the pick** at submission time. This is the spread used for scoring, even if the line moves later.

### 7.2 Editing Picks

Users can **change their picks freely until the pick lock time**, with one exception: once a game kicks off, the pick for that specific game is **individually locked** regardless of the overall deadline.

In practice this means:

- A user submits picks on Wednesday. On Thursday, a key player is injured. They can go back and change their Sunday game picks.
- If the user picked the Thursday Night Football game, that individual pick locks when the game kicks off. It cannot be changed even though the overall deadline is Sunday.
- When re-submitting, the required pick count is recalculated based on games that haven't started yet. Picks for started games are preserved automatically.
- The spread snapshot for ATS leagues is updated to the current spread each time a pick is changed. Only the final spread at the time the pick locks (either by game kickoff or pick lock time) is used for scoring.

### 7.3 Visibility Rules

| Timing                | Visibility                                                   |
| --------------------- | ------------------------------------------------------------ |
| Before pick lock time | Each user can only see **their own** picks                   |
| After pick lock time  | **All members'** picks are visible to everyone in the league |

This prevents users from seeing others' picks and being influenced before making their own.

---

## 8. Scoring & Standings

### 8.1 Determining Pick Results

Picks are scored automatically after games finish.

#### Straight-Up Picks

| Condition                             | Result   |
| ------------------------------------- | -------- |
| Picked team scores more than opponent | **Win**  |
| Picked team scores less than opponent | **Loss** |
| Scores are tied                       | **Push** |

#### Against the Spread Picks

The spread that was frozen at pick submission time is applied to the picked team's score:

```
adjusted score = picked team's actual score + frozen spread
```

| Condition                         | Result   |
| --------------------------------- | -------- |
| Adjusted score > opponent's score | **Win**  |
| Adjusted score < opponent's score | **Loss** |
| Adjusted score = opponent's score | **Push** |

### 8.2 Points

```
Total Points = Wins + (Pushes × 0.5)
```

Losses contribute 0 points.

### 8.3 Standings

Each member's standing in a league tracks:

- **Total points**
- **Wins**, **Losses**, **Pushes** (individual counts)
- **Rank** (position in the leaderboard)

### 8.4 Ranking Method

Rankings use **dense ranking**:

- Members are sorted by points in descending order.
- Tied members share the same rank.
- The next distinct rank after a tie = previous rank + number of tied members.

Example: If two players are tied at rank 1, the next player is rank 3 (not rank 2).

### 8.5 Recalculation

Standings are recalculated periodically (via a background job):

1. Find all picks that have not yet been scored but whose games have final scores.
2. Score each pick (win/loss/push) and record the result.
3. Recalculate each member's total wins, losses, pushes, and points.
4. Perform a full integrity check by recomputing from all scored picks (safety net).
5. Recompute rankings for all members in the league.

### 8.6 Initialization

When a user joins a league, their standing starts at:

- Points: 0, Rank: 1, Wins: 0, Losses: 0, Pushes: 0

---

## 9. Odds & Spreads

### 9.1 Overview

Betting odds are synced from an external source and displayed to users when making picks in Against the Spread leagues.

### 9.2 Display

- Spreads are shown next to each team (e.g., "NYJ -3.5" / "BUF +3.5")
- The odds provider name is displayed as attribution (e.g., "Odds presented by DraftKings")

### 9.3 Spread Snapshot

When a user makes a pick in an Against the Spread league, the **current spread at the time of submission** is saved with the pick. This frozen spread is what gets used for scoring — not whatever the spread is when the game starts. This means:

- If a user picks early when the spread is -3.5, and the line later moves to -7, their pick is still scored at -3.5.
- This is a deliberate design choice: it rewards or penalizes based on when you lock in your pick.

### 9.4 Available Odds Data

For each game, the following odds data may be available:

- Home spread / Away spread
- Home moneyline / Away moneyline
- Over/Under total

Currently only spreads are used for gameplay. Moneylines and totals are stored but not actively used.

---

## 10. Live Scores & Game Results

### 10.1 Game Statuses

Games progress through three statuses:

| Status      | Meaning                                                            |
| ----------- | ------------------------------------------------------------------ |
| Not Started | Game hasn't begun. Shows scheduled start time.                     |
| In Progress | Game is live. Shows current scores, period, and game clock.        |
| Final       | Game is over. Shows final scores and pick results (win/loss/push). |

### 10.2 Outcomes

When a game reaches "Final" status, an **outcome** record is created with the confirmed final scores. This outcome is the authoritative source for scoring picks — it's what the standings calculation uses.

### 10.3 Display

- **Not started games**: Show date and time
- **Live games**: Show "LIVE" indicator with current scores, period, and clock
- **Finished games**: Show "FINAL" indicator with final scores. If the user made a pick on this game, show win/loss/push result with color coding (green/red/yellow).

---

## 11. NFL Data Sync

The application syncs NFL data from ESPN's public API (no API key required). This populates seasons, weeks, teams, game schedules, odds, and live scores.

### 11.1 What Gets Synced

| Data        | Description                                                                              |
| ----------- | ---------------------------------------------------------------------------------------- |
| Seasons     | Current and upcoming NFL seasons                                                         |
| Weeks       | All regular season and postseason weeks (excluding pre-season, off-season, and Pro Bowl) |
| Teams       | All NFL teams with names, locations, abbreviations, and logos (light + dark variants)    |
| Games       | Scheduled matchups with home/away teams and start times                                  |
| Odds        | Betting lines (spreads, moneylines, totals) for current and upcoming week games          |
| Live Scores | Real-time scores, game status, period, and clock for current and upcoming week games     |
| Outcomes    | Final confirmed scores when games end                                                    |

### 11.2 Sync Order

The sync must happen in this order (each step depends on the previous):

1. Seasons → 2. Weeks → 3. Teams → 4. Games → 5. Games + Odds → 6. Games + Live Scores → 7. Standings Calculation

### 11.3 Key Behaviors

- All sync operations are **idempotent** — running them multiple times produces the same result.
- External IDs from the data provider are mapped to internal IDs so the data source could be swapped in the future.
- Pick lock times are calculated during the weeks sync based on the rules in [Section 6.2](#62-pick-lock-time).

---

## 12. User Flows

### 12.1 Onboarding

1. User lands on login page → chooses Google or Discord
2. After OAuth, if first time → profile is auto-generated, user is sent to profile setup
3. User customizes username, name, and avatar → clicks "Complete Setup"
4. User arrives at the home page

### 12.2 Home Page

Displays two sections:

- **Open Invites**: Pending direct invites with Accept/Decline buttons. Accepting navigates to the league.
- **My Leagues**: Preview of up to 3 leagues with a "View All" link.

### 12.3 Viewing Leagues

The league list page shows all of a user's leagues as cards displaying: league name, image, pick type label, and picks-per-week count.

### 12.4 League Detail

The league page has 5 tabs:

**Standings** — Sortable leaderboard showing rank, player (avatar + name), points, wins, losses, pushes.

**My Picks** — The user's picks for the current (or selected) week. Shows:

- Their current rank, record, and points at the top
- If before lock time: interactive pick interface for making or editing picks (see below)
- If after lock time: read-only view with results
- Week navigation (previous/next) for historical browsing

**League Picks** — All members' picks for a week. Before lock time: shows a message that picks will be visible after the deadline. After lock time: collapsible cards per member showing their picks, record, and points.

**Members** — Member list with roles. Commissioners see management options (role changes, removal). Invite management section for creating and managing link/direct invites.

**Settings** — League configuration form. Some fields are always editable by commissioners; structural fields are locked during the season. Delete league option at the bottom.

### 12.5 Making Picks

1. User navigates to "My Picks" on a league
2. If it's the current week and before lock time:
   - A banner shows the pick deadline (turns red when locked)
   - A sticky submit button shows progress: "Submit Picks (3/5)"
   - Each game that hasn't started shows as an interactive card with clickable team boxes
   - For ATS leagues, the spread is shown next to each team name
   - Clicking a team selects it; clicking again deselects (toggle)
   - The user cannot select more than the required number of picks
3. User clicks "Submit Picks" → picks are saved
4. The page shows the submitted picks, but the user can come back and **edit picks for games that haven't started yet** at any time before the lock deadline
5. Picks for games that have already kicked off show as locked (read-only with results if available)

### 12.6 Joining via Invite Link

1. User visits the invite link (e.g., `app.com/join/abc123`)
2. If not logged in → shown a prompt to log in first
3. If the invite is expired → shown an "Invite Expired" message
4. If valid → shown league details (name, assigned role) + "Join League" button
5. After joining → navigated to the league page

### 12.7 Account Management

- **Profile page**: Edit username, name, and avatar at any time
- **Account page**: "Danger Zone" section with account deletion. Blocked (with explanation) if the user is a sole commissioner of any multi-member league. Requires confirmation dialog.

---

## 13. Permissions

### 13.1 Action Matrix

| Action                                                           | Who                  | Conditions                                                            |
| ---------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------- |
| Create a league                                                  | Any user             | —                                                                     |
| Delete a league                                                  | Commissioner         | —                                                                     |
| Edit league name/image                                           | Commissioner         | —                                                                     |
| Edit structural settings (season format, size, picks, pick type) | Commissioner         | Not in-season                                                         |
| View league data (standings, picks, members)                     | Any league member    | —                                                                     |
| Submit/edit picks                                                | Any league member    | Current week, before lock time; individual picks lock at game kickoff |
| View own picks                                                   | Any league member    | Always                                                                |
| View other members' picks                                        | Any league member    | Only after pick lock time                                             |
| Create invites                                                   | Commissioner         | League not at capacity AND not in-season                              |
| Revoke invites                                                   | Commissioner         | —                                                                     |
| View invite list                                                 | Commissioner         | —                                                                     |
| Accept/decline a direct invite                                   | The invite recipient | —                                                                     |
| Join via link invite                                             | Any logged-in user   | —                                                                     |
| Change a member's role                                           | Commissioner         | Cannot self-demote if sole commissioner                               |
| Remove a member                                                  | Commissioner         | Not in-season                                                         |
| Leave a league                                                   | Any member           | Not in-season; must not be sole commissioner (unless sole member)     |
| Edit own profile                                                 | The user themselves  | —                                                                     |
| Delete own account                                               | The user themselves  | Must not be sole commissioner of any league with 2+ members           |

---

## 14. Business Constants

### Leagues

| Rule                 | Value                                   |
| -------------------- | --------------------------------------- |
| League name length   | 3–50 characters                         |
| League size range    | 2–20 members                            |
| Default league size  | 10                                      |
| Season formats       | Regular Season, Postseason, Full Season |
| Seasons per NFL year | 1 per league                            |

### Picks

| Rule                   | Value                           |
| ---------------------- | ------------------------------- |
| Picks per week range   | 1–16                            |
| Default picks per week | 5                               |
| Pick types             | Straight Up, Against the Spread |

### Scoring

| Rule            | Value |
| --------------- | ----- |
| Points per win  | 1.0   |
| Points per push | 0.5   |
| Points per loss | 0.0   |

### Timing

| Rule                     | Value                    |
| ------------------------ | ------------------------ |
| Regular season pick lock | Sunday 1:00 PM Eastern   |
| Postseason pick lock     | Saturday 1:00 PM Eastern |

### Invites

| Rule                      | Value     |
| ------------------------- | --------- |
| Invite expiration range   | 1–30 days |
| Default invite expiration | 7 days    |

### Profiles

| Rule              | Value           |
| ----------------- | --------------- |
| Username length   | 3–50 characters |
| Reserved username | `"anonymous"`   |

### Roles

| Value        | Description                   |
| ------------ | ----------------------------- |
| Commissioner | Full league management access |
| Member       | Standard participant          |

---

## 15. Future Features (Planned)

| Feature            | Description                                                             |
| ------------------ | ----------------------------------------------------------------------- |
| **Public Leagues** | Leagues discoverable without invite. Currently all leagues are private. |
| **Mobile App**     | Native mobile experience.                                               |

---

_Extracted from codebase analysis — 2026-02-19_
