# Picks Leagues — Software Architecture (v0.3)

**Status:** Draft for review
**Companion doc:** *Picks Leagues MVP Product Spec v0.3* (what we're building — standalone and authoritative for product behavior)
**Scope:** MVP = NFL Pick'em (standard scoring), NFL Survivor (1 life), March Madness Pool. Post-MVP modes and deferred rule features are accounted for structurally but not built.

## Design Constraints (agreed)

- Web SPA for MVP; mobile app is a future possibility → API-first, language-agnostic contract
- Score freshness: **~5 minutes during game days**; standings recompute on the same cadence (no reason to lag them). No websockets/push — the server stays fresh via polling ESPN; clients get current data on load/refetch
- Sports data budget: free tiers only → ESPN unofficial API as sole provider, all environments
- Audience year one: friends, <50 users → optimize for simplicity and operability, not scale
- Language: TypeScript end to end
- Runtime: serverless on Vercel
- Contract: OpenAPI as the source of truth for clients

## Stack

| Layer | Choice | Rationale |
| --- | --- | --- |
| SPA | Vite + React + TanStack Router + TanStack Query + TanStack Form (ADR-0005) | Familiar stack; type-safe routing; Query handles all server state; Form takes shared Zod schemas as validators directly |
| UI | Tailwind + shadcn/ui | Shared with Paulitakes; mobile-first responsive |
| API | Hono + `@hono/zod-openapi` on Vercel Functions | Zod schemas → runtime validation + OpenAPI spec + TS types from one definition |
| API client | `openapi-typescript` + `openapi-fetch` | Generated from the spec; the SPA consumes the contract like any future client would |
| DB | Neon Postgres + Drizzle | Familiar; serverless-friendly (Neon HTTP driver); branching for dev |
| Auth | Better Auth | Cookie sessions for web now; bearer/Expo support later for mobile |
| Jobs | cron-job.org → authenticated API endpoints | Same pattern as Paulitakes; avoids Vercel Hobby cron limits (2 jobs, daily granularity) |
| Repo | pnpm workspaces monorepo | `apps/web`, `apps/api`, `packages/schemas`, `packages/db`, `packages/scoring` |

## Environments

Three environments, branch-mapped:

| Environment | Deploy | Branch | Database | Data source | Simulator |
| --- | --- | --- | --- | --- | --- |
| **Local** | Vite dev + Hono dev server | any | **Docker Postgres** | ESPN (default); simulated when running scenarios | Enabled |
| **Staging** | Vercel, pinned to `staging` branch with a fixed domain | `staging` | Dedicated Neon branch (`staging`) | ESPN (default); simulated when running scenarios | Enabled |
| **Production** | Vercel Production | `main` | Neon primary branch | ESPN only | **Disabled** — `SIM_ENABLED` is ignored here (ADR-0014); sim routes not registered |

**Data source, clarified:** ESPN is the provider in every environment — staging and local run against real ESPN data by default, which continuously exercises the real integration. "Simulated" is not an environment default but a **mode**: when a simulator scenario is loaded (local/staging/CI), the app reads game data from simulator-controlled tables instead of ESPN-synced ones for the leagues/season under test. E2E in CI always runs in simulated mode for determinism.

Mechanics:
- **Vercel:** one project. `main` → Production deployment. `staging` → a branch deployment with a fixed alias (e.g. `staging.picksleagues.app`) using Vercel's Preview environment scoped to that branch. Env vars are managed per scope (Production / Preview-`staging` / Development).
- **Neon:** staging is a long-lived Neon branch, resettable from seed data. Local dev runs Postgres in Docker (compose file in the repo); Drizzle migrations make local ↔ Neon parity a non-issue since it's plain Postgres either way.
- **Auth:** separate Google and Discord OAuth apps per environment (different redirect URIs); Better Auth config is env-var driven.
- **Jobs:** cron-job.org targets production only. Staging jobs run manually from the admin page or under simulator control — scheduled crons against staging would fight simulated time when a scenario is active.
- **Env flags:** `APP_ENV` (`local` | `staging` | `production`) names the environment; `SIM_ENABLED` toggles the simulator (ADR-0014). Availability is the single predicate `isSimEnabled` = `APP_ENV !== production && SIM_ENABLED`, so **production ignores the flag entirely** — the simulator can move the clock and truncate data, and one mis-set variable must not be able to point that at the production database. When it resolves false, simulator routes are not registered at all — not merely auth-gated. Admin surfaces are gated separately, by the `admin` role (ADR-0013), and are mounted in every environment.

## Simulator & Time Architecture

The spec's season simulator (wherever `isSimEnabled` holds — local/staging, never production; ADR-0014) drives three architectural requirements, all cheap if built in from day one:

**1. Injectable clock.** All time reads go through a `Clock` service, never `Date.now()` directly. Query-time locking, join cutoffs, and deadlines all derive from `clock.now()`.
- Simulator off (always so in production): system time, always.
- Simulator on: system time plus a persisted offset stored in an `app_state` row, settable via simulator endpoints ("advance to Week 5", "jump to 2026-10-04T13:00Z"). Because the offset lives in the DB, serverless function instances agree on the simulated time. SQL comparisons that need `now()` receive the clock value as a bound parameter rather than using the DB's `now()`.

**2. Swappable data provider.** `GameDataProvider` is the interface (season structure, schedules, scores, odds, bracket); `EspnProvider` and `SimulatedProvider` both implement it. **ESPN is the default in every environment** — `SimulatedProvider` activates only when a simulator scenario is loaded (local/staging/CI), reading from `sim_fixtures` tables that simulator endpoints populate from canned scenario files or hand-edits. Scenarios cover the spec's required edge cases: pushes, ties, cancellations, all-eliminated weeks, vacated bracket slots. ("Fixture" here means simulator test data, nothing more.)

Simulated data enters the app through the **normal sync jobs**, not a parallel read path: the jobs ingest from whichever provider is resolved into `sport_seasons`/`weeks`/`games`, so nothing downstream of ingestion knows the simulator exists (ADR-0012). Fixtures store each game's *terminal* truth (kickoff, spread, final status and scores) and the provider **projects it through `clock.now()`** — `scheduled` before kickoff, `in_progress` for a fixed game window, terminal after — so advancing the clock and re-running the jobs makes a week unfold as a real one does. Provider resolution mirrors `resolveClock` — both branch on the same `isSimEnabled` boolean, so production is structurally ESPN-only; non-prod swaps only while `app_state.sim_active_scenario_id` is set, and one active scenario owns one season year. Spreads for replayed seasons are synthesized deterministically from the provider game id, so a re-import reproduces them exactly.

**3. Step-through settlement.** Already native to the design: settlement is an idempotent endpoint over pure scoring functions, so the simulator just calls the same `settle` job per simulated week and the admin page renders resulting `pickem_pick_results` and `pickem_standings`. Recompute-from-scratch doubles as the simulator's reset for scoring state; a full environment reset truncates league/pick data and reloads fixtures.

Simulator API surface (non-prod only), as built in SIM-1…SIM-6: `GET /sim/state` (clock, active scenario, library), `POST /sim/clock` (set instant / advance / week-anchored jump / reset), `POST /sim/scenarios/{slug}/load` (activate a library or imported scenario, positioning the clock at its start), `POST /sim/scenarios/replay` (import a real past ESPN season — spreads synthesized, since historical feeds strip odds), `GET /sim/fixtures/games` + `PATCH /sim/fixtures/games/{id}` (inspect / hand-edit results), `POST /sim/reset` (league or environment scope), and `POST /sim/settle` (recompute settlement at the simulated now and return the resulting `pickem_pick_results`/`pickem_standings` for inspection — SIM-5). The single `POST /sim/fixtures` this list previously named split into the scenario and fixture routes above (ADR-0012); the capabilities are unchanged. Gated by the `admin` role in `users.app_role` (ADR-0013) on top of the env gate — the simulator is driven from its own operator section in the SPA, not by machine callers, so the shared-secret header stays a jobs-only mechanism (ADR-0011). These routes appear in the committed OpenAPI contract so the SPA reaches them through the generated client, but they are not registered where `isSimEnabled` is false, which always includes production (ADR-0012, ADR-0014). E2E mints a session and grants it the admin role (`mintSession({ appRole })`), extending ADR-0006's minted-session approach.

## Automated Testing

Three layers, weighted by where bugs actually live (per Paulitakes experience: e2e catches what unit tests miss):

**1. Unit — `packages/scoring` (exhaustive).** Table-driven tests, one case per rule and edge case in the MVP spec: Pick'em's fixed half-point push, short-week behavior, cancellation-as-push, per-pick margins, shared ranks when members tie on points, Survivor's fixed advance-on-tie (ADR-0033), all-eliminated revival, team-consumption on ties, bracket auto-advance neutrality, the bracket score-prediction tiebreaker, co-winner ties. Pure functions make these trivial to write and fast to run. The spec is the test plan; a spec rule without a test case is a review failure.

**2. Integration — API against a real Postgres.** Hono app exercised in-process (no HTTP server needed) against Docker Postgres (locally: the same compose file as dev; in CI: a Postgres service container). Covers what unit tests can't: transaction-level lock validation (409 on post-kickoff mutation), spread staleness rejection, pick visibility filtering, join cutoff and commissioner-cap enforcement, settlement idempotency (run twice, assert identical state), and override precedence (see Manual Sports Data Overrides).

**3. E2E — Playwright against the full local stack.** Runs the real SPA + API + DB with `SimulatedProvider` and the simulated clock — no network mocking anywhere. Core journeys as simulator-scripted scenarios: create league → invite → join → pick → advance clock past kickoff → assert lock and visibility → settle → assert standings; a Survivor season including a revival week; a full bracket lifecycle including a vacated-team auto-advance. Deterministic by construction because time and data are both controlled. This is the merge gate.

**The E2E stack is a parallel stack, not the dev stack.** Its own database (`picksleagues_e2e`, created and migrated by the Playwright global setup) and its own ports (SPA 5273, API 3100), configured in one place: `e2e/setup/e2e-env.ts`. Not merely tidiness — the simulator journeys reset with `scope: "environment"`, which deletes every league, game, and season in reach, so a shared database meant `pnpm test:e2e` destroyed whatever was being hand-tested. Separate ports mean a run neither evicts a running `pnpm dev` nor silently borrows it (and its database) via `reuseExistingServer`. Everything else — secrets, `APP_ENV`, `SIM_ENABLED` — still comes from the root `.env`; only the database URL, the ports, and `BETTER_AUTH_URL` are overridden, and Node's `--env-file` yields to the inherited environment, which is what lets the ordinary dev scripts serve both stacks unchanged.

**Two Playwright projects, because simulated time is environment-wide.** The clock offset and active scenario live on the `app_state` singleton, so a spec that moves time changes what every concurrently running spec sees. Time-independent specs run `fullyParallel`; simulator-driven ones (`*.sim.spec.ts`) run in a second project ordered strictly after them via `dependencies`, with parallelism off. Keep one such spec file per journey and mark it serial — the ordering guarantee is between the projects, not within one. Time-independent flows additionally get thin per-epic E2E specs ahead of the simulator, authenticated via minted Better Auth sessions (`e2e/setup/session.ts` + Playwright `addCookies` — the OAuth provider hop itself stays manual); anything time-dependent waits for the simulated clock (ADR-0006).

**CI:** GitHub Actions on every PR — typecheck, lint (including the no-raw-`Date.now()` rule), unit, integration, e2e. Green CI required to merge to `staging`; promotion `staging` → `main` re-runs the same suite. No separate manual QA phase — staging plus the simulator is the manual-exploration surface.

## Manual Sports Data Overrides

ESPN's unofficial feed will occasionally be wrong (bad final score, stuck status, missed cancellation) and there is no vendor SLA — the correction path is an app-admin override, available in **all environments including production**.

**Admin role:** app admins (initially just the owner) hold `admin` in `users.app_role`, the sole authorization source (ADR-0013). The role is granted by a direct database update (`UPDATE users SET app_role = 'admin' WHERE email = …`) — there is no env-var allowlist and no in-app promotion surface, so no configuration path can grant the capability behind the database's back. Admins get an admin page: job triggers, standings rebuild, game data editing, and read-only browsers over reference data (teams, seasons/weeks, games). The simulator control panel is a **separate top-level section** (`/sim`, sectioned into clock / scenarios / fixtures / reset) rather than a tab on that page: it carries a second gate — it exists only where `isSimEnabled` holds, and its routes are not registered otherwise (ADR-0011, ADR-0014) — so presenting it as one more admin tab implied a peer of surfaces that are always present. Overrides remain the only prod-facing edit path — provider-synced rows are never mutated directly, and teams and seasons are view-only. Operational tooling is invisible to users (they just see corrected data).

**Override semantics:**
- Overridable per game: home/away final score, game status (`scheduled | final | cancelled | postponed`), kickoff time, and current spread
- Stored as explicit parallel fields alongside provider-synced fields (`override_home_score`, `override_status`, …, plus `overridden_by` / `overridden_at`) — synced values are never mutated
- **Precedence:** reads and settlement resolve `override_* ?? provider_*`. Ingestion writes only provider fields — a re-sync can never clobber a correction, and clearing an override cleanly reverts to provider truth
- Applying or clearing an override triggers settlement recompute for affected leagues — the existing rebuild capability makes corrections retroactive and safe
- Every override is recorded in an `admin_audit` table (who, what, when, previous value)
- **A game moving between weeks is not a modelled event** (ADR-0019) — `moved` is not a status, and nothing in the product detects the move. The once-a-decade real case is corrected here like any other provider error: an admin sets the status override to `cancelled` on the moved game, whose picks then push and stand, in one audited edit on one row. Detection is operational (schedule-sync review), not automatic

## Decision Log — Alternatives Considered

### D1. Stack shape: SPA + separate API

**Alternatives:** Next.js full-stack (App Router, server actions/route handlers) · Vite SPA + separate API ✅

Next.js would consolidate hosting and give SSR for free, and route handlers *can* serve a mobile client. But server actions and RSC data flows couple data access to the React tree, working against the API-first constraint — you end up maintaining a parallel "real" API for mobile anyway. Picks Leagues is a logged-in app with no SEO surface, so SSR buys nothing. A pure SPA against an explicit API keeps one contract for all clients. (Also matches stated preference.)

**Amended by ADR-0039:** "no SEO surface" was wrong about the pages that exist to be read *before* signing in — the splash, the legal pages, and the rules guides. Serving them as an empty `<div id="root">` got the app's Google OAuth branding rejected ("your home page does not explain the purpose of your app"), since the reviewer never runs the SPA. Those routes are now prerendered to static HTML at build time (`apps/web/prerender`); the SPA-plus-API shape is unchanged, and no request-time rendering was added.

### D2. API language: TypeScript over Go

**Alternatives:** Go (Chi/Echo, single binary) · TypeScript ✅

Go was a genuine option given background and would suit the settlement jobs well. Decided against because: (a) the scoring logic benefits from sharing Zod schema types with the frontend and validation layer — in Go, every DTO change means regenerating and reconciling two type systems; (b) serverless-on-Vercel is a first-class TS experience and an awkward Go one; (c) one language across two personal projects (with Paulitakes) lowers total maintenance. Go's runtime advantages (binary size, cold start, throughput) are irrelevant at <50 users.

### D3. API framework: Hono over Fastify / Express / NestJS

**Alternatives:** Express (ubiquity) · Fastify (performance, schema-based) · NestJS (structure) · Hono ✅

Express and Fastify assume a long-running server and need adapters for Vercel Functions; Fastify's JSON-Schema validation doesn't unify with the TS type system the way Zod does. NestJS brings DI ceremony unjustified at this scale. Hono is edge/serverless-native, tiny, and `@hono/zod-openapi` collapses validation + contract + types into one definition — the deciding factor given the OpenAPI-first constraint.

### D4. Type sharing: OpenAPI contract over RPC inference

**Alternatives:** tRPC (max DX, zero codegen) · Hono RPC (inferred client types) · OpenAPI + codegen ✅

tRPC/Hono RPC give magical end-to-end inference but couple every client to the TypeScript toolchain — a future Swift/Kotlin/RN client either can't use it or needs a parallel REST layer. OpenAPI costs a codegen step but the contract outlives any one client. `@hono/zod-openapi` makes the trade nearly free since the Zod schemas exist regardless for validation.

### D5. Runtime: Vercel serverless over containers

**Alternatives:** Fly.io / Railway / Cloud Run container (in-process schedulers, simpler mental model) · Vercel Functions ✅

A long-running container would let jobs be in-process cron and avoid cold-start thinking. Chosen Vercel anyway: zero infra to patch or monitor, free tier covers this scale, deploys are git-push, and the one real serverless cost (no in-process scheduler) is cleanly solved by external cron hitting job endpoints — a pattern already proven on Paulitakes. Revisit only if settlement ever outgrows function limits.

### D6. Sports data: ESPN unofficial over paid/official providers

**Alternatives:** The Odds API (official, 500 free credits/mo, odds only) · SportsDataIO / Sportradar (comprehensive, $$$) · ESPN unofficial ✅

Paid providers are the only way to get contractual stability, and they're out per the budget constraint. The Odds API is official but covers odds only — schedules, scores, and brackets would still need another source. ESPN's unofficial endpoints cover *everything* the MVP needs (NFL schedule/scores/odds, NCAA bracket/seeds/results) for free. The instability risk is mitigated structurally (see Data section): the app never reads ESPN at request time, and a thin adapter isolates their shapes. **The Odds API as odds fallback: noted as a post-MVP activity, not implemented in MVP.**

### D7. Jobs: external cron over managed job platforms

**Alternatives:** Vercel Cron (Hobby: 2 jobs, daily only) · Inngest / Upstash QStash (retries, step functions, observability) · cron-job.org → HTTP endpoints ✅

Vercel Cron's Hobby limits (two jobs, daily granularity) can't cover a 5-minute score sync. Inngest/QStash add real value (retries, durability) but also a new platform dependency and mental model for what remains a handful of idempotent HTTP endpoints. cron-job.org is free, familiar, supports minute-level scheduling and retry-on-failure. Idempotent job design means a missed or doubled trigger is harmless — a missed 5-minute tick just means the next one does the work.

### D8. Database: Neon over Supabase / Turso

**Alternatives:** Supabase (Postgres + auth + realtime bundled) · Turso/SQLite (cheap, fast) · Neon ✅

Supabase's bundled auth would conflict with Better Auth, and its realtime features are unneeded given post-game freshness. SQLite-family options complicate the relational integrity this domain leans on (lots of FKs and unique constraints). Neon is plain Postgres with serverless-friendly HTTP driver and branch-per-PR dev flow, and it's already the stack on both existing projects.

### D9. Pick storage: per-mode tables over one polymorphic table

**Alternatives:** Single `picks` table with mode discriminator + nullable columns/JSONB · Per-mode tables ✅

A single table looks DRY but the three MVP modes have genuinely different shapes: weekly multi-pick with confidence ranks, one-team-per-week with a consumed-team ledger, and a 63-slot bracket. Polymorphic storage forfeits the DB constraints that encode the rules (unique confidence rank per member-week, unique team per member-season, exactly 63 slots per bracket) and breeds nullable-column swamp. Per-mode tables keep constraints honest.

**Amended by ADR-0016:** results and standings are per-mode too. This decision originally drew the line at picks — "shared behavior lives in `games`, `pick_results`, and `standings`" — but those two tables turned out to be Pick'em-shaped: the spec's Survivor board carries no points and no rank, and March Madness ranks one row *per bracket*, which the standings unique constraint forbids. Keeping them shared would have relocated the same nullable-column swamp one table downstream. What is genuinely shared is `games`, the league/membership tables, and the *pure ranking core* in `packages/scoring` — not table columns. New modes add pick, result, and standings tables; mode-specific surfaces are named for their mode (`pickem_*`, `/leagues/{id}/pickem/…`).

### D10. Settlement: polled incremental + nightly reconciliation over alternatives

**Alternatives:** Event-driven push infrastructure (webhooks/websockets, incremental-only state) · Nightly batch only (simplest, but stale on game days) · 5-minute polling with incremental settlement + nightly full-recompute sweep ✅

The 5-minute freshness target rules out nightly-only, but doesn't justify push infrastructure: polling ESPN every 5 minutes and settling games as they go final delivers the requirement with plain cron + idempotent jobs. The critical property is preserved from the batch design: each mode's result and standings tables remain *pure derivations* of (picks, results, settings) — the incremental path is an optimization, and the nightly sweep (plus on-demand rebuild) recomputes from scratch, catching stat corrections, admin overrides, and any missed sync. Purely event-driven systems make that historical recomputation much harder; this design gets live-ish updates *and* keeps the recompute escape hatch.

### D11. Locking: query-time derivation over scheduled state flips

**Alternatives:** Cron flipping `locked` flags at kickoff · Derived at query/write time ✅

(Decided in the product spec; recorded here for completeness.) A `locked` column maintained by jobs can drift from reality on job failure and requires per-game scheduling precision. Deriving lock status from `kickoff_at <= now()` on reads and validating it transactionally on writes is always correct and needs zero infrastructure. With the simulator, `now()` means `clock.now()` (see D13).

### D12. Environments: branch-mapped Vercel + Neon over alternatives

**Alternatives:** Two Vercel projects (hard staging/prod isolation) · Vercel preview deployments only (no fixed staging) · Single env + feature flags · One project with branch-scoped Preview env ✅

Two projects give harder isolation but double the config surface for a solo project. Ephemeral preview deployments can't host a *persistent* staging environment with simulated time and a stable database. Single-env feature-flagging is how test data leaks into prod. One Vercel project with `main`→Production and a fixed-alias `staging` branch deployment, paired with Neon branch-per-environment, gives persistent staging with near-zero extra config. Cron targets prod only; staging time is simulator-controlled.

### D13. Simulated time: persisted clock offset over alternatives

**Alternatives:** Rewriting fixture timestamps around real time · Env-var time offset (requires redeploy; per-instance drift) · Test-process time mocking (can't span a deployed environment) · DB-persisted offset behind a `Clock` service ✅

Rewriting fixture timestamps corrupts the data under test and can't express "advance one week" cleanly. Env-var offsets need a redeploy per time change. Process-level fake timers work in unit tests but not across a deployed staging environment's many serverless invocations. A DB-persisted offset read through an injected `Clock` is consistent across all instances, adjustable at runtime, and structurally unavailable in prod (the offset code path isn't registered). Cost: discipline — no raw `Date.now()` and no SQL `now()` in domain logic; enforced by a lint rule.

### D14. E2E strategy: simulator-backed over mock-backed

**Alternatives:** Mock the API layer in browser tests (fast, brittle) · E2E against staging with real ESPN data (nondeterministic, season-dependent) · E2E against the local stack with SimulatedProvider + simulated clock ✅

API-mocked browser tests don't exercise the contract, the DB constraints, or settlement — the layers where this app's bugs will actually live. Testing against live sports data is nondeterministic and only meaningful in-season. The simulator exists anyway per the spec's testing requirement; pointing Playwright at it yields fully deterministic whole-system tests with zero mocks. Playwright over Cypress for parallelism, multi-browser coverage, and CI ergonomics.

### D15. Override storage: parallel fields over alternatives

**Alternatives:** Directly edit synced values (next sync wipes it, or sync needs per-field skip flags) · Separate `game_overrides` table joined at read (normalized, but precedence is easy to forget in one query path — a silent wrong-data bug) · Parallel `override_*` columns with coalesce-at-read ✅

Direct edits create a fight between admin and ingestion. A separate table is relationally cleaner but every read path must remember the join and the failure mode is silent. Parallel columns keep provider truth and human truth side by side in one row, reduce precedence to a single coalesce in the serializer and settlement input loader, and make "clear override" a null-out. Cost: a wider table. Correct by construction.

## Monorepo Layout

```
picks-leagues/
├── apps/
│   ├── web/                # Vite SPA (includes static rules-guide content)
│   │   └── prerender/      # Build-time static render of the public routes (ADR-0039)
│   └── api/                # Hono app, deployed as Vercel Functions (routes, jobs, sim)
├── packages/
│   ├── schemas/            # Zod schemas: API DTOs + league settings per game mode
│   ├── db/                 # Drizzle schema, migrations, query helpers
│   ├── scoring/            # Pure scoring/settlement functions per game mode
│   ├── html-shell/         # Rewrites of the built index.html, shared by the
│   │                       #   invite unfurl (ADR-0038) and the prerender (ADR-0039)
│   └── core/               # Clock service, GameDataProvider interface,
│                           #   EspnProvider, SimulatedProvider, env config
└── openapi/                # Generated spec (committed) + generated web client
```

`packages/scoring` is deliberately isolated: pure functions, zero I/O, heavily unit-tested. The scoring rules (confidence compression, push resolution, bracket auto-advance and its score-prediction tiebreaker) are the most intricate logic in the app and the most valuable thing to test exhaustively. The product spec doc essentially *is* the test plan.

## External Data: ESPN Unofficial API

ESPN's undocumented endpoints cover everything the MVP needs, free:

- **NFL:** season/week structure, schedules with kickoff timestamps, live + final scores, and odds (spread from ESPN BET) via the scoreboard and odds endpoints; team records/streaks/points via the bulk standings endpoint (season-parameterized, so last season's finals stay served — the week-1 fallback), and per-game injuries, FPI projections, last-five form, and ATS via the event summary endpoint (ADR-0040). Injuries are **live-only** — a historical game's summary answers with the teams' *current* report — so simulator replay mocks them.
- **NCAA MBB:** tournament bracket, seeds, regions, game results

**Risk & mitigation:** unofficial means it can change without notice. Mitigations: (1) all external data is ingested into our own tables — the app never reads ESPN at request time, so an outage degrades ingestion, not the product; (2) a thin `providers/espn.ts` adapter isolates their API shapes behind our own domain types, so swapping providers touches one module; (3) ingestion failures alert via the cron scheduler — jobs return 500 and cron-job.org emails on failed requests (ADR-0007). The Odds API remains the identified odds fallback, implemented post-MVP only if needed.

**Spread strategy:** a game carries its **current spread on its own row**, resolved as `override_spread ?? spread` like every other overridable game field (D15) — only the latest spread is kept, so the odds sync is an **idempotent update** of unstarted games rather than an append (ADR-0018). Spreads are a **Pick'em** concern only — Survivor is straight up, stores no spread, and runs no acceptance handshake (ADR-0026). A Pick'em pick stores the concrete spread it was made against (denormalized onto the pick row as `spread_at_pick`), which is the audit that matters: what this member accepted. The ATS handshake survives the move to one-submission-per-week, because the line still moves between page load and submit — the client displays the game's current spread, and the write endpoint validates the spread values a submission states against it, rejecting a stale submission with 409 so the client re-prompts.

## Background Jobs

All jobs are HTTP endpoints under `/api/jobs/*`, protected by a shared-secret header, triggered by cron-job.org, and **idempotent** (safe to re-run, safe to trigger manually from an admin page).

| Job | Schedule | Work |
| --- | --- | --- |
| `nfl-sync-schedule` | Daily 6am ET | Upsert NFL weeks (regular + postseason, Pro Bowl excluded — ADR-0007), games, kickoff times; pick up postponements and cancellations (pick impact derives from game state at settlement) |
| `nfl-sync-odds` | 3×/day (in season) | Idempotently update the current spread on unstarted games |
| `nfl-sync-scores` | **Every 5 min** | Fetch live/final scores; when any game reaches final, resolve its picks via `packages/scoring` and rebuild standings for affected leagues — scores and standings move together |
| `nfl-sync-stats` | Daily (in season) | Idempotently upsert team season records (bulk standings, one request) and per-game matchup context (injuries, FPI, ATS, last five — one summary request per unstarted game in the pick window) for the matchup stats sheet (ADR-0040) |
| `settle-sweep` | Daily 3am ET | Full reconciliation pass: recompute all active leagues from stored results; catches anything the incremental path missed (late stat corrections, overrides, missed syncs) |
| `ncaamb-sync-bracket` | Every 5 min (March, tournament days) | Ingest tournament results; process auto-advance on vacated slots |

Sport-specific jobs carry the sport in their route (`/api/jobs/nfl/*`) and service names
(ADR-0007); operational setup lives in `docs/runbooks/jobs.md`.

`sync-scores` runs every 5 minutes around the clock and **no-ops in milliseconds** when no games are in progress or recently final — cheaper and more robust than encoding NFL/NCAA game windows into cron schedules. cron-job.org supports minute-level scheduling on its free tier. Standings therefore update within ~5 minutes of a game going final; in-progress scores are also stored and can be surfaced in the UI with a "live as of" timestamp.

Settlement is **recompute-friendly** (see D10). Vercel function limits are a non-issue at <50 users; if settlement ever approaches a timeout, the endpoint processes per-league with a cursor and cron retries until drained.

## Domain Model (core tables)

```
users                       # Better Auth + username (citext unique), display_name, app_role (ADR-0013)
leagues                     # identity only: mode discriminator, visibility, name, max_members (ADR-0009)
league_seasons              # per-season instance: league FK + season FK (unique pair), settings JSONB
                            #   (per-mode Zod schema), status; a league's newest instance is current
league_members              # role (commissioner/member), joined_at; ≥1 commissioner per league (ADR-0004)
league_invites              # invite code, created_by, revoked_at?, use_count (informational — ADR-0032)

sport_seasons               # NFL 2026, NCAAMB 2027, ...; upcoming season exists (possibly
                            #   provisional, never with fabricated games) before its data (ADR-0009)
teams                       # normalized reference data: sport, provider id, name, abbr (ADR-0010)
weeks                       # week type (regular/postseason) + number, label, start/end, season FK
games                       # provider id, week FK, home/away team FKs, kickoff_at, status,
                            #   final scores, live period + clock_seconds (DATA-8),
                            #   current spread (latest only, ADR-0018),
                            #   override_* parallels for all of it, overridden_by/at
team_season_stats           # per (team, season_year): W-L-T + home/road splits, signed streak,
                            #   points for/against — provider facts only; PPG/ranks derived at
                            #   read, no override_* (display-only — ADR-0040)
game_stat_context           # per game: JSONB payload (injuries, FPI, ATS, last five) validated
                            #   by schema, additive evolution; updated_at is the as-of stamp
                            #   (ADR-0040)

pickem_picks                # league_member FK, game FK, side, spread_at_pick
survivor_picks              # league_member FK, week FK, game FK, team (straight up, no
                            #   spread — ADR-0026),
                            #   released (settlement-only; true when the game resolves cancelled).
                            #   Team consumption is a partial unique index
                            #   (league_season, member, team) WHERE NOT released (ADR-0025)
survivor_state              # league_season FK + member FK (unique pair), lives_remaining
                            #   (default 1), eliminated_week FK?, revived_count, updated_at;
                            #   settlement-maintained, no row = alive with one life (ADR-0025)
brackets                    # league_member FK, label, champ_score_prediction
bracket_picks               # bracket FK, slot id (1–63), picked team

pickem_pick_results         # pickem_pick FK, outcome, points
survivor_pick_results       # survivor_pick FK, league_season FK, member FK, week FK, outcome,
                            #   settled_at; no points column — survive/eliminate does not score
                            #   (ADR-0016, ADR-0025)
pickem_standings            # materialized: league_season FK, member FK, week?, points, rank
                            #   (picks/results/standings key off league_seasons, ADR-0009)
                            #   Per-mode, not shared (ADR-0016): Survivor's board is
                            #   alive/eliminated off survivor_state, and March Madness
                            #   ranks one row per bracket. Each mode adds its own pair.

app_state                   # singleton row: simulated clock offset + active scenario (non-prod), flags
sim_scenarios               # non-prod: one loadable scenario (library case or imported past season)
sim_fixture_weeks           # scenario FK: the week structure SimulatedProvider serves
sim_fixture_games           # scenario FK: kickoff, spread, terminal status/scores (projected via Clock)
sim_fixture_teams           # scenario FK: the team cast the fixtures reference
admin_audit                 # override/rebuild actions: admin, action, target, prior value, at
```

Spec-driven notes:
- **Username:** unique case-insensitive (Postgres `citext` or lower-index), 3–20 chars `a-z0-9_`, validated in the schemas package so the same rule serves API and UI.
- **Commissioner cap:** "max 10 active leagues as commissioner" is enforced at league-create and commissioner-promote endpoints with a counted query inside the transaction — no denormalized counter needed at this scale. Commissionership lives only in `league_members.role` — leagues may have several commissioners and must keep ≥1; demote/kick/leave/deletion guard the invariant (ADR-0004).
- **Deferred-feature columns:** `survivor_state.lives_remaining` exists with default 1 even though MVP fixes lives at 1, and `pickem_picks` omits confidence/money-pick columns entirely (added by migration when those features ship). Rule of thumb: keep a column only when it's free (a default), not speculatively.
- **Rules guide:** static content in the SPA (MD/MDX per mode), no backend surface.

**League settings as validated JSONB:** each mode has a Zod schema in `packages/schemas`; the API validates on write and Drizzle types the column via `$type<>`. Adding post-MVP modes means a new schema + scoring module + pick table — no migrations to shared tables.

## Invites

**Decided:** invite links with codes; no email infrastructure.

- Commissioner generates a link containing an opaque code (`/join/:code`); codes live in `league_invites` as bare revocable codes — no expiry, no use cap (ADR-0032)
- Visiting the link while logged out routes through auth then back to the join flow
- Public leagues are discoverable and joinable without a code; private leagues require one
- Join cutoff (first week started / Round of 64 tipped) derived from game timestamps — same query-time pattern as pick locking. Enforced at the join endpoint, and at invite *creation* (ADR-0029), so a commissioner can't mint a link the cutoff would refuse every use of; revoking stays available past the cutoff

## MVP Rule Scope (finalized — mirrors spec v0.3)

All rule-scope decisions are settled in the MVP spec; recorded here only for their architectural consequences. Deferred features are enforced by **omission from the MVP settings schemas and scoring functions** — no table shapes fork when they ship later.

| Feature | Status | Architectural note |
| --- | --- | --- |
| Confidence scoring + Money Pick | Deferred | `pickem_picks` ships without those columns; added by migration later |
| Cancellation re-picks (Pick'em) | **Removed** (ADR-0018) | No substitute endpoint; a cancelled game's pick pushes and the push stands |
| Pick'em pick editing | **Removed** (ADR-0018) | One insert-only submission per week — no update path, no retention rules, no re-pricing |
| Pick'em tiebreaker | **Removed** (ADR-0018) | No `differential` columns anywhere; the ranking core sorts on points and shares ranks |
| Week moves | **Not modelled** (ADR-0019) | `moved` leaves the game-status set; a real move is an admin `cancelled` override |
| Buy-back, lives > 1, extension weeks | Deferred | `lives_remaining` default-1 column is the only trace |
| MM upset / perfect-round bonuses | Deferred | Absent from `MarchMadnessSettings` schema |
| MM custom scoring model | **Removed** (ADR-0034) | Standard doubling only; `MarchMadnessSettings` is `{ maxBracketsPerMember }` and the doubling table lives as constants in the future `scoreBracket` |
| MM seed-correction wipe flow | **Removed** (ADR-0034) | A pre-deadline seed correction is an admin-by-hand procedure, not a flow |
| Push/tie resolution config | **Removed** (ADR-0033) | Pick'em's push is the constant 0.5 inside its scoring function (ADR-0018); Survivor's tie is fixed at advance-with-team-consumed, so neither mode carries a push/tie knob and the Survivor scoring functions take no settings |
| Survivor Pick Type / ATS | **Removed** (ADR-0026) | No `pickType` in `SurvivorSettings`, no `spread_at_pick` on `survivor_picks`, no spread on its write path or in its refusal set |
| Custom Pick'em week ranges | **Removed** (ADR-0020, then ADR-0031) | The create/update input carries no range at all — the server resolves the regular-season range; the resolved `startWeek`/`endWeek` refs are still stored and still what everything downstream computes on, so a later "Custom" option writes them directly rather than forking the stored shape |

## Locking Model

- All "now" reads use the injected `Clock` service (D13) — system time in prod, offsettable in local/staging
- Read side: `locked = game.kickoff_at <= clock.now()` computed in queries/serializers (clock value passed as a bound parameter, never SQL `now()`)
- Write side: every pick mutation validates `kickoff_at > clock.now()` inside the transaction; violations return 409
- Pick visibility: pick rows are only serialized to non-owners once the associated game has kicked off — enforced in the query layer, never client-side
- Join cutoffs (first week started / Round of 64 tipped) and the commissioner-power windows (pre-start vs post-start) derive from the same clock + game timestamps
- Survivor auto-elimination for missed picks and pick'em zero-scoring for unpicked slots resolve naturally at settlement time — no deadline jobs

## Settlement & Scoring

`packages/scoring` exposes one pure module per mode:

```ts
settlePickemWeek(picks, results, settings) → PickOutcome[]
settleSurvivorWeek(aliveMemberIds, picks, results) → SurvivorWeekSettlement
scoreBracket(bracket, tournamentResults) → BracketScore
```

Each handles its mode's edge-case matrix from the product spec: Pick'em's fixed half-point push, Survivor's fixed advance-on-tie (ADR-0033), confidence compression on short weeks, cancellation-as-push, revival when everyone busts in the same week, bracket auto-advance neutrality. Table-driven unit tests, one per spec rule.

The settlement job dispatches on the league's mode into that mode's own orchestration module, each writing only its own tables (ADR-0016) in one transaction per league season: load inputs — resolving `override_* ?? provider_*` — → call the pure functions → persist.

Pick'em grades each pick against its own game, so a week settles in isolation: persist `pickem_pick_results` → rebuild `pickem_standings` for the affected weeks. Survivor cannot, because missed-pick elimination and the everyone-out revival are week totals over the alive-set the previous week produced. It therefore replays a league season's weeks **in prefix order**, settling a week only once every game in it is terminal and every in-range prior week has settled, and writes `survivor_pick_results`, `survivor_state`, and the `survivor_picks.released` team ledger (ADR-0025). A correction to an already-settled week replays every week after it on the same trigger rather than waiting for the nightly sweep.

Nothing is stored for tiebreaking: Pick'em leaderboards are a sort on points alone, and members who tie share the rank.

## API Surface (MVP sketch)

```
POST   /leagues                          create (mode + settings; enforces commissioner cap)
GET    /leagues                          my leagues (dashboard)
GET    /leagues/:id                      league + settings + members (members only)
PATCH  /leagues/:id                      name anytime; visibility + settings pre-start
DELETE /leagues/:id                      pre-start only
PATCH  /leagues/:id/members/:memberId    promote/demote commissioner (ADR-0004)
DELETE /leagues/:id/members/:memberId    kick (pre-start only; commissioner)
DELETE /leagues/:id/members/me           leave league (pre-start only, ADR-0004)
POST   /leagues/:id/invites              generate invite code (commissioner)
GET    /leagues/:id/invites              list invites + derived status (commissioner)
DELETE /leagues/:id/invites/:code        revoke
GET    /join/:code                       join preview (league card + exact refusal reason)
POST   /join/:code                       join via invite link
POST   /leagues/:id/join                 join a public league directly (discovery path)
GET    /discovery                        public pre-cutoff leagues, ?q= name search
GET    /leagues/:id/weeks                the league's weeks, clipped to its start/end week (PKM-5)
GET    /weeks/:id/games                  slate + current spreads
GET    /leagues/:id/pickem/standings     ?week= for weekly view
GET    /leagues/:id/pickem/pick-summary  pick/member counts a settings change would discard
PUT    /leagues/:id/pickem/weeks/:weekId/picks   the week's one submission (validates spreads, ADR-0018)
GET    /leagues/:id/pickem/weeks/:weekId/picks   own always; others' filtered by kickoff
PUT    /leagues/:id/survivor/weeks/:weekId/pick
GET    /leagues/:id/survivor/weeks/:weekId/picks own always; others' filtered by kickoff
POST   /leagues/:id/bracket/entries      submit bracket (all 63 + tiebreaker)
GET/PATCH /me                            username claim/change, display name
DELETE /me                               account deletion: anonymize in place (guarded by ADR-0004 once leagues exist)
POST   /jobs/*                           secret-protected job triggers (prod cron)
POST   /admin/jobs/nfl/:job              manual sync trigger from the admin page (ADR-0011)
GET    /admin/teams                      ?sport= — read-only reference-data browsers
GET    /admin/seasons                    ?sport= — seasons + weeks + per-week game counts
GET    /admin/games                      ?weekId= — provider, override, and resolved values
PUT    /admin/games/:id/override         set/clear overrides (admin role; audited)
POST   /admin/leagues/:id/rebuild        wipe + recompute results/standings
POST   /sim/*                            simulator (non-prod only, admin role; see Simulator section)
GET    /openapi.json                     generated spec
```

## Reconciliation Status

Architecture v0.3 is reconciled against MVP Spec v0.3. Every spec requirement maps to a design element: environments and simulator (Environments, Simulator & Time, D12–D13), automated testing (Automated Testing, D14), operational data corrections (Manual Sports Data Overrides, D15), rule scope (MVP Rule Scope table), identity and caps (Domain Model notes), rules guide (static SPA content), and freshness expectations (Background Jobs). No open questions remain in either document.

**Both documents stay locked at v0.3 and are amended by recorded ADRs rather than re-versioned.** The Pick'em rule surface described here and in the spec is the v0.3 text as amended by **ADR-0018** (a week's picks are one atomic, immutable submission; push fixed at +0.5 with no tiebreaker; only the latest spread is kept), **ADR-0019** (week moves out of scope, with an admin `cancelled` override as the operational remedy), **ADR-0020** (Pick'em's Start Week / End Week settings collapse into one three-option season range, resolved against the bound season and the injected Clock at league creation and stored as the concrete `startWeek`/`endWeek` refs everything already computes on), **ADR-0023** (Game Mode 2 is named **Survivor**; every "Elimination" in this document's original v0.3 text and in the ADRs numbered below 0023 names this same mode), **ADR-0024** (Survivor has no range setting at all — the server resolves and stores a regular-season range under ADR-0020's mid-week rule), **ADR-0025** (Survivor persistence: team consumption is a partial unique index over a settlement-maintained `released` flag so a cancellation returns the team, `survivor_state` is a settlement-maintained ledger carrying `eliminated_week_id` and `revived_count`, and Survivor settles per completed week in prefix order), **ADR-0026** (Survivor is straight-up only — its Pick Type setting, `survivor_picks.spread_at_pick`, and its spread-acceptance handshake are all removed, since a changeable pick graded at the spread it was made against rewards re-picking; Pick'em is untouched), **ADR-0031** (Pick'em is regular-season only — ADR-0020's presets are retired, the Season Range setting is removed, and the server resolves and stores the regular-season range under the same mid-week rule ADR-0024 applies for Survivor; postseason ingestion is unchanged), **ADR-0032** (invite links are bare opaque codes — the optional expiry and max-use caps, their columns, and their derived statuses are removed; revocation is an invite's only lifecycle), **ADR-0033** (Survivor's Push/Tie Resolution is fixed at its default — a tie advances with the team consumed — leaving Survivor with no league settings at all; the scoring package takes no settings), and **ADR-0034** (March Madness scoring is Standard Doubling only — `MarchMadnessSettings` is `{ maxBracketsPerMember }` — and the pre-deadline seed-correction wipe is an admin-by-hand procedure, both cut before the mode was built). Where any of these ADRs and the v0.3 text disagree, the ADR is the decision and the text is the defect.

## Mobile Path (later, zero rework)

Generate a client for Expo/React Native (or native) directly from the OpenAPI spec. Better Auth adds bearer-token/Expo support on the same auth tables. Nothing about settlement, locking, or the data model changes.

## Deliberate MVP Exclusions

No websockets or push notifications (post-game freshness), no email (invite links), no matchmaking queue (H2H is post-MVP), no admin CMS (a role-gated admin page with job triggers, rebuild buttons, and data browsers, plus — in non-prod only — a separate simulator section), no caching layer, no odds-provider fallback (post-MVP if ESPN's feed proves flaky).
