# PicksLeagues Backlog

> Stories ordered by dependency. Work top-to-bottom within each section. A story should only be started when its dependencies (stories above it in the same or prior section) are complete.
>
> Status: `[ ]` pending | `[~]` in progress | `[x]` complete | `[!]` blocked
>
> **Schema + data layer are owned by each feature story.** There is no up-front "all tables" or "all data functions" story — every feature story adds the schema, migration, and `data/` functions it needs as part of its vertical slice. Bootstrap infra (`lib/db/index.ts` client, `data/utils.ts` `withTransaction`) is introduced by the first story that needs a database (PL-004).

## Status Summary

| Status      | Count  |
| ----------- | ------ |
| Complete    | 29     |
| In Progress | 0      |
| Blocked     | 0      |
| Pending     | 8      |
| **Total**   | **37** |

---

## Dependency Graph

```
Foundation ──┬── ESPN Integration ── Simulator ──┬── Admin Overrides ──┐
             │                                    │                     │
             └── Leagues ─────────────────────────┴── Picks & Scoring ──┴── Polish ── Deployment
```

Admin Overrides is a parallel track off Simulator — it reuses the admin gate and entity tables but doesn't block Leagues or Picks & Scoring.

---

## 1. Foundation (no dependencies)

- [x] PL-001: Install core dependencies
  - drizzle-orm, @neondatabase/serverless, drizzle-kit
  - better-auth (Google + Discord plugins)
  - zod, react-hook-form, @hookform/resolvers
  - shadcn/ui init + core components
  - vitest, prettier, eslint-config-prettier
  - date-fns, date-fns-tz, sonner, lucide-react, next-themes
  - Configure: prettier, vitest, drizzle.config.ts, .env.example

- [x] PL-004: Auth setup (BUSINESS_SPEC §2, §12.1)
  - lib/db/index.ts (dual driver — pg locally, @neondatabase/serverless on Vercel) + data/utils.ts (withTransaction, Transaction)
  - lib/db/schema/auth.ts — user, session, account, verification (BetterAuth-managed)
  - lib/db/schema/profiles.ts — profile table; data/profiles.ts — insertProfile (minimal; full CRUD in PL-006)
  - lib/errors.ts (AppError hierarchy), lib/types.ts (ActionResult)
  - lib/username.ts — generateUsername(email) + tests
  - lib/auth.ts — BetterAuth server config (Google + Discord providers, Drizzle adapter), databaseHooks auto-create profile, getSession() that throws UnauthorizedError
  - lib/auth-client.ts — BetterAuth client
  - app/api/auth/[...all]/route.ts — catch-all route handler
  - Auth guard lives in (app)/layout.tsx via getSession() — layout/route group creation happens in PL-005

- [x] PL-060: Vercel deployment (free tier)
  - Build configuration, environment variables
  - Node.js runtime (not Edge — needed for Better Auth + Drizzle pg driver)

- [x] PL-061: Neon database provisioning
  - Create database, configure connection string
  - Run initial migrations

- [x] PL-005: App layout + theming (BUSINESS_SPEC §12.2-12.4, ui rules)
  - shadcn/ui setup + theme configuration
  - globals.css with sports-fan aesthetic, dark mode default
  - Root layout with providers (auth, theme)
  - (app) layout with mobile-first navigation shell
  - (public) layout for unauthenticated pages
  - Login page with Google + Discord OAuth buttons

- [x] PL-006: Profile setup + edit (BUSINESS_SPEC §2.1-2.2, §12.1, §12.7)
  - Profile setup page (shown after first login, ?setup=true)
  - Profile edit page
  - Username uniqueness validation, 3-50 chars, "anonymous" reserved
  - lib/validators/profiles.ts shared schema

- [x] PL-007: Account settings + deletion (BUSINESS_SPEC §2.3, §12.7)
  - Account page with danger zone
  - Soft anonymization flow (blocked if sole commissioner of multi-member league)
  - Confirmation dialog

- [x] PL-008: Privacy policy + terms of service
  - app/(public)/privacy/page.tsx — minimal privacy policy content
  - app/(public)/terms/page.tsx — minimal terms of service content
  - Footer links from (public) and (app) layouts
  - Static content authored in-page (no CMS)

- [x] PL-009: Branding assets (logo, favicon, app icons)
  - Logo (SVG) — light + dark variants
  - app/icon.tsx or app/favicon.ico — favicon
  - app/apple-icon.tsx — iOS home-screen icon
  - app/opengraph-image.tsx — OG share card
  - Update app/layout.tsx metadata (title, description, icons)

- [x] PL-053: Splash / landing page (public, unauthenticated)
  - app/(public)/page.tsx — app description, key features, call-to-action
  - Mobile-first responsive design
  - Links to login, privacy, and terms

## 2. ESPN Integration (depends on: Foundation complete)

- [x] PL-010: ESPN client library (BACKGROUND_JOBS §6)
  - lib/espn/shared/client.ts — base fetch, URL builders, pagination
  - lib/espn/shared/types.ts — shared ESPN response types
  - lib/espn/nfl/seasons.ts — fetch NFL seasons
  - lib/espn/nfl/phases.ts — fetch weeks (mapped to phases)
  - lib/espn/nfl/teams.ts — fetch NFL teams
  - lib/espn/nfl/events.ts — fetch events (games) for a phase
  - lib/espn/nfl/scores.ts — fetch live scores
  - lib/espn/nfl/odds.ts — fetch odds data

- [x] PL-011: Sync pipeline — initial setup (BACKGROUND_JOBS §3)
  - lib/sync/nfl/setup.ts — one-time idempotent setup
  - Seeds: data source (ESPN), sportsbook (ESPN Bet)
  - Syncs: seasons, phases (with lock time calculation), teams, events, odds
  - Phase date override (Tuesday 2AM ET boundaries)
  - Pro Bowl filtering

- [x] PL-012: Sync pipeline — live scores (BACKGROUND_JOBS §4.3)
  - lib/sync/nfl/live-scores.ts
  - Game window detection (30 min before first kickoff to 4 hrs after last)
  - NFL season month gating (Sep-Feb)
  - Updates event status/scores, marks events final
  - Logs finalized event count (standings recalculation in PL-015)

- [x] PL-013: Sync pipeline — odds (BACKGROUND_JOBS §4.2)
  - lib/sync/nfl/odds-sync.ts
  - Syncs odds for current phase unstarted events
  - NFL season month gating

- [x] PL-014: Cron route handlers + API key auth (BACKGROUND_JOBS §2)
  - lib/cron-auth.ts — Bearer token verification
  - lib/sync/nfl/weekly-sync.ts — runWeeklySync (phases + teams + events; no odds)
  - app/api/cron/nfl/setup/route.ts
  - app/api/cron/nfl/weekly-sync/route.ts
  - app/api/cron/nfl/odds-sync/route.ts
  - app/api/cron/nfl/live-scores/route.ts

## 3. Simulator (depends on: ESPN Integration complete)

> Simulator must be ready before Picks & Scoring — it's the only way to test during off-season.

- [x] PL-040: Simulator service (testing.md initial-doc)
  - lib/simulator.ts — initializeSeason(year), advancePhase(), getStatus(), resetSeason()
  - Uses same sync functions as production cron jobs
  - Fetches historical ESPN data and replays phase by phase

- [x] PL-041: Admin simulator UI
  - app/(app)/admin/simulator/page.tsx
  - Controls: Initialize Season (year input), Advance Phase, Reset
  - Status display: current phase, events completed, standings state
  - Protected by admin check

## 4. Admin Overrides (depends on: Simulator complete)

> Manual escape hatch when ESPN data is wrong or a sync regresses — admins can edit entities by hand and lock them against future auto-overrides. Parallel to Leagues / Picks & Scoring; doesn't block either.

- [x] PL-070: Override lock infrastructure
  - Add `locked_at` nullable timestamp column to teams, phases, events, odds
  - data/ layer: setLocked*/clearLocked* helpers for each entity
  - Sync pipelines (runStructuralSync, runLiveScoresSync, runOddsSync) skip upserts/updates on locked rows
  - Tests: sync respects locks; manual edits auto-set locked_at

- [x] PL-071: Admin override index + lock toggle
  - app/(app)/admin/overrides/page.tsx with tabs for teams / phases / events / odds
  - Table view per entity with search + filter (season, phase, team)
  - Locked badge + lock/unlock toggle per row
  - Read-only detail view; edit forms arrive in PL-072–PL-074

- [x] PL-072: Edit teams + phases
  - actions/admin-overrides.ts: updateTeamAction, updatePhaseAction
  - lib/validators/admin-overrides.ts: team/phase edit schemas
  - Edit forms (RHF + zod) for name / location / abbreviation / logo URLs (teams) and label / start / end / pick lock time (phases)
  - Save auto-sets locked_at on the edited row

- [x] PL-073: Edit events + scores
  - Edit form for home team / away team / start time / status / scores
  - Admin can manually mark an event final with custom scores (correction path for ESPN errors)
  - Auto-lock on save

- [x] PL-074: Edit odds
  - Edit form for spreads / moneylines / over-under per sportsbook
  - Auto-lock on save

## 5. Leagues (depends on: Foundation complete)

- [x] PL-020: League creation (BUSINESS_SPEC §3.1, §12.4)
  - lib/validators/leagues.ts — CreateLeagueSchema
  - actions/leagues.ts — createLeague action
  - League create page with form (name, season format, size, picks per phase, pick type)
  - Creator becomes commissioner, initialized with 0-point standing

- [x] PL-021: League settings + in-season edit restrictions (BUSINESS_SPEC §3.2-3.3)
  - actions/leagues.ts — updateLeague action
  - lib/nfl/scheduling.ts — isLeagueInSeason()
  - League settings page (name/image always editable, structural fields locked in-season)
  - League size cannot go below current member count

- [x] PL-022: League deletion (BUSINESS_SPEC §3.6)
  - actions/leagues.ts — deleteLeague action
  - Commissioner-only, cascade deletes all data
  - Confirmation dialog

- [x] PL-023: Direct invites (BUSINESS_SPEC §5.1)
  - lib/validators/invites.ts — CreateDirectInviteSchema
  - actions/invites.ts — createDirectInvite, respondToInvite
  - User search by username/name
  - One pending invite per user per league
  - Home page invite display with accept/decline

- [x] PL-024: Link invites (BUSINESS_SPEC §5.2, §12.6)
  - actions/invites.ts — createLinkInvite
  - Shareable URL with token
  - app/(public)/join/[token]/page.tsx — preview without auth, join with auth
  - Auto-cleanup of invites when league reaches capacity

- [x] PL-025: League members (BUSINESS_SPEC §4, §12.4)
  - Members tab UI (member list with roles)
  - actions/members.ts — promoteMember, demoteMember, removeMember
  - Commissioner-only management, removal only when not in-season

- [x] PL-026: Leave league (BUSINESS_SPEC §4.4)
  - actions/members.ts — leaveLeague
  - Sole commissioner check (must not be sole commissioner unless sole member)
  - Sole member deletes league entirely
  - Only when not in-season

## 6. Picks & Scoring (depends on: Leagues + Simulator ready for testing)

- [ ] PL-027: Phase picks view (BUSINESS_SPEC §6, §10, §12.4-12.5)
  - Phase/event data display: teams, odds, scores, lock status
  - Phase navigation (prev/next)
  - Current phase resolution logic (lib/nfl/scheduling.ts)
  - Live score display (not started / in progress / final indicators)

- [ ] PL-028: Pick submission — straight up (BUSINESS_SPEC §7.1-7.2)
  - lib/validators/picks.ts — SubmitPicksSchema
  - lib/nfl/scheduling.ts — isGameStarted(), isPhasePastLockTime()
  - actions/picks.ts — submitPicks action
  - Interactive pick UI: clickable team cards, toggle selection, progress counter
  - Pick lock enforcement: phase lock time + individual game kickoff
  - Required pick count: min(picksPerPhase, unstartedGames)

- [ ] PL-029: Pick submission — against the spread (BUSINESS_SPEC §7.1, §9.3)
  - Extends PL-028 with spread display and spread snapshot at submission
  - Spread frozen into pick at submission time (spreadAtLock field)

- [ ] PL-030: Pick results calculation (BUSINESS_SPEC §8.1-8.2)
  - lib/nfl/scoring.ts — calculatePickResult(), calculateStandingsPoints()
  - Straight up: compare scores
  - ATS: apply frozen spread, compare adjusted scores
  - Points: win=1, push=0.5, loss=0
  - `calculatePickResult` is deterministic from the event's current score — no caching assumptions beyond the stored `pickResult` field, which is invalidated on admin event edits (see PL-015)
  - Tests for all scoring edge cases

- [ ] PL-031: Standings + leaderboard UI (BUSINESS_SPEC §8.3-8.4, §12.4)
  - Standings tab: sortable table with rank, player, points, W/L/P
  - Dense ranking
  - Season history (prior season standings preserved)

- [ ] PL-015: Standings recalculation service (BUSINESS_SPEC §8.5, BACKGROUND_JOBS §5)
  - Re-slotted from Section 2 — depends on picks (PL-028), pick scoring (PL-030), standings schema (PL-031).
  - lib/sync/nfl/standings.ts
  - Score unscored picks, recalculate totals, recompute dense rankings
  - Full integrity check (recompute from all scored picks)
  - Wire call from runLiveScoresSync when events finalize
  - **Admin event edits clear `pickResult` on affected picks** — `updateEventAction` (PL-073, shipped) must null out `pickResult` for every pick on the event whenever scores or status change on a `final` event (or status flips away from `final`). The next recalc run then re-scores them via step 2 of §8.5.

- [ ] PL-032: Phase navigation (BUSINESS_SPEC §6.3-6.4)
  - Prev/next phase browsing
  - Historical picks and results view
  - Current phase auto-detection

- [ ] PL-033: League picks view (BUSINESS_SPEC §7.3, §12.4)
  - Before lock: "picks will be visible after deadline" message
  - After lock: collapsible cards per member with picks, record, points

## 7. Polish (depends on: Core features complete)

- [ ] PL-050: Sentry integration
  - @sentry/nextjs setup with source maps
  - Error capture for unexpected errors (not AppError subclasses)

- [ ] PL-051: Error boundaries + toast notifications
  - error.tsx at route segment levels
  - Consistent toast feedback on all mutations via sonner

- [ ] PL-052: Mobile UX audit + refinements
  - Test all flows at mobile viewport
  - Touch-friendly interactions, bottom sheet nav
  - Performance optimization (minimize client JS)

- [ ] PL-054: Standings scenarios (what-if calculations)
  - "What if team X wins?" scenario modeling
  - Carry forward pattern from BracketsBall

- [ ] PL-055: Pick stats + trends
  - Advanced stats to help users make informed picks
  - Historical pick performance data

## 8. Deployment (depends on: Polish complete)

> PL-060 and PL-061 were pulled up into Foundation so we can deploy and test in production continuously.

- [ ] PL-062: cron-job.org configuration
  - Configure all sync endpoints with schedules
  - Set Bearer token auth headers

- [ ] PL-063: Domain + DNS setup
  - Custom domain, SSL, cross-subdomain cookies
