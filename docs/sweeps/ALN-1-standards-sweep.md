# ALN-1 — Standards sweep

**Date:** 2026-08-23 · **Base:** `staging` @ `187e752` · **Scope:** every rule in `.claude/rules/engineering.md` and every primitive/role in `docs/design-system.md`, against `apps/`, `packages/`, `e2e/`, `openapi/` (generated files excluded).

This is a findings list, not a fix. Each rule section states what's inconsistent at `file:line` with the offending code quoted, or says **no findings** explicitly, and closes with the greps that produced it so coverage is auditable. Nothing in the codebase changed for this report; the one behaviour-affecting finding is routed to its owning epic (below) rather than fixed here.

**Method.** Five parallel read-only surveys, one per rule group (architecture; time/data/contract/security; code craft; tests; UI + design system). Each finding was confirmed by opening the file, not by grep alone. A 14-line sample of citations was re-verified independently before this was assembled, and the two largest counts (doc-comment form, `.optional()` sites) were recounted with a separate script.

## Headline

The load-bearing rules are clean. **Time & locking: zero violations** across all five sub-rules (derived lock state, in-transaction re-validation, query-layer visibility, single clock for cutoffs, `useAppNow()` in the SPA). Scoring purity, provider-shape containment, per-mode tables, `ERROR_CODE` slugs, `isUniqueViolation`, the security rules, and the contract CI gate all have no findings. The spec-is-the-test-plan rule holds for both shipped modes, and all six named integration-test areas are covered.

What the sweep actually found is **two generations of code living side by side**. The services written before Pick'em (leagues, members, invites, users, league-weeks) name refusal reasons as inline string-literal unions and their routes switch on raw strings; everything from Pick'em on uses const sets. The test setup layer has two helper modules that each export `withCookie`/`adminCaller`, and 13 test files re-type the app trio instead of calling either. And `survivor-board.tsx` is the one member surface the VIS pass didn't fully re-classify. Those three clusters account for most of the volume; the rest is a scattering of S-sized items.

Six rules are questioned below — places where the violation count says the *rule* is the thing out of step. Those need the owner's call before ALN-2 starts, because each one decides whether a cluster is ~60 mechanical edits or a one-line rule amendment.

## Rule questions for the owner

Each of these is a choice between "sweep the code to the rule" and "amend the rule to the code". **Decided (owner, 2026-08-23): every recommendation accepted.** Q1 is a code migration carried by ALN-2 PR A; the rule amendments for Q2–Q6 landed in `.claude/rules/engineering.md` in the ALN-1 PR itself, so ALN-2 starts against the amended rules.

1. **Refusal reasons as inline literal unions** (§Architecture "a service names its refusal reasons in a const set"; §Quality "non-test code never compares raw literals of a set"). ~60 sites across 9 pre-Pick'em services and 3 route files (`leagues.ts`, `members.ts`, `invites.ts` — 34 `case "…"` arms). Every reason is already a member of `ERROR_CODE`, so the rule's own 1:1 clause makes the migration mechanical: return `ERROR_CODE.LEAGUE_NOT_FOUND`, switch on `case ERROR_CODE.LEAGUE_NOT_FOUND:`. **Recommend: migrate** — the two halves of `services/` currently teach opposite patterns to the next diff, which is the exact failure the "match surrounding code" rule names. M.

2. **Doc-comment form on non-exports** (§Quality "exported symbols get `/** */`; non-exported get `//`"). 11 export-side violations vs **~230 non-export-side** — `/** */` above a non-exported function is the repo's actual convention in every package. The failure the rule names (a caller obligation invisible at the call site) only exists in the export direction, which is nearly clean. **Recommend: amend** — drop the non-export clause to "non-exported declarations may use either; a caller obligation on an export must be `/** */`", and fix the 11. S either way, versus L to sweep 230 comments for no behavioural payoff.

3. **`.optional()` in the inline-wrapper rule** (§Contract "never wrap a registered schema in `.nullable()` (or `.optional()`) inline"). 15+ `.optional()` sites on registered schemas, and the generated `openapi.json` shows none of their components widened — `.optional()` lands on the parent's `required` list, not on the `$ref` target, so it does not have the failure `.nullable()` has. **Recommend: amend** — the clause is `.nullable()` only. The one real `.nullable()` hit (`invites.ts:91`) is a genuine latent bug and is fixed in ALN-2 regardless. S.

4. **ESPN on a request path: the sim replay import** (§Architecture "request paths never call ESPN"). `POST /sim/scenarios/replay` runs a synchronous full-season ESPN crawl inside the request (`routes/sim.ts:297` → `services/sim/replay.ts:96-107`), deliberately (ADR-0012, SIM-6), admin-only, sim-only, wrapped in the job envelope. **Recommend: amend** — carve out "job-shaped sim endpoints run through `runJob`", since the rule's failure (an ESPN outage degrading the product) can't reach members from a route that isn't registered in production. Moving it to `/jobs/*` would be M for no member-facing gain.

5. **Page skeleton for shell-less routes** (§Quality "one page skeleton"). Five routes outside the authed shell (sign-in, claim-username, join, welcome, static pages) each mint their own `<main>` with their own width/padding; the rule only describes the authed column. **Recommend: amend** — name a second skeleton for the pre-shell routes (one centred-card `<main>`, `p-4 sm:p-6`) so they at least agree with each other; today `p-6` vs `p-4 sm:p-6` makes phone padding differ between sign-in and everything after it. S.

6. **Theme-token exception beyond OAuth** (§Quality "theme tokens only … sole exception: brand-mandated colors"). `team-identity-override-form.tsx:56,72` uses `bg-white`/`bg-zinc-950` with a stated reason (each swatch *represents* a theme, so it must not follow the current one). **Recommend: amend** — widen the exception to "a surface that depicts a theme other than the current one", cited in a comment. Trivial.

Not a rule question but the same shape: the **test setup split** (`test/setup/league-app.ts` vs `setup/sim-helpers.ts` each exporting `withCookie` and `adminCaller`) is the root of the 13-file duplication in §Tests — merge the two modules first, then the sweep is mechanical.

## Routed out of this epic

Findings that change what the app does go to the owning epic, per the ALN header:

- **`SIM-11`** (appended to `backlog/04-simulator-admin.md`) — `updateFixtureGame` read → check → update race, no transaction or row lock. Sim-only. The only **[BEHAVIOUR]** finding in the sweep.

Two findings are latent rather than live and stay in ALN-2 as conformance fixes: `packages/schemas/src/invites.ts:91` (inline `.nullable()` will widen `JoinBlockedReason` for the first second `$ref`), and `apps/web/src/routes/_authed/profile.tsx:105` (the `/me` invalidation lives in the route instead of `useUpdateMe`, so the hook's other caller depends on repeating it).

## Proposed ALN-2 split

One PR per area, pure conformance, evaluator on A and E (they touch refusals, settlement tests, and lock tests).

| PR | Area | What's in it | Size |
|---|---|---|---|
| **A** | API boundaries & refusals | Q1 migration (or not); `lib/league-refusals.ts` for the commissioner-gate triple mapped from 3 route files; `jobs.ts` inline error descriptors → `errorResponse()`; the 4× job deps guard → a `lib/require-deps` helper; `me.ts` serializer + `getSimState` call → service; `invite-preview.ts` raw param bounded; `leagues/start.ts:45` parse via `LEAGUE_SETTINGS_SCHEMAS`; `invites.ts:91` nullable variant | M |
| **B** | Web structure | split `lib/game.ts` (generic / admin / Pick'em / Survivor); `"home" \| "away"` → `PICKEM_PICK_SIDE` (13 sites); `profile.tsx` invalidation into `useUpdateMe` | M |
| **C** | UI conformance | `survivor-board.tsx` boxes → row tier, 4 labels → `type-eyebrow`; 4 "updated …" stamps → eyebrow; 3 pending-label swaps; `admin-gate` + sim cards → `QueryState`; `join` blocked-notice and settings `h2`s; Q5 skeleton; segmented-control orange call | M |
| **D** | Comments & craft | 11 export-side `//` → `/** */`; 3 non-durable IDs (`feedback item 10`, `round 5/6`); 2 `interface`-vs-`type` in one file; Q2 outcome | S |
| **E** | Tests | merge `league-app`/`sim-helpers`; 13 files onto the harness; `signInAs` ×4 → `e2e/setup`; 11 `it.each` groups; ~5 e2e branch trims; `data-*` attrs for the 3 copy-bound selectors; 3 presentation-policy tests; add the concurrent pick-mutation race test | M |
| **F** | Deps | TypeScript 6 → 7 (only actionable major; `@types/node` deliberately tracks the engine) | M, separate so a type-error fallout doesn't block A–E |

The rule amendments from Q2–Q6 are already in `engineering.md` (ALN-1 PR); each ALN-2 PR sweeps its area against the amended text.

---

# Findings by rule group

## 1. Architecture & boundaries

### API-first (no hand-rolled `fetch`)
- No findings. `apps/web/src/lib/api.ts` is the only `openapi-fetch` client; every network call in `apps/web/src` goes through it or `authClient`.

_(coverage: `grep -rnE '\bfetch\(' apps/web/src`, `grep -rnE 'XMLHttpRequest|axios|ky\(' apps/web/src`, `grep -rn 'from "@picksleagues/openapi"' apps/web/src`)_

### SPA data bindings live in `apps/web/src/api/<domain>.ts`
- `apps/web/src/routes/_authed/profile.tsx:105` — invalidation fan-out written in a route, not the mutation hook: `await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });` inside `useUpdateMe({ onSuccess })`. The key is imported (not a literal), but `useUpdateMe` in `apps/web/src/api/me.ts:32` never invalidates `["me"]` itself, so the hook's other caller (`claim-username.tsx`) gets a stale `/me` cache unless it repeats the same line. The rule puts fan-out in the hook.

_(coverage: `grep -rnE '\bapi\.(GET|POST|PATCH|PUT|DELETE)'`, `grep -rnE "from ['\"].*lib/api['\"]"`, `grep -rnE 'queryKey:|useQuery\(|useMutation\(|invalidateQueries|queryOptions\('`, `grep -rnE 'useQueryClient|queryClient\.'` — all over `apps/web/src` excluding `api/`; `grep -c invalidateQueries apps/web/src/api/*.ts`; authClient usage sites listed and confirmed auth-only)_

### One definition per DTO
- No findings. Every `interface`/`type` outside `packages/schemas` is a structural input shape (`GameOverrideFields`, `SeasonWeekRow`, `MatchupSideTeam`, `SurvivorGradablePick`), a service result union, or a route-local param schema — none restates a wire DTO. `z.infer` outside schemas is confined to the ESPN adapter, `env.ts`, and one route `searchSchema`.

_(coverage: `grep -rnE '^(export )?(interface|type) [A-Z]\w*(Response|Request|Dto|DTO|Body|Payload)\b'`, `grep -rnE 'z\.infer<|z\.input<'`, `grep -rnE 'z\.object\('` over apps + core/db/scoring, `grep -rnE '^export (interface|type) \w+ (=\s*\{|\{)'` over apps; candidates opened and read)_

### Route handlers are thin boundaries
- `apps/api/src/routes/me.ts:26-49` — `function serializeMe(user, capabilities, now): MeResponse` is a serializer living in the route module; every other serializer lives under `services/` (`services/leagues/serialize.ts`). Its `readCapabilities` (`me.ts:152-155`) also issues a query (`getSimState(db)`) straight from the handler closure.
- `apps/api/src/routes/invite-preview.ts:31` — `function inviteOgMeta(preview: InviteLinkPreview): InviteOgMeta` — presentation mapping in the route; minor, but same pattern.

No db/drizzle access in any other route file.

_(coverage: `grep -nE 'db\.(select|insert|update|delete|query|transaction|execute)|from "drizzle-orm"|@picksleagues/db' apps/api/src/routes/*.ts`, `grep -nE '^(async )?function |^const \w+ = (async )?\(' apps/api/src/routes/*.ts`, full read of `me.ts`)_

### Route plumbing is shared, never copy-pasted
- `apps/api/src/routes/jobs.ts:19-26` — inline error descriptors instead of `errorResponse(...)` from `lib/route-responses.ts`: `400: { description: "…", content: { "application/json": { schema: ErrorResponseSchema } } }` and the same for `401`.
- `apps/api/src/routes/admin.ts:293`, `admin.ts:300`, `routes/jobs.ts:127`, `routes/sim.ts:271` — four hand-rolled copies of the job-shaped deps guard: `if (!db || !resolveClock) return c.json(misconfiguredJob(SETTLE_SWEEP_JOB_NAME), 500);` (sim.ts adds `|| !espnProvider`). `lib/nfl-sync-jobs.ts:70` already has `resolveNflJobDeps` for the provider-needing variant; the provider-less variant is copy-pasted per route.

_(coverage: `grep -n -B1 -A3 'content: { "application/json": { schema: ErrorResponseSchema' apps/api/src/routes/*.ts`, `grep -n '^export' lib/route-responses.ts lib/require-deps.ts`, `grep -nE 'requireDbAndClock|requireSession|requireAdmin|resolveNflJobDeps|if \(!db|!deps\.' routes/*.ts`, `grep -rn 'onError('`)_

### Inline error slugs vs `ERROR_CODE`
- No findings. Every `error:` in a response is `ERROR_CODE.*`, `result.reason` (typed off the `ERROR_CODE`/`JOIN_BLOCKED_REASON` unions), or a refusal-module lookup.

_(coverage: `grep -rnE 'error: "' apps/api/src` (non-test) → zero hits; `grep -rnE 'ERROR_CODE\.|\.status === [0-9]|error\.error' apps/web/src/{components,routes,lib}`)_

### A service names its refusal reasons in a const set; never an HTTP status
- `apps/api/src/services/leagues/authz.ts:53` — `reason: "league_not_found" | "not_commissioner"` inline literal union, no const set.
- `apps/api/src/services/leagues/crud.ts:51,171-175,347` — `reason: "mode_unavailable" | "no_active_season" | "cap_exceeded" | "start_week_passed"` etc., 17 literal `reason: "…"` return sites, no const set.
- `apps/api/src/services/members.ts:41,49,54,134,188` — `readonly reason: "cap_exceeded" | "last_commissioner"`, `ActorGateFailure = { ok: false; reason: "league_not_found" | "not_commissioner" }` … 15 literal return sites.
- `apps/api/src/services/invites.ts:47,50,93,120` — `type CommissionerGateFailure = { ok: false; reason: "league_not_found" | "not_commissioner" }`; 6 literal return sites.
- `apps/api/src/services/users.ts:44,180` — `reason: "username_taken"`, `reason: "last_commissioner"`.
- `apps/api/src/services/league-weeks.ts:34` — `reason: "league_not_found" | "wrong_league_mode"`.
- `apps/api/src/services/leagues/renew.ts:17`, `leagues/join.ts:123`, `leagues/settings-reset.ts:35` — same pattern.

Corollary in the routes that map them (`routes/leagues.ts`, `routes/invites.ts`, `routes/members.ts` — 34 `case "…"` literals): e.g. `routes/leagues.ts:244 case "league_not_found":` then `error: ERROR_CODE.LEAGUE_NOT_FOUND` — the reason and the code are the same string restated twice.

No service names an HTTP status (the 400/404/409 hits are all comments). Thrown `MemberMutationError` / `JoinRefusedError` / `CapExceededError` / `InviteInvalidError` are transaction-rollback signals caught inside the same service and converted to typed results before the boundary (`members.ts:122-125`, `join.ts:121-128`, `invites.ts:310-316`, `crud.ts:160-163`) — not a violation, but a second idiom next to the newer services' plain returns.

**Rule question:** the literal-union style is the older half of the codebase (leagues, members, invites, users, league-weeks: ~9 files, ~55 return sites), while everything from Pick'em on (`pickem/*`, `survivor/*`, `admin-overrides`, `nfl/*`, `sim/*`) uses `ERROR_CODE.*`/`PICKEM_REFUSAL`/`SURVIVOR_REFUSAL`. Either the older services get migrated (the 1:1-with-`ERROR_CODE` clause makes this mechanical — return `ERROR_CODE.LEAGUE_NOT_FOUND` instead of `"league_not_found"`) or the rule should say the literal union is tolerated where it is a subset of `ERROR_CODE`.

_(coverage: `grep -rnE 'reason: "[a-z_]+"'` and `grep -rnE 'reason: (ERROR_CODE|PICKEM_REFUSAL|SURVIVOR_REFUSAL|[A-Z_]+\.)'` tallied per file over `services`+`lib`; `grep -rnE '\b(400|401|403|404|409|422|500)\b|HTTPException|statusCode'` over services/lib; `grep -rnE '\bthrow\b'` over services/lib with each refusal-class throw traced to its catch)_

### Refusal mapping with TS-enforced coverage / shared `lib/*-refusals.ts` when mapped from several route files
- `apps/api/src/routes/leagues.ts:243-300, 313-336, 381-404`, `routes/invites.ts:148-176, 215-230`, `routes/members.ts:99-130, 147-160, 196-210` — the same `league_not_found → 404` / `not_commissioner → 403` / `league_started → 409` triple is hand-mapped in three route files via per-site `switch`. Coverage *is* enforced (a missed case falls through to `result.league`/`result.invite`, which fails narrowing), but the rule says a set mapped from more than one route file gets a `lib/*-refusals.ts` module like `pickem-refusals.ts`/`survivor-refusals.ts`. (The per-action message copy differs on purpose, so a status-only lookup is the shape.)
- Single-reason sites (`admin-nfl-stats.ts:163-167, 185-195`, `admin.ts:390-395`) return the one reason unconditionally — fine, nothing to be exhaustive over. `admin.ts:361` and `leagues.ts:200` (`messages[result.reason]` keyed by the union) are correct.

_(coverage: `grep -nE 'switch \(|\.reason|satisfies Record|never' apps/api/src/routes/*.ts`, every hit opened; `grep -rn CommissionerGateFailure`)_

### Services own their queries — no repository layer
- No findings. `packages/db/src/queries/app-state.ts` is a targeted shared read (`getSimState`) used by runtime, sim services, and two routes — an extraction, not a layer. No `repo*`/`dao*` directories.

_(coverage: `find apps packages -type d \( -iname '*repo*' -o -iname '*dao*' -o -iname queries \)`, file read, `grep -rln getSimState`)_

### `packages/scoring` stays pure
- No findings. Only dependency is `@picksleagues/schemas` (package.json); no `fetch`, `Date.now`, `new Date`, `console`, `process`, or `fs`.

_(coverage: `grep -rnE '^import' packages/scoring/src`, `sed -n '/dependencies/,/}/p' packages/scoring/package.json`, `grep -rnE 'fetch\(|Date\.now|new Date\(|console\.|process\.|fs\b' packages/scoring/src`)_

### Provider shapes never leak
- No findings. `espn-provider.ts` exports only `EspnProvider`, `ESPN_POSTSEASON_NUMBER_BY_DOMAIN`, and two `parse*` functions returning domain types; every `z.infer<typeof *Schema>` of an ESPN shape is file-local. All other "espn" hits in apps are comments, `deps.espnProvider: GameDataProvider`, or sim scenario logo URLs.

_(coverage: `grep -rni espn apps packages` minus the adapter, non-comment lines filtered; `grep -n '^export' packages/core/src/espn-provider*.ts`)_

### Request paths never call ESPN
- `apps/api/src/routes/sim.ts:297-300` → `services/sim/replay.ts:96-107` — `POST /sim/scenarios/replay` calls `espn.fetchNflSeasonStructure`, `fetchSeasonGames(espn, …)`, `espn.fetchNflTeams()` synchronously inside the request (`sim-replay-card.tsx:32` even labels it "A synchronous full-season ESPN crawl"). Admin-only, sim-only, and run through `runJob` as a job envelope, but it is an HTTP request path that blocks on ESPN.

**Rule question:** this is a deliberate SIM-6 design (`ADR-0012` is cited in the comment at `sim.ts:297`). Either the rule should carve out "job-shaped admin/sim endpoints invoked via `runJob`" explicitly, or the import should be a `/jobs/*` endpoint.

_(coverage: `grep -rn --include='*.ts' espn apps/api/src` non-comment lines; `grep -rn 'fetchNfl\|fetchSeasonGames' apps/api/src/services apps/api/src/routes`)_

### Per-mode tables, not polymorphic
- No findings. `pickem_picks`/`pickem_pick_results`/`pickem_standings`, `survivor_picks`/`survivor_pick_results`/`survivor_state`; shared tables carry no per-mode nullable FK and the only `check()` is `leagues_max_members_range`. `survivor_state` (not `_standings`) is covered by ADR-0027/0028/0030.

_(coverage: `grep -rnE 'pgTable\('` and `grep -rnE '\bcheck\('` over `packages/db/src/schema`)_

### Mode-specific surfaces are named for their mode
- `apps/web/src/lib/game.ts:337` — `export function spreadLabel(spread: number | null, side: PickemPickSide)` — Pick'em-typed helper in a generic `game.ts`; `game.ts:224 pickStandingLabel`, `:358 PickRowState`, `:375 pickRowState` are likewise Pick'em-shaped (only `pickem-game-row.tsx`/`pickem-picks.tsx` consume them) under generic names.

Everything else checks out: route paths are `/pickem/…` / `/survivor/…`; OpenAPI components are `Pickem*`/`Survivor*`; generic web modules (`pick-outcome.tsx`, `pick-sheet-action-bar.tsx`, `pick-sheet-guide-links.tsx`, `slate-preview.tsx`, `api/weeks.ts`, `lib/standings.ts`) are verified as imported by both mode trees.

_(coverage: route `path:` list, OpenAPI component-name list from `openapi/openapi.json`, `grep -n '^export' packages/schemas/src/{slate,league-weeks,pick-type,pick-outcome}.ts`, per-file `grep -rln "league/<name>\""` for each generic-named component, `grep -niE 'pickem|survivor'` in `services/slate.ts`, `services/settlement.ts`, `api/leagues.ts`)_

### A file that accretes unrelated responsibilities gets split
- `apps/web/src/lib/game.ts` (491 lines, 25 exports) — five concerns in one module: generic status/score/clock formatting (`:30-68`), admin override resolution `adminGameEffective` (`:81`), matchup/state labels (`:138-198`), Pick'em-only margin/spread/row-state helpers (`:224-400`), and a Survivor grading block `survivorProvisionalOutcome`/`SurvivorGradablePick`/`survivorPickGrade`/`survivorRevivalStillPossible` (`:402-491`). Consumers are disjoint (admin browser vs Pick'em rows vs Survivor board), so every mode change routes through it.
- `apps/api/src/services/league-weeks.ts` (423 lines) — borderline: `listLeagueWeeks` (a read service), `resolveCurrentWeekId`/`resolveWeekWindowPosition` (pure derivations), `loadSeasonWeeks` (shared query), `isWeekInsidePickWindow` (pick-window rule), `resolveLeagueWeekFrames` (serializer input). Flagging as borderline only; a natural split is the pure derivations vs the queries.

_(coverage: `wc -l` over all api/web source sorted; `grep -n '^export'` on the largest: `lib/game.ts`, `api/leagues.ts`, `services/league-weeks.ts`, `services/admin-data.ts`)_

### Sizing

| Rule | Findings | Effort |
|---|---|---|
| API-first / no hand-rolled fetch | 0 | — |
| SPA data bindings in `api/<domain>.ts` | 1 (profile.tsx invalidation) | S |
| One definition per DTO | 0 | — |
| Thin route handlers | 2 (me.ts serializer+query; invite-preview mapping) | S |
| Shared route plumbing | 2 groups (jobs.ts descriptors; 4× job deps guard) | S |
| Inline error slugs | 0 | — |
| Refusal const sets (services) | ~9 files / ~55 sites | M (mechanical swap to `ERROR_CODE.*`, or amend the rule) |
| Refusal mapping shared module | 1 (commissioner-gate triple across 3 route files) | M (new `lib/league-refusals.ts` + 8 switch sites) |
| No repository layer | 0 | — |
| Scoring purity | 0 | — |
| Provider shapes | 0 | — |
| No ESPN on request paths | 1 (sim replay import) | S if rule is amended; M if moved to `/jobs/*` |
| Per-mode tables | 0 | — |
| Mode-specific naming | 1 cluster (Pick'em helpers in `lib/game.ts`) | S (folds into the split below) |
| File accretion | 1 clear (`lib/game.ts`), 1 borderline (`league-weeks.ts`) | M for game.ts split; L if league-weeks too |

## 2. Time & locking · Data & database · Contract · Security

### Time & locking — injected Clock, no wall-clock reads
- `apps/web/src/components/ui/calendar.tsx:17` — `const year = new Date().getFullYear();` — browser-clock read in the SPA (outside the lint rule's scope). Commented as decorative navigation bounds only (year dropdown range), never feeds domain time. Exemption, not a violation.
- `apps/web/src/lib/app-clock.ts:39,61` — `Date.parse(serverNowIso) - Date.now()` / `Date.now() + offsetMs` — the sanctioned SPA clock store itself; the only place the browser clock is legitimately referenced.
- `packages/core/src/clock.ts:14-15` — `// eslint-disable-next-line no-restricted-syntax` / `return new Date();` — `SystemClock`, the one sanctioned exemption the lint config names.
- Other `eslint-disable` comments found are unrelated to time: `apps/api/src/lib/default-hook.ts:14` (`no-explicit-any`), `apps/api/test/setup/fake-provider.ts:25-47` (`no-unused-vars`, "signature kept for overrides").
- Lint coverage gap to be aware of: `eslint.config.js` applies `timeDisciplineSelectors` to `apps/api/src`, `apps/api/scripts`, `packages/*/src` only — `apps/web` and `e2e` are review-only, as the rule text already states. No violations found there.

_(coverage: `Date.now()|new Date()|\bnow()|CURRENT_TIMESTAMP|defaultNow|eslint-disable` across apps/api, apps/web, packages, e2e; `.default(sql`/`now()` across packages/db/src + migrations; read eslint.config.js selectors)_

### Time & locking — SPA labels read `useAppNow()`
- no findings. Every relative-to-now helper (`formatKickoff`, `leagueHasStarted`, `leagueTimingLine`, `gameStateLead`, `gameStateLabel`, `standingFigures`) takes `now: Date`, and every call site traced reads it from `useAppNow()` (`league-header.tsx:23`, `pickem-game-row.tsx:150,231`, `survivor-game-row.tsx:148,303`, `survivor-board.tsx:326,434`, `slate-preview.tsx:21`, `games-browser.tsx:135`, `join.$code.tsx:58`, `_authed/index.tsx:123`, `sim-clock-banner.tsx:64`). `Date.parse` at `game-override-patch.ts:117` and `fixture-patch.ts:85` parse a typed input value, not "now".

_(coverage: `formatKickoff(|Date.parse|getTime()|RelativeTimeFormat|ago|until|remaining|countdown|\bnow\b` across apps/web/src; read `lib/app-clock.ts`, `lib/format.ts`, `lib/league.ts`)_

### Time & locking — lock state derived, re-validated in transaction
- no findings. No `locked` column in any schema (`packages/db/src/schema/pickem.ts:22`, `survivor.ts:26` state the rule). Both pick mutations re-read the slate inside `db.transaction` after a member-row lock and refuse on `game.locked` (`apps/api/src/services/pickem/picks.ts:457-500`, `survivor/picks.ts:392-454`, including the existing survivor pick's own game at 453-454). Reads compute `locked: isLocked(effective.kickoffAt, now)` in `slate.ts:113`.

_(coverage: `locked|visib|reveal` in packages/db/src/schema; read both pick services' transaction bodies; `for("update")|lockLeague*Row` across apps/api/src)_

### Time & locking — pick visibility in the query layer
- no findings. Non-owner picks are filtered server-side before serialization on `lockedByGame` (`pickem/picks.ts:336`, `survivor/picks.ts:296`, `survivor/standings.ts:197-249`); the SPA only renders `hiddenPickCount`. No visibility flag column exists.

_(coverage: `visib|reveal|hidden|locked` in pickem/survivor services; `hiddenPick|filter(.*locked` in apps/web)_

### Time & locking — join cutoff / commissioner windows from one clock
- no findings. All cutoffs go through `leagueStartAt` + `isPreStart(startsAt, clock)` (`leagues/start.ts:78`), called from join (`join.ts:72-79`, inside the tx, after `lockLeagueRow`), invites, discovery, and crud. The SPA mirror reads `useAppNow()`.

_(coverage: `leagueStartAt(|isPreStart(` across apps/api/src)_

### Data & database — constraints encode the rules
- no findings. `league_members_league_user_unique` (`packages/db/src/schema/leagues.ts:118`), partial `survivor_picks_member_team_unique` (`survivor.ts:90`, partial on `released = false` by design), citext `username.unique()` (`auth.ts:38`), plus `pickem_picks_member_game_week_unique`, `leagues_max_members_range` check. The 63-slot bracket constraint has no table yet (March Madness unbuilt) — not a finding.

_(coverage: `unique|citext|check(` in packages/db/src/schema)_

### Data & database — transactions for multi-step writes; none across network calls
- `apps/api/src/services/sim/fixtures.ts:161-206` — `updateFixtureGame` does a read (`db.select()...`) → coherence check on the merged row → `db.update(...)` with no transaction or row lock; two concurrent patches (one nulling a score, one setting `final`) can both pass the "final needs both scores" check and land the state the comment says ingestion guarantees cannot occur. Sim-only admin surface, so low blast radius. **[BEHAVIOUR]** (race, sim-only)
- Everything else clean: join/cap check takes `lockLeagueRow` before insert-then-count (`join.ts:55,82-98`); settle + standings + conclusion share one tx (`pickem/settlement.ts:417-450`, `survivor/settlement.ts:433`); overrides + `admin_audit` in one tx. Every provider fetch sits outside the tx (`sync-odds.ts:150-156`, `sync-stats.ts:281`, `sync-schedule.ts:56-65,116-144`, `sync-scores.ts:120→133`, `sim/replay.ts:96-107`). `createInvite` (`invites.ts:62-65`) is deliberately un-transactional with a stated reason.

_(coverage: `.transaction(` across apps/api/src + packages/db; `await (db|tx).(insert|update|delete)` per service; `provider\.\w+\(|fetch` vs `.transaction` in nfl/* and sim/*)_

### Data & database — settlement is a pure derivation; jobs idempotent
- no findings. Survivor's `released` flag is rewritten in both directions on every replay (`survivor/settlement.ts:576-601`); `league_seasons.status` likewise (`leagues/conclusion.ts:55-61`, skip-when-unchanged). Sync jobs compare-before-write (`sync-odds.ts:185`, `sync-stats.ts:185-190,302-304`), settlement delete-then-insert under `lockLeagueSeasonRow`, sweep is per-season with failures counted.

_(coverage: read `services/settlement.ts`, both mode settlements, `conclusion.ts`, `settings-reset.ts`, the four nfl sync services)_

### Data & database — override precedence `override_* ?? provider_*`
- `apps/api/src/services/sim/clock.ts:96,99` — `least(${games.kickoffAt}, coalesce(${games.overrideKickoffAt}, ${games.kickoffAt}))` — a third hand-written coalesce on kickoff outside `effectiveKickoffAtSql`. Deliberate and commented (anchors take the outer bound of provider and override), so the *semantics* differ from plain precedence; worth noting only because a future column rename won't find it via the shared fragment. Style, not behaviour.
- Otherwise clean: resolution lives in `services/games.ts:56-87`, `teams.ts:39-79`, `nfl/game-stats.ts:63-74` and is imported everywhere else. Ingestion writes provider fields only (`sync-odds.ts:190-194`, `ingest-season.ts:384`); no `override*` keys written anywhere in `services/nfl/sync-*`, `ingest-season`, `sim/*`, or `packages/core`. All six `adminAudit` inserts are `tx.insert` inside the override's/rebuild's transaction (`admin-overrides.ts:154,265`, `nfl/admin-stats-overrides.ts:85,183`, `pickem/settlement.ts:379`, `survivor/settlement.ts:396`). SPA does no `override ?? provider` of its own.

_(coverage: `override\w*\s*\?\?|coalesce(` across apps/api, packages, apps/web; `override[A-Z]\w*:` in nfl/sim/core; `adminAudit` insert sites)_

### Data & database — settings JSONB evolves additively / parsed via `LEAGUE_SETTINGS_SCHEMAS`
- `apps/api/src/services/leagues/start.ts:45` — `const startWeek = (settings as { startWeek: NflWeekRef }).startWeek;` — stored JSONB cast rather than parsed on the join-cutoff / commissioner-window path (`leagueStartAt` is fed `season.settings` straight from the row by `join.ts:72-76`, `invites.ts:190,229`, `discovery.ts:136`, `crud.ts:92,229`). `startWeek` carries no `.default()` so no default is lost today; it is the cast pattern the rule warns against, and the only non-parsing reader found.
- Schemas themselves: `picksPerWeek` (`league-settings.ts:133`) and `maxBracketsPerMember` (`:270`) carry `.default()`; the range refs were backfilled by migration (`0024_brave_thunderball.sql`). Scoring/settlement loaders parse (`pickem/settlement.ts:91`, `survivor/settlement.ts:103`, both pick services, `league-weeks.ts:53,231`, `settings-reset.ts`).

_(coverage: `default(|z.object` in league-settings.ts; `\.settings\b` across services minus `parse|LEAGUE_SETTINGS`; `settings` migrations list)_

### Data & database — `isUniqueViolation` helper only
- no findings. Six call sites all go through `@picksleagues/db`'s `isUniqueViolation` (`users.ts:88`, `survivor/picks.ts:508`, `join.ts:91`, `renew.ts:75`, `pickem/picks.ts:256-257`). No inline `23505`/`DatabaseError`/`.constraint` checks outside `packages/db/src/errors.ts`.

_(coverage: `23505|DatabaseError|\.constraint|\.code ===|unique_violation` across apps/api/src, packages)_

### Data & database — validate all external input; env once at startup
- `apps/api/src/routes/invite-preview.ts:65` — `getInviteLinkPreview(db, clock, c.req.param("code"))` — the only raw `c.req.param` read in the API; bypasses zod (route is `app.get`, not `app.openapi`, on purpose because it serves HTML). The value only reaches `eq(leagueInvites.code, …)` as a bound parameter, and the sibling `/invites/{code}` schema is just `z.string()` (`packages/schemas/src/invites.ts:16`), so nothing stronger is being skipped — but an unbounded string on a public, cacheable route is the rule's exact case. S.
- Env: single `EnvSchema` parsed once via `loadEnv()` in `dev.ts:11` / `vercel.ts:9`; the only other `process.env` read is the dev port (`dev.ts:9`). Job query params validated through `SyncQuerySchema` (`lib/nfl-sync-jobs.ts:28-32`). `APP_ENV` gates sim routes by non-registration (`app.ts:91-93`).

_(coverage: `c.req.(param|query|json|header|text)(` across apps/api/src; `process.env` across apps/api + packages; read `packages/core/src/env.ts`)_

### Contract & codegen — committed spec, CI-enforced
- no findings. `package.json:25` `contract:check` fails on a dirty `openapi/`; `.github/workflows/ci.yml:100-101` runs it.

_(coverage: grep `contract|openapi` in package.json + .github/workflows)_

### Contract & codegen — no inline `.nullable()`/`.optional()` on a registered schema
- `packages/schemas/src/invites.ts:91` — `reason: JoinBlockedReasonSchema.nullable(),` — inline `.nullable()` on the `.openapi("JoinBlockedReason")` schema (`invites.ts:55`). Confirmed in the generated spec: component `JoinBlockedReason` is `{"type":["string","null"],"enum":[…, null]}` and `openapi/client` types it `… | "league_full" | null`. Today `JoinPreviewResponse` is the component's only `$ref`, so no other consumer is widened yet — but the first one that is will silently get `| null`. Fix: `NullableJoinBlockedReasonSchema = JoinBlockedReasonSchema.nullable().openapi("NullableJoinBlockedReason")` as the other 14 nullable variants do. S. (Latent, not yet **[BEHAVIOUR]**.)
- `.optional()` on registered schemas is pervasive: `leagues.ts:92-94` (`LeagueName`, `LeagueVisibility`, `MaxMembers`), `me.ts:117-119` (`Username`, `DisplayName`, `NullableImageUrl`), `admin-data.ts:72-73,232`, `nfl-game-stats.ts:123-124`, `sim.ts:234,237`, `lib/nfl-sync-jobs.ts:30`, `routes/sim.ts:127`, `routes/discovery.ts:18` (`WeekType`, `SimFinalStatus`, `LeagueMode`). Verified in `openapi/openapi.json`: none of those components is widened — `.optional()` lands on the parent's `required` list, not on the `$ref` target.

**Rule question:** the rule's "(or `.optional()`)" clause is contradicted by 15+ sites and by the generated spec, which shows `.optional()` does *not* inherit the registration the way `.nullable()` does. Either the clause should be dropped to `.nullable()` only, or the 15 sites are all violations — the evidence says the former.

_(coverage: `[A-Z]\w*Schema\s*\.\s*(nullable|optional)(` across packages/schemas + apps/api; each base schema checked for `.openapi("…")`; components inspected in openapi/openapi.json and openapi/client)_

### Security — job secret, sim non-registration, DB-backed admin, no secrets in bundle
- no findings. `/jobs/*` wraps `jobSecretMiddleware` (timing-safe compare, `routes/jobs.ts:94-104`; 500 `MISCONFIGURED` when env is absent). Sim routes mount only when `deps.env === undefined || isSimEnabled(deps.env)` (`app.ts:91`), where `isSimEnabled` hard-refuses `APP_ENV=production` (`env.ts:51-52`); the env-less branch exists solely for `generate-openapi.ts`. `/sim/*` and `/admin/*` stack `requireSession` + `requireAdmin` (`routes/sim.ts:219-220`, `admin.ts:259-260`, `admin-nfl-stats.ts:144-145`), and `adminMiddleware` reads `users.app_role` per request via `getAppRole` (`middleware/admin.ts:17`, `services/users.ts:106-108`). Only writer of `appRole` is `deleteAccount` resetting to `user` (`users.ts:170`). SPA has no `import.meta.env`/`VITE_*` reads (`vite.config.ts` only reads dev ports).

_(coverage: read both middlewares and `app.ts` registration; `getAppRole|appRole|app_role` across apps/api; `import.meta.env|process.env|VITE_` across apps/web)_

### Sizing
| Rule | Findings | Effort |
|---|---|---|
| Time & locking (all five sub-rules) | 0 violations (3 documented exemptions listed) | — |
| Constraints | 0 | — |
| Transactions | 1 (`sim/fixtures.ts` read-check-update race, **[BEHAVIOUR]**, sim-only) | S — wrap in `db.transaction` + `for("update")` |
| Settlement / idempotency | 0 | — |
| Override precedence | 1 style note (`sim/clock.ts` inline coalesce, intentional) | S or leave |
| Settings JSONB | 1 (`leagues/start.ts:45` cast instead of parse) | S — parse via `LEAGUE_SETTINGS_SCHEMAS[mode]` |
| `isUniqueViolation` | 0 | — |
| Input / env validation | 1 (`invite-preview.ts:65` raw param) | S — bound the string |
| Contract CI | 0 | — |
| Inline `.nullable()`/`.optional()` | 1 real (`invites.ts:91`, latent) + rule question on `.optional()` | S fix; rule edit |
| Security | 0 | — |

Total: 4 actionable findings (all S), 1 behaviour-flagged race confined to the simulator, 1 rule question.

## 3. Code craft (TypeScript, value sets, comments, imports, versions)

### TypeScript strict / `any` / `@ts-ignore`
- No findings. `tsconfig.base.json:7` has `"strict": true`. The one real `any` is `apps/api/src/lib/default-hook.ts:15` — `Hook<any, any, any, any>` — and it carries a three-line written reason plus an `eslint-disable-next-line @typescript-eslint/no-explicit-any`. No `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck` outside the generated `routeTree.gen.ts`. `packages/core/src/clock.ts:14` `eslint-disable-next-line no-restricted-syntax` has its reason on the line above.

_(coverage: `grep -rnE '\bany\b'`, `'[<:,(]\s*any\b|\bany\s*[>,)\[]'`, `'@ts-(ignore|expect-error|nocheck)'`, `'eslint-disable'`, `'as unknown as'`, `'"strict"'` in tsconfigs — over apps/ packages/ e2e/ scripts/, excluding node_modules/dist/routeTree.gen/openapi)_

### `enum` ban / value sets as const objects / raw-literal comparisons
No `enum` keyword anywhere. The repo has two idioms for service refusal reasons, and the older one violates "non-test code never compares raw literals of a set":

**Services declaring reasons as inline string-literal unions (no const set):**
- `apps/api/src/services/leagues/crud.ts:51` — `reason: "mode_unavailable" | "no_active_season" | "cap_exceeded" | "start_week_passed"`; returns at :65,:72,:98,:161
- `apps/api/src/services/leagues/crud.ts:171-175` — `reason: "league_not_found" | "not_commissioner" | "league_started" | "start_week_passed"` / `"invalid_settings"` / `"max_members_below_member_count"` / `"picks_locked"`; returns at :225,:235,:245,:264,:276
- `apps/api/src/services/leagues/crud.ts:347` — `reason: "league_not_found" | "not_commissioner" | "league_started"`; returns :361,:370
- `apps/api/src/services/leagues/authz.ts:53` — `reason: "league_not_found" | "not_commissioner"`; returns :72,:74
- `apps/api/src/services/leagues/renew.ts:17` — `"league_not_found" | "not_commissioner" | "no_newer_season"`; returns :50,:57,:76
- `apps/api/src/services/leagues/join.ts:123` — `reason: "league_not_found"`
- `apps/api/src/services/leagues/settings-reset.ts:35,82` — `reason: "picks_locked"`
- `apps/api/src/services/members.ts:41,43,49,54,134,188` — inline unions (`"cap_exceeded" | "last_commissioner"`, `"member_not_found" | "cannot_kick_self" | "league_started" | "last_commissioner"`, …); returns :84,:153,:160,:166,:178,:210,:217,:224,:236 with `as const` literals
- `apps/api/src/services/invites.ts:47,50,120` — `"league_not_found" | "not_commissioner"`, `"league_started"`, `"invite_not_found"`; returns :69,:134,:311 (`"invite_invalid"`)
- `apps/api/src/services/users.ts:44,89,152,180` — `"username_taken"`, `"last_commissioner"`
- `apps/api/src/services/league-weeks.ts:34,43,46,50` — `"league_not_found" | "wrong_league_mode"`

**Route handlers switching on raw literals of those sets:**
- `apps/api/src/routes/leagues.ts:243-` — `case "not_commissioner":` (:252,:322,:390), `case "league_started":`, `case "picks_locked":` (:290) — 13 `case "…"` arms
- `apps/api/src/routes/members.ts:99,147,196` — 15 `case "…"` arms (e.g. `:158 case "not_commissioner":`)
- `apps/api/src/routes/invites.ts:148,215` — 6 `case "…"` arms (e.g. `:157 case "not_commissioner":`)

Contrast: `pickem/picks.ts`, `survivor/picks.ts`, `sim/*`, `admin-overrides.ts`, `nfl/admin-stats-overrides.ts` return `ERROR_CODE.X` / `PICKEM_REFUSAL.X`, and `routes/admin.ts`, `routes/sim.ts` use `case ERROR_CODE.X:`.

**Ad-hoc `"home" | "away"` unions instead of `PICKEM_PICK_SIDE` (`packages/schemas/src/pickem-pick-side.ts:9`), compared as raw literals:**
- `packages/core/src/sim-provider.ts:294,296,297` — `(side: "home" | "away")`, `side === "home" ? …`
- `packages/core/src/sim-stats.ts:193,201` — `side: "home" | "away"`, `side === "home"`
- `apps/web/src/components/league/matchup-line.tsx:80,88,105` — `side: "away" | "home"`, `side === "home" && "flex-row-reverse"`, `side === "away" ? "text-left" : "text-right"`
- `apps/web/src/components/league/survivor-game-row.tsx:95,115,223,239` — same pattern
- `apps/web/src/components/league/nfl-matchup-stat-row.tsx:76,83` — `advantage === "away"` / `=== "home"`
- `apps/web/src/components/admin/nfl-context-override-patch.ts:124` — `(side === "home" || side === "away")`
- (`packages/core/src/espn-provider.ts:282-283`, `espn-provider-stats.ts:278-279` compare `competitor.homeAway === "home"` — that is ESPN's wire string inside the adapter, not our set; not a finding.)

**Rule question:** the refusal-reason half is ~60 sites across 9 services + 3 route files — every league/member/invite/user service predates the const-set convention. Either these get migrated (the `ERROR_CODE`-direct form the rule already prescribes for 1:1 mappings) or the rule should state that inline unions were grandfathered; right now the two halves of `apps/api/src/services` teach opposite patterns.

_(coverage: `grep -rnE '^\s*(export\s+)?(const\s+)?enum\s+'`; extracted every `[A-Z_]+: "literal"` value from packages/schemas|core|db const sets, then `grep -rnE "(===|!==)\s*\"(values)\"|case \"(values)\"\s*:"` over non-test code; `grep -rnE 'reason:\s*"[a-z_]+"'` and `'case (ERROR_CODE|[A-Z_]+_REFUSAL)\.'` over services/routes)_

### Comments explain why, never what
- No findings. Every candidate opened carried a constraint/reason (e.g. `apps/api/src/services/nfl/fetch-season-games.ts:4` "Fetches several weeks' games … The dedupe is not cosmetic: ESPN transiently lists…"). Short in-body comments are fixture annotations in tests (`apps/api/test/sim-settle.test.ts:90 // Member A picks the winner of both games.`) which state the arrangement a test depends on rather than narrate code.

_(coverage: all 437 .ts/.tsx/.sh/.mjs files; grep on ~120 imperative/narrative comment openers (`Fetch|Loop|Set|Return|Check|Create|Get|…|Helper|Utility|Constants|Types`) filtered for why-markers, then 12 survivors opened; grep on `here we|now we|first,|this (function|component|hook) (is|does|returns)|loop through|for each`; grep on short indented comments `^\s+//\s*[A-Z][^—:(]{3,40}\.?$` — 37 hits, all reviewed; all comments in `scripts/*.sh` read)_

### Comments citing non-durable identifiers
- `apps/api/test/invites-join.test.ts:493` — `describe("custom maxMembers cap (feedback item 10)", …)` — "item 10" is a feedback-round ordinal; the durable ID is `FB-10` (`backlog/14-owner-feedback.md`)
- `e2e/pickem-journey.sim.spec.ts:188` — `// Members are collapsed by default (feedback round 6), so anything asserted as` — round number, not an FB-ID/ADR
- `e2e/pickem-journey.sim.spec.ts:221` — `// tab (round 5). Which URL that tab lands on is routing; what matters to every` — same

Not flagged: the 40-odd `ADR-0018 decision 4` / `ADR-0015 decision 3` / `ADR-0011 decision 4` citations — those ADRs number their decisions in their `## Decision` section (`docs/adr/0018…md:45-127` has bold **1.**–**5.**), so the reference is ADR-qualified and greppable.

_(coverage: `grep -rnEi '\b(decision|option|step|item|phase|round|question|q)\s*#?[0-9]+\b'`, `'\((Decision|item|step|Option|Phase|Part|Round|Plan)\s*[0-9A-Z]…\)'`, `'review round|PR #|round [0-9]|feedback round|\(R[0-9]\)'`; cross-checked `FB-NN` IDs exist in backlog/14-owner-feedback.md (50 refs))_

### Doc-comment form follows visibility (`/** */` exports, `//` non-exports)
**`//` directly above an export (11):**
- `apps/api/test/setup/league-app.ts:13` — `export const PRE_START_NOW` under a `// Two apps over the same DB…` block
- `apps/api/test/setup/league-app.ts:16` — `export const POST_START_NOW` under `// now == kickoff exactly…`
- `apps/web/src/api/admin.ts:24` — `export const ADMIN_QUERY_KEY_PREFIX` under `// One home for the admin cache-key shape…`
- `apps/web/src/api/nfl-game-stats.ts:11` — `export const NFL_GAME_STATS_QUERY_KEY_PREFIX` under `// Exported for the admin stats-override mutations' invalidation fan-out…`
- `apps/web/src/components/league-settings-fields.tsx:161` — `export function MarchMadnessSettingsFields` under `// Scoring is standard doubling only (ADR-0034)…`
- `apps/web/src/components/legal-footer.tsx:42` — `export function LegalFooter` under `// Width/border differences stay at the call site via \`className\`.`
- `packages/schemas/src/image-url.ts:26` — `export const NullableImageUrlSchema` under `// The nullable wrapper is registered under its own component name…`
- `packages/schemas/src/nfl-game-stats.ts:156` — `export const NflGameStatsTeamContextSchema` under `// The wire twin of \`NflTeamGameContextSchema\`…`
- `e2e/setup/league-seed.ts:20` — `export const E2E_SEASON_YEAR` under `// A far-future season…`
- `e2e/setup/session.ts:80` — `export async function cleanup` under `// Specs must remove what they create…` (a caller obligation, the exact case the rule cites)
- `e2e/setup/session.ts:89` — `export function uniqueUsername` under `// 3-20 chars, [a-z0-9_]…`

**`/** */` directly above a non-exported top-level declaration (227)** — file: line(s), all confirmed adjacent (no blank line between `*/` and the declaration):
- `apps/api/src/lib/logger.ts: 21` · `apps/api/src/lib/pickem-refusals.ts: 17` · `apps/api/src/lib/survivor-refusals.ts: 22` · `apps/api/src/middleware/job-secret.ts: 10`
- `apps/api/src/routes/invite-preview.ts: 31,47` · `apps/api/src/routes/jobs.ts: 35,76` · `apps/api/src/routes/me.ts: 113`
- `apps/api/src/services/admin-data.ts: 158,290` · `discovery.ts: 19,29` · `invites.ts: 40` · `league-weeks.ts: 244` · `members.ts: 40` · `settlement.ts: 84`
- `apps/api/src/services/leagues/conclusion.ts: 74` · `current-season.ts: 189` · `settings-reset.ts: 42,54,75`
- `apps/api/src/services/nfl/admin-stats-data.ts: 21,148` · `admin-stats-overrides.ts: 130,144` · `ingest-season.ts: 10,31,154` · `sync-odds.ts: 112` · `sync-schedule.ts: 34` · `sync-scores.ts: 17` · `sync-stats.ts: 137,232` · `game-results.test.ts: 8` · `game-stats.test.ts: 12`
- `apps/api/src/services/pickem/picks.ts: 115,170,209,239,254,273` · `pickem/settlement.ts: 58,114,167,206,267,345,364`
- `apps/api/src/services/sim/clock.ts: 69` · `fixtures.ts: 74,98` · `replay.ts: 25,35` · `reset.ts: 51,74,140` · `settle.ts: 59,77,98,125,144,185,237,300,314` · `state.ts: 44` · `scenarios/survivor-season.ts: 50,58` · `scenarios/teams.ts: 15`
- `apps/api/src/services/survivor/picks.ts: 140,168,204,225` · `survivor/settlement.ts: 64,72,114,138,156,186,342,381,498,532` · `survivor/standings.ts: 62,77,300`
- `apps/api/test/admin-anomalies.test.ts: 72` · `admin-audit.test.ts: 104,122,153` · `admin-data.test.ts: 26,46,61` · `admin-nfl-stats.test.ts: 68,157` · `admin-overrides.test.ts: 52,96,123` · `admin-role.test.ts: 40` · `admin-teams.test.ts: 48` · `admin.test.ts: 17` · `invites-join.test.ts: 70` · `jobs.test.ts: 18` · `league-season-range.test.ts: 32,91,106,140,182` · `league-weeks.test.ts: 24` · `me.test.ts: 66` · `nfl-game-results.test.ts: 45` · `nfl-game-stats.test.ts: 42` · `nfl-sync-odds.test.ts: 37,68,76` · `nfl-sync-schedule.test.ts: 57,62,132,137,163` · `nfl-sync-scores.test.ts: 32,37,66` · `nfl-sync-stats.test.ts: 49` · `pickem-picks.test.ts: 66,77,93` · `renewal.test.ts: 64` · `settlement.test.ts: 37,54,91,117` · `setup/auth-helpers.ts: 21` · `setup/sim-helpers.ts: 59` · `sim-clock.test.ts: 32` · `sim-settle.test.ts: 33,60` · `survivor-picks.test.ts: 44` · `survivor-settings.test.ts: 32,46,66,88` · `survivor-settlement.test.ts: 26,40,53` · `survivor-standings.test.ts: 38,41,54,547`
- `apps/web/prerender/entry.tsx: 37,104,120` · `prerender/vite.config.ts: 13`
- `apps/web/src/components/admin/audit-log.tsx: 170` · `nfl-stat-context-browser.tsx: 25` · `nfl-stat-context-override-form.tsx: 30` · `team-identity-override-form.tsx: 42` · `apps/web/src/components/league-settings-fields.tsx: 94`
- `apps/web/src/components/league/nfl-matchup-stat-row.tsx: 44` · `nfl-matchup-stats-sheet.tsx: 103` · `pick-outcome.tsx: 22` · `pickem-game-row.tsx: 64,118` · `pickem-picks.tsx: 136,156,201` · `survivor-board.tsx: 51,81,319,422` · `survivor-game-row.tsx: 57,73,214,267` · `survivor-picks.tsx: 150,171,210,232,260`
- `apps/web/src/components/sim-clock-banner.tsx: 60,79` · `sim/sim-clock-card.tsx: 77` · `status-pill.tsx: 21` · `apps/web/src/lib/game.ts: 115` · `lib/toast.ts: 11`
- `apps/web/src/routes/_authed/admin/route.tsx: 19` · `_authed/discovery.tsx: 162` · `_authed/index.tsx: 33,121,181,220,238` · `_authed/sim/route.tsx: 17` · `routes/join.$code.tsx: 47`
- `e2e/capture-vis.sim.spec.ts: 30` · `identity.spec.ts: 14` · `pickem-journey.sim.spec.ts: 96,153` · `survivor-journey.sim.spec.ts: 58,93`
- `packages/core/src/espn-provider-stats.ts: 51,60` · `espn-provider.ts: 56,67,173,197,224,269` · `espn-provider.test.ts: 17,66,1281` · `season.ts: 76` · `sim-provider.ts: 42,58,114,316` · `sim-stats.ts: 47` · `sim-stats.test.ts: 12`
- `packages/schemas/src/game-status.ts: 42` · `league-actions.ts: 33` · `league-settings.ts: 22,111` · `nfl-game-stats.ts: 140` · `sim.ts: 357` · `survivor.ts: 177` · `packages/scoring/src/survivor.test.ts: 34`

Samples: `apps/api/src/lib/logger.ts:21` `/** Errors don't serialize to JSON as anything useful by default — pull out message/stack. */` over `function serializeFields`; `apps/api/src/services/members.ts:40` `/** Thrown inside member transactions to roll back and surface the refusal. */` over `class MemberMutationError`; `packages/schemas/src/game-status.ts:42` multi-line `/** */` over `const UNPLAYED_GAME_STATUSES`.

**Rule question:** 227 `/** */` on non-exports vs 11 `//` on exports. The non-export direction is violated in essentially every file of every package — the repo's actual convention is "`/** */` for anything with a why, regardless of visibility". Either the rule's non-export clause is dropped (the failure it names — an invisible caller contract — only applies to the export direction, and the export direction is nearly clean) or this is a large mechanical sweep with no behavioural payoff.

_(coverage: script over every .ts/.tsx/.mjs top-level `export? (async)? function|const|let|class|type|interface` declaration, classifying the immediately preceding comment; six hits opened to confirm adjacency)_

### Module headers (contents listings / restating filename)
- No findings. All 26 line-1 headers read carry a whole-module why (single-home rules, package invariants, barrel omissions — e.g. `apps/api/src/services/leagues/index.ts:1-5`, `packages/scoring/src/index.ts:1-2`). Weakest is `apps/web/src/lib/user.ts:1-2` (`// Shared derivations so every call site … agrees on how a user is displayed.`) which is a single-home rule and passes.

_(coverage: dumped the leading comment block of every file that begins with a comment (26 files); `grep -rnEi 'This (file|module) (contains|defines|exports|provides)|Contents:|Exports:|Utilities for|Helpers for|Helper functions|Types for|Constants for'` — 0 hits)_

### Extensionless relative imports
- No findings.

_(coverage: `grep -rnE "from\s+['\"]\.{1,2}/[^'\"]+\.(js|ts|tsx)['\"]"` and dynamic `import('./x.js')` form)_

### Match surrounding code
- `apps/api/src/services/invites.ts:47,93 vs :150` — object shapes as `type CommissionerGateFailure = {…}` / `type ListInvitesResult = …` alongside `export interface InviteLinkPreview {` for a plain data shape in the same file
- `apps/web/src/lib/game.ts:94 vs :425` — `type GameStateInput = {` alongside `export interface SurvivorGradablePick {` for a plain data shape
- (Repo-level, not intra-file: the refusal-reason split listed under the value-set rule — `leagues/*`, `members.ts`, `invites.ts`, `users.ts`, `league-weeks.ts` vs the const-set services — is the one clear two-idiom case. No file mixes `export const x = () =>` with `export function`; `packages/core/src/game-data-provider.ts` uses `interface` only for the implemented contract and `type` for data, which is a deliberate split.)

_(coverage: per-file counts of `^export const X = (` vs `^export (async )?function`, and `^(export )?interface` vs `^(export )?type X = {`; services/routes refusal-idiom census above)_

### Prefer latest stable versions
`pnpm -r outdated` ran clean. Majors behind:
- `typescript` — 6.0.3 → 7.0.2 (every workspace package; `tsconfig.base.json`)
- `@types/node` — 24.13.3 → 26.2.0 (api, core, db, web, root); root `engines.node >=24` and `.nvmrc` 24, so `@types/node@24` is the matching pin and this one is arguably correct as-is
- Minors/patches behind (no action implied by the rule): `better-auth` 1.6.23→1.7.1, `hono` 4.12.30→4.13.3, `@hono/zod-openapi` 1.5.1→1.6.1, `@hono/node-server` 2.0.10→2.1.1, `@base-ui/react` 1.6.0→1.7.0, `@playwright/test` 1.61.1→1.62.1, `vite` 8.1.5→8.2.2, `eslint` 10.7.0→10.9.0, `shadcn` 4.13.1→4.19.0, `lucide-react` 1.25.0→1.33.0, `@types/pg` 8.20.0→8.23.1, plus ~12 patch bumps (tanstack, react 19.2.7→19.2.8, vitest, prettier, tsx, sonner).

_(coverage: `pnpm -r outdated` at repo root; `package.json` engines; `.nvmrc`)_

### Sizing
| Rule | Findings | Effort |
|---|---|---|
| TS strict / `any` / ts-ignore | 0 | — |
| `enum` / const value sets / raw-literal comparisons | ~60 refusal sites (9 services, 3 route files) + 13 `"home"\|"away"` sites | M (mechanical; routes' switches become `case ERROR_CODE.X`, optionally `satisfies Record<…>` per the route-plumbing rule) |
| Comments: why not what | 0 | — |
| Non-durable identifiers | 3 | S |
| Doc-comment form | 11 export-side, 227 non-export-side | S for the 11; L for the 227 (or S to amend the rule) |
| Module headers | 0 | — |
| Extensionless imports | 0 | — |
| Match surrounding code | 2 intra-file (+ the refusal split above) | S |
| Latest stable | 1 actionable major (typescript 6→7), 1 deliberate (`@types/node` tracks engine) | M (TS major may surface new errors) |

## 4. Tests

### The spec is the test plan (packages/scoring)
- **No findings.** Every Pick'em scoring row (correct +1 / incorrect 0 / push & tie +0.5 / cancelled-as-push), the ATS vs SU matrix, postponed-settles-when-played, in-progress never graded, partial/missed weeks, identical sets tie, and shared-rank competition ranking are table-driven or pinned in `packages/scoring/src/pickem.test.ts` (`it.each` at :104, :224, :245, :314, :353, :538) and `standings.test.ts` (:129–:157 tie rows). Every Survivor rule (win/loss/tie-advances-team-consumed, cancel-returns-team, missed pick eliminates, everyone-out revival incl. mixed causes, incomplete week holds, co-winners at end week, provisional elimination superset) is in `survivor.test.ts` (`it.each` at :152, :228, :278, :369, :673; co-winners :488).
- Rules that live *outside* `packages/scoring` by design, each pinned elsewhere: "fewer games than Picks Per Week" → `requiredPickemPickCount` in `packages/schemas/src/pickem.test.ts`; team-reuse ledger, eliminated-cannot-pick (ADR-0025), pick window (ADR-0036), sole-survivor conclusion (ADR-0027), join-after-start zero weeks → `apps/api/test/{survivor-picks,pickem-picks,survivor-settlement}.test.ts` (e.g. `survivor-picks.test.ts:541-599`, `survivor-settlement.test.ts:597,619`).

_(coverage: read `docs/mvp-spec.md` §Leagues/§Mode 1/§Mode 2 in full; listed every `describe|it|it.each` in the three scoring test files and opened each section; grep `ADR-0027|ADR-0036|concluded|sole` across `apps/api/test`.)_

### Integration tests cover the named list
All six COVERED; one gap noted.
- (a) Lock validation — `apps/api/test/pickem-picks.test.ts:884` "409s pick_locked when a submitted game has already kicked off", `:908` "…exactly at the kickoff instant"; `survivor-picks.test.ts:219,243`. **Gap:** no concurrent pick-mutation race (no `Promise.all` in either picks file) — in-tx re-validation is proven only by clock-boundary apps. Races *are* tested for joins/members/settlement (`invites-join.test.ts:467`, `members.test.ts:484`, `settlement.test.ts:1213`).
- (b) Spread-staleness — `pickem-picks.test.ts:1367` "409s spread_stale when the submitted spread doesn't match", `:1450` `spread_unavailable`; `settlement.test.ts:212` grades against `spread_at_pick`.
- (c) Visibility — `pickem-picks.test.ts:579` "filters another member's picks to kicked-off games only"; `survivor-picks.test.ts:715` (`{ hasPicked: true, pick: null }` pre-kickoff), `:755`.
- (d) Join cutoffs & caps — `invites-join.test.ts:395,455` (cutoff, kickoff==now), `:424` full league rolls back, `:467` concurrent joins `[201, 409]` at 100, `:594` public join after cutoff.
- (e) Settlement idempotency — Pick'em `settlement.test.ts:814` "settling the same week twice produces identical…"; Survivor `survivor-settlement.test.ts:734`, `:750` full recompute == incremental.
- (f) Override precedence — `admin-overrides.test.ts:215` "resolves override ?? provider on the read path", `:403` "survives a re-sync", `:454` audit prior values, `:515` no audit row on refusal; settlement loaders `settlement.test.ts:408`, `survivor-settlement.test.ts:663`; syncs `nfl-sync-{scores,schedule,odds}.test.ts:283,473,361`.

_(coverage: every `it(` name in pickem-picks, survivor-picks, invites-join, settlement, survivor-settlement, admin-overrides, admin-audit, nfl-sync-*, sim-settle, members; bodies opened at each cited line; `Promise.all|concurrent` across `apps/api/test`.)_

### Extract repeated test setup into shared helpers
- `apps/api/test/admin-anomalies.test.ts:43`, `admin-audit.test.ts:62`, `admin-data.test.ts:46`, `admin-overrides.test.ts:109`, `admin-nfl-stats.test.ts:113` — five local `async function adminCaller()` copies of the exported `test/setup/sim-helpers.ts:130 adminCaller`.
- `apps/api/test/setup/league-app.ts:131` and `setup/sim-helpers.ts:136` — `withCookie` exported twice from the setup layer itself; meanwhile 10 test files hand-roll `...(cookie ? { cookie } : {})` (`admin-nfl-stats.test.ts` ×4, `leagues.test.ts` ×3, `me.test.ts` ×3, `admin-data`, `admin-overrides`, `admin-teams`, `admin`, `nfl-game-results`, `nfl-game-stats`, `renewal`).
- 13 files re-declare the `createDb → createAuth → createApp({… clock: async () => new FixedClock(…)})` trio that `setup/league-app.ts:29 makeLeagueTestHarness` and `setup/sim-helpers.ts:82-104` package: `admin-anomalies.test.ts:33-40`, `admin-audit.test.ts:48-58`, `admin-data.test.ts:28-39`, `admin-overrides.test.ts:47-70`, `admin-role.test.ts:21-27`, `admin-teams.test.ts:36-39`, `admin.test.ts:19-27`, `admin-nfl-stats.test.ts:43-46`, `nfl-game-results.test.ts:29-32`, `nfl-game-stats.test.ts:30-33`, `nfl-sync-{odds,scores,schedule}.test.ts:58,56,98`.
- `nfl-sync-schedule.test.ts:243`, `nfl-sync-scores.test.ts:632`, `nfl-sync-odds.test.ts:879`, `settlement.test.ts:1350` — same "401s without x-job-secret" block; `nfl-sync-scores.test.ts:641,666`, `nfl-sync-odds.test.ts:897` re-type `headers: { "x-job-secret": … }` while `setup/sim-helpers.ts:173-187` exports `run*SyncJob`.
- `admin-overrides.test.ts:151-165`, `admin-audit.test.ts:270-284`, `admin-anomalies.test.ts:135-148` — identical 401 `unauthenticated` / 403 `not_admin` pairs; `admin-data.test.ts:239` already shows the `it.each(paths)` form.
- `e2e/identity.spec.ts:33`, `e2e/league-lifecycle.spec.ts:5`, `e2e/pickem-journey.sim.spec.ts:80`, `e2e/survivor-journey.sim.spec.ts:61` — `async function signInAs(context, overrides)` copy-pasted verbatim four times (plus `sim-panel.spec.ts:16 signInAsAdmin`, inline at `capture-vis.sim.spec.ts:165-172`); `e2e/setup/session.ts` exports only `mintSession`.
- `e2e/pickem-journey.sim.spec.ts:268-282` vs `survivor-journey.sim.spec.ts:222-234` vs `capture-vis.sim.spec.ts:102-114,318` — sim reset/load-scenario/afterAll-reset block; `setClock` at `survivor-journey.sim.spec.ts:125-133` vs `capture-vis.sim.spec.ts:94-100` (inline at `pickem-journey.sim.spec.ts:463,536`).
- `e2e/league-lifecycle.spec.ts:28-60`, `pickem-journey.sim.spec.ts:297-311`, `survivor-journey.sim.spec.ts:243-291` — create league → invite → `latestInviteCode` → `/join/{code}` spine re-driven three times (acknowledged at `pickem-journey.sim.spec.ts:312-319`).
- `e2e/identity.spec.ts:27` vs `survivor-journey.sim.spec.ts:104` — duplicated `[data-sonner-toast][data-type=…]` selector.
- `apps/web/src/components/admin/game-override-patch.test.ts:197-222` (4×) and `sim/fixture-patch.test.ts:107-129`, `nfl-stats-override-patch.test.ts:91-97` — the `expect(result.status).toBe("invalid"); if (…) expect(result.fieldErrors.X)…` boilerplate repeated ~10× across four files with no shared `expectFieldError` helper (minor).

_(coverage: `adminCaller|withCookie|cookie ? { cookie }|createDb|createAuth|createApp|FixedClock|x-job-secret|beforeEach|afterAll` across `apps/api/test`; `async function signInAs|setClock|reset|loadScenario|data-sonner` across `e2e`; `status !== "invalid"|status === "invalid"` across `apps/web`.)_

### Table-driven `it.each`
- `apps/api/test/pickem-picks.test.ts:727,736,746` — three "caps picksAllowed …" cases: seed → `getPicks` → `expect(picksAllowed).toBe(n)`, only settings/expected differ.
- `apps/api/test/pickem-picks.test.ts:1008,1026,1043` — `400s too_many_picks` / `duplicate_pick` / `game_not_in_week`: `putPicks({ picks })` → 400 + slug, only the `picks` array differs.
- `apps/api/test/admin-overrides.test.ts:177,186,195` — three "400s on …" with `putOverride(body)` → 400; `:789,802` — two "refuses a kickoff/clear that would re-open picks" → 409 `override_unlocks_game`.
- `apps/api/test/survivor-picks.test.ts:175,187` (team-not-playing / cancelled → 409) and `:570,582` (next week with no pick / after loss → `week_not_open`).
- `apps/api/test/nfl-sync-scores.test.ts:387,416` — identical assertions, differ only in `{ seasonYear, weekNumber }` vs `{ weekNumber }`.
- `packages/scoring/src/survivor.test.ts:734,740` (absent game, alive `[MEMBER]` vs `[]`) and `:752,762` (duplicate pick, alive vs out) — pairs identical except the alive set.
- `packages/scoring/src/pickem.test.ts:287,298` — cancelled SU vs cancelled ATS → push; same shape, differ by `settings(pickType)`.
- `apps/web/src/components/admin/game-override-patch.test.ts:85,167,177` ("sends an edited X") and `:121,128,172` ("… explicit null clear" via `edit()`), `:204,211,218` ("… on its own field" invalid) — each group is one `it.each` table; the file already uses `it.each` at :97/:135/:197 for the same shapes.
- `apps/web/src/components/league/pickem-picks.test.ts:33,37,41` and `survivor-picks.test.ts:37,41,45` — three "drops a selection whose game …" cases each; identical body, input differs.

_(coverage: listed `it(` per describe in every `apps/api/test`, `packages/scoring`, `apps/web` test file and opened adjacent same-shaped bodies.)_

### Assert the outcome, never the process
- `apps/api/test/nfl-sync-scores.test.ts:413,440,479,586,603,618` — `expect(provider.fetchCalls).toEqual([[SEASON_YEAR, REGULAR, 1]])` exact provider-call ledger; breaks on harmless fetch batching while the DB rows asserted alongside would not. (`:88` zero-calls-when-inactive is a genuine product property — keep.)
- `apps/api/test/nfl-sync-schedule.test.ts:426-467` — `vi.spyOn(console, "warn")` + `not.toHaveBeenCalled()`. Judged **acceptable**: the structured log line is the operator alert channel under ADR-0007, so its payload is the outcome.
- `e2e/pickem-journey.sim.spec.ts:510-517` — `pageA.request.put(/api/…/picks)` then `expect(refused.status()).toBe(409)` / `ERROR_CODE.ALREADY_SUBMITTED` — raw API call asserted inside a browser journey; verbatim duplicate of `apps/api/test/pickem-picks.test.ts:798`.
- `e2e/survivor-journey.sim.spec.ts:154` — `expect(body.leagues[0]?.summary.weeks).toBe(…)` on the `/sim/settle` response summary before the board.
- `e2e/identity.spec.ts:141-157` — `page.waitForResponse(… "PATCH" && url().includes("/api/me"))` binds the test to verb/path (used as a wait; documented at :136-140); `:123` `toBeDisabled()` used as a refetch signal.
- `e2e/league-lifecycle.spec.ts:29,34,39,45,51,64,66` — `toHaveURL` after each tab click; routing as process (mild).
- `apps/web/src/components/league/pickem-standings-table.test.ts:70-72` — `expect(Object.values(STANDINGS_SORT_COLUMN)).toEqual(["rank","member","record","points"])` freezes the board's column set (component shape); the comment argues it as the no-tiebreaker guarantee, but the type no longer carries a differential, so the compile already holds it.

_(coverage: `vi\.(fn|mock|spyOn)|toHaveBeenCalled|mock\.calls|fetchCalls|console\.` across `apps`, `packages`, `e2e`; `waitForResponse|request\.(put|post|get)|toHaveURL` across `e2e`.)_

### UI tests bind to roles and semantics
- `e2e/pickem-journey.sim.spec.ts:497` — `expectValue(…"game-state", /\b(Today|Tomorrow)\b/)` — product copy in the merge gate; a reword to "Tonight"/weekday breaks it (justified at :490-494 as app-clock proof; a `data-relative-day` attribute would hold the proof).
- `e2e/pickem-journey.sim.spec.ts:567-569` — `toHaveText("T-1")`, `"2-2-0"` — tie prefix and W-L-T format are display conventions; `:611` `"MIA 17"` score formatting.
- `e2e/pickem-journey.sim.spec.ts:195`, `capture-vis.sim.spec.ts:256` — `row.locator("summary")` structural element selector.
- `e2e/pickem-journey.sim.spec.ts:306`, `league-lifecycle.spec.ts:53`, `survivor-journey.sim.spec.ts:283`, `sim-panel.spec.ts:85` — `getByRole("button", { name: "Revoke"|"Load" }).first()` positional pick.
- `e2e/survivor-journey.sim.spec.ts:166`, `sim-panel.spec.ts:98-99` — `page.locator("#…")` id selectors (the latter justified inline).
- `e2e/identity.spec.ts:27`, `survivor-journey.sim.spec.ts:104` — `[data-sonner-toast][data-type=…]` third-party attribute selector (deliberate, documented).
- `apps/web/src/manifest.test.ts:33,40-42` — `expect(shell).toContain('<link rel="manifest" href="/manifest.webmanifest" />')` exact markup string (infra check, but it's DOM-structure binding).
- No `locator("td")`, `.nth(`, class selectors, `text=`, or long-sentence `name:` anywhere; `getByText(leagueName|@username)` hits are domain data, not copy. `apps/web` has no rendered-component tests at all (no `@testing-library`, no `render(`).

_(coverage: `getByText|locator\(|\.nth\(|toHaveText|toContainText|getByRole\(.*name:|getByTestId|\.first\(\)|\.last\(\)|getByLabel` across `e2e`; `getByText|getByRole|locator\(|render\(|@testing-library` across `apps/web/src`.)_

### E2E covers journeys, not branches
- `e2e/pickem-journey.sim.spec.ts:510-517` — `already_submitted` 409 via direct API call; pinned at `apps/api/test/pickem-picks.test.ts:798`. Delete.
- `e2e/pickem-journey.sim.spec.ts:382` — submit disabled at 3/4 picks; `pickem-picks.test.ts:828` pins `pick_set_incomplete`, the button state is presentation.
- `e2e/identity.spec.ts:55-57` — short-username validation error; rule lives in `packages/schemas/src/username.test.ts`.
- `e2e/identity.spec.ts:133-165` — avatar set/clear round-trip and taken-username 409 → field error inside the profile-edit test; `apps/api/test/me.test.ts:236,338,358` pin both. Trim to "save a change → menu reflects it".
- `e2e/sim-panel.spec.ts:112` — non-admin 404 on `/sim`; API gating at `apps/api/test/sim-gating.test.ts:75-97` (only the SPA route guard is new).
- `e2e/sim-panel.spec.ts:26` — `:51-54,67-72,83-87,105-106` are control-presence assertions per tab; smoke, not a journey.
- `e2e/survivor-journey.sim.spec.ts:371-378` — eliminated-sees-verdict / consumed-team-disabled; `survivor-picks.test.ts:267,462,808,824` pin — but they read as board checkpoints of the settlement journey, borderline.
- `e2e/capture-vis.sim.spec.ts` — screenshot harness, zero `expect`, `test.skip(!process.env.VIS_CAPTURE)` at :49 so it's out of the merge gate. Not a finding, but it shares the `*.sim.spec.ts` glob with real gates.

_(coverage: every `test(` in all seven specs listed and read; overlap checked against `it(` names in `apps/api/test/{pickem-picks,survivor-picks,settlement,survivor-settlement,me,sim-gating}.test.ts`; `playwright.config.ts` + root `package.json` scripts read.)_

### Don't unit-test presentation policy
- `apps/web/src/lib/format.test.ts:17-19,29` — `expected: "Today "`, `"Tomorrow "`, `"Yesterday "` freeze relative-day label strings; the calendar-day arithmetic is the domain, the words are the owner's (the file's own header admits it pins "only the relative half").
- `apps/web/src/lib/game.test.ts:208-209` — `spreadLabel(0, …)` → `"Even"` pins a label word (FB-30); the sign-flip rows at :204-207 are domain (home-relative spread) and fine. `:234-265` `matchupNumerals` pins `"17"/"27"` score strings — the *which number* rule is domain, the string form is presentation.
- `apps/web/src/components/league/pickem-standings-table.test.ts:70-72` — freezes the column list `["rank","member","record","points"]` (layout answer).
- `apps/web/src/components/admin/game-override-patch.test.ts:68` — `.clock).toBe("12:34")` m:ss rendering (borderline: it's the round-trip contract with `:190`, acceptable).
- Otherwise clean: `pickem-picks.test.ts`, `survivor-picks.test.ts`, `league.test.ts`, `user.test.ts`, `redirect.test.ts`, `date-time-value.test.ts` test domain/boundary helpers and explicitly decline to test rendering.

_(coverage: read every `apps/web/**/*.test.ts` in full; grep `toBe\("[A-Z]|Today|Tomorrow|"Even"` across `apps/web/src`.)_

**Rule question:** none of the rules looks wrong. The one tension: "Extract repeated test setup" is violated by 13 API files re-typing the app trio and by *two* exported `withCookie`/`adminCaller` helpers in `test/setup` itself — the setup layer split (`league-app.ts` vs `sim-helpers.ts`) is the root, not author habit.

### Sizing
| Rule | Findings | Effort |
| --- | --- | --- |
| Spec is the test plan (scoring) | 0 | — |
| Integration named list | 6/6 covered; 1 gap (pick-mutation race) | S |
| Shared test helpers | 10 clusters (~40 sites: API 5 clusters, e2e 4, web 1) | M (merge `league-app`/`sim-helpers` duplicates first, then sweep) |
| Table-driven `it.each` | 11 groups (~30 `it`s) | S–M (mechanical) |
| Outcome not process | 7 (1 acceptable) | S |
| Roles/semantics selectors | 7 (2 documented/deliberate) | S (add `data-*` attrs for Today/T-/record) |
| Journeys not branches | 7 (delete/trim ~5 branch assertions) | S |
| Presentation policy | 4 (1 borderline) | S |

## 5. UI rules & design system

### One page skeleton
- `apps/web/src/components/admin/admin-gate.tsx:27,35,46` — the gate renders three different `<main>` variants (`items-center justify-center gap-3 p-4 sm:p-6`, `items-center justify-center py-8`) instead of the one skeleton with centred states inside it; the admin/sim `route.tsx` files then render *another* `<main>` for the allowed branch, so the column is owned twice.
- `apps/web/src/routes/_authed/profile.tsx:57` — `<main className="flex flex-1 flex-col items-center gap-4 p-4 sm:p-6">`: adds `items-center` to the canonical string; `new.tsx:114` does the same. Centring belongs on the card, not the column (low).
- `apps/web/src/routes/_authed/guide.tsx:37` — `<div className="max-w-2xl">` narrows the prose column without centring it; the rule's named shape for narrow content is a centred card inside the column.
- `apps/web/src/routes/claim-username.tsx:68`, `routes/sign-in.tsx:33`, `routes/join.$code.tsx:51` — `<main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">`: `p-6` rather than `p-4 sm:p-6`, so phone padding differs from every authed page (these are pre-shell routes, see rule question).
- `apps/web/src/components/static-page.tsx:37`, `routes/welcome.tsx:62` — `<main className="mx-auto … max-w-2xl … p-4 py-8 sm:p-6 sm:py-10">` / `max-w-3xl … px-4 py-6` set their own width and padding.

**Rule question:** five routes outside the authed shell (sign-in, claim-username, join, welcome, static pages) each mint their own `<main>`; the rule only describes the authed column. Either name a second skeleton for shell-less pages or accept these as a stated carve-out.

_(coverage: `grep '<main'`, `grep -E 'max-w-|px-[0-9]'` over routes, read each hit)_

### Loading states / QueryState
- `apps/web/src/components/admin/admin-gate.tsx:25-42` — hand-rolled `isPending` / `isError` triad (`Couldn't load this page.` + Retry) bypassing `QueryState`, with no stated reason (contrast `join.$code.tsx:68-71`, which states its deviation).
- `apps/web/src/components/sim/sim-reset-card.tsx:75-79` — `{leagues.isError && <p …>Couldn't load your leagues.</p>}`: inline failure with no Retry, outside `QueryState`.
- `apps/web/src/components/sim/sim-clock-card.tsx:290-302` — hand-rolled error (`Couldn't load seasons.` + Retry) and empty (`No seasons synced yet`) branches for the seasons query; same again at `:132` for games. Has a why-comment for *showing* the error, not for bypassing `QueryState`.
- Skeletons: no findings — every `Skeleton` site goes through `LoadingRegion`/`RowsSkeleton`/`PageSkeleton`/`CardGridSkeleton` (all carry `role="status"` + label); no `"Loading…"` text remains outside comments.

_(coverage: `grep -i 'Loading…|>Loading<'`, `grep Skeleton`, `grep -E '\.(isPending|isLoading|isError)'`, read hits)_

### Async buttons
- `apps/web/src/routes/claim-username.tsx:105` — `{claim.isPending ? "Claiming…" : "Continue"}` swaps the label while pending.
- `apps/web/src/routes/join.$code.tsx:139` — `{join.isPending ? "Joining…" : "Join league"}`.
- `apps/web/src/routes/_authed/profile.tsx:290` — `{update.isPending ? "Saving…" : "Save changes"}`.
- List-wide pending flags: no findings — every row-level action scopes by `mutation.variables` (`sync-jobs-card:73`, `members-section:97-98`, `invite-panel:60`, `sim-scenarios-card:77/100`, all override forms, `sim-clock-card:192-199`).

_(coverage: `grep -E 'isPending \?|pending \?'`, `grep '"[A-Z][a-z]+ing…"'`, `grep isPending` and read each `disabled=`)_

### Table primitive
- No findings — the only raw `<td>` is inside `components/ui/calendar.tsx` (shadcn day-picker), and the sole `overflow-x-auto` outside `ui/` is on `audit-log.tsx:156` (`<pre>`, not a table) and `tab-nav.tsx:58`.

_(coverage: `grep '<table|<thead|<tbody|<td|<th'`, `grep overflow-x-auto`)_

### Surface tiers
- `apps/web/src/components/league/survivor-board.tsx:342` — this-week pick block is `"flex flex-col gap-1 rounded-md border-l-2 bg-muted/40 py-2 pr-2 pl-2.5"`: a filled, rounded box *inside* a `rowClassName` row (`:233`), with a 2px rule instead of `rowRuleClassName` (3px). The comment cites FB-42 ("same frame as every other pick row") but the other pick rows moved to the row tier in VIS-3/5.
- `apps/web/src/components/league/survivor-board.tsx:455` — history entries use the same `rounded-md border-l-2 bg-muted/40` box per `<li>`, nested inside the member row.
- `apps/web/src/routes/join.$code.tsx:156` — blocked-reason notice is an ad-hoc `rounded-md border border-destructive/30 bg-destructive/10 p-3` box inside a `Card` (bordered in bordered); no named primitive for an inline alert.
- `apps/web/src/components/admin/team-identity-override-form.tsx:55` — logo preview swatch `rounded-md ring-1 ring-border` inside a row (stated as a deliberate exception in the header comment; tier nesting not addressed).
- `Band` count: no findings — one band per subject (`LeagueHeader`, `LeagueCardStrip` per card, welcome hero).

_(coverage: `grep '<Band|LeagueCardStrip|LeagueHeader'`, `grep -E 'rounded-.*border|border.*rounded'`, `grep -E '\bborder(-[a-z]+)?\b'` minus `border-[bltr]`, `grep -E 'bg-(muted|card|accent)'`, Card/Section nesting listing per file)_

### Type roles
- `apps/web/src/components/league/survivor-board.tsx:348` — `<span className="text-xs font-medium text-muted-foreground">This week</span>`: a hand-built label where `type-eyebrow` is the role (the "tell" the checklist names).
- `apps/web/src/components/league/survivor-board.tsx:389` — `<p className="text-xs font-medium text-muted-foreground">Teams used</p>`.
- `apps/web/src/components/league/survivor-board.tsx:440` — `<summary className="… text-xs font-medium text-muted-foreground …">Pick history (n)</summary>`.
- `apps/web/src/components/league/survivor-board.tsx:461` — week label on each history entry, `text-xs font-medium text-muted-foreground`.
- `apps/web/src/components/admin/nfl-stats-browser.tsx:149` — `<p className="text-xs text-muted-foreground">updated {formatDateTime(…)}</p>`: a stamp, which the design system sets as `type-eyebrow` (the stats sheet's stamp at `nfl-matchup-stats-sheet.tsx:218` is).
- `apps/web/src/components/admin/nfl-stat-context-browser.tsx:161` — same stamp shape, `text-xs text-muted-foreground`.
- `apps/web/src/components/league/nfl-matchup-results.tsx:120-123` — `"Season results · updated …"` stamp as `text-xs text-muted-foreground` while its sibling sheet section (`stats-sheet.tsx:218`) renders the identical line as `type-eyebrow`.
- `apps/web/src/components/admin/teams-browser.tsx:77` — `<p>Updated {formatDateTime(team.updatedAt)}</p>` stamp in body text.
- `apps/web/src/components/league-settings-fields.tsx:122,153,170` — `<h2 className="text-sm font-semibold text-foreground">`: `h2` already gets `type-heading` from the base layer; the inline weight+size overrides the role (also reads as the `text-xs font-semibold` family of tells).
- `apps/web/src/components/league/nfl-matchup-stats-sheet.tsx:459` — segmented control labels `text-xs font-medium capitalize` (hand-built tab set; see Orange).
- Display numerals: no findings — every numeral goes through `Figures`/`LeagueStanding`/`MatchupSide` or `type-display text-xl`+; no `type-display` below `text-xl`; `tabular-nums` only on the standings record, which is body by design.

_(coverage: `grep -E 'text-\[[0-9]+px\]|uppercase|tracking-'` minus `type-*`, `grep -E 'text-xs font-(medium|semibold)'`, `grep -E 'font-(semibold|bold)'`, `grep -E 'text-(xl|2xl|3xl|4xl)'`, `grep tabular-nums`, `grep -E 'type-display.*text-(xs|sm|base|lg)'`)_

### Orange
- `apps/web/src/components/league/nfl-matchup-stats-sheet.tsx:448-462` — a hand-rolled `aria-pressed` segmented control whose active state is `bg-background … shadow-sm`, not primary: the rule says the active tab *is* orange, and this is the only tab-like control not on `TabNav`. Judgment call — either it is a tab (then primary) or a toggle set (then name it in the design system).
- Otherwise no findings: `primary` outside `components/ui` hits only `tab-nav.tsx:26`, `app-tab-bar.tsx:36`, the selected-pick rules in `pickem-game-row.tsx:168,262` and `survivor-game-row.tsx:155,321`.

_(coverage: `grep primary` minus `components/ui`, `index.css`)_

### Theme tokens / arbitrary colours
- `apps/web/src/components/admin/team-identity-override-form.tsx:56,72` — `bg-white` / `bg-zinc-950` / `text-zinc-400` / `text-zinc-600` — non-token colours. A stated reason exists in the header comment (each swatch *represents* a theme), so this is a documented deviation rather than a defect; flagging because it is the one non-OAuth exception and the rule names only OAuth.
- OAuth buttons (`sign-in.tsx:58,74`, `icons.tsx:11-23`) cite the brand guidelines — compliant.

_(coverage: `grep -E '#[0-9a-f]{3,8}|rgb\(|hsl\(|(text|bg|border|ring)-\[|(bg|text|border)-(white|black|zinc|gray|…)'`)_

### Accessibility
- No findings — no `div`/`span`/`li` with `onClick`; every `<img>` has `alt` (logos `alt=""` decorative, preview `alt="… logo preview"`); the only icon-only button (`install-card.tsx:34`) has `aria-label`; every `Input`/`Select` outside the form primitives has a `Label htmlFor` (`discovery.tsx:88`, `settings-section.tsx:333`, `profile.tsx:184`, `league-week-picker.tsx` sr-only label).

_(coverage: `grep -E '<(div|span|li|p)[^>]*onClick'`, `grep '<img'` ±4 lines, `grep 'size="icon'`, `grep -E '<(Input|Select|Textarea|input|select)'`, `grep aria-label`)_

### Errors (toast vs inline)
- No findings — every `useMutation` in `apps/web/src/api/*.ts` has an `onError` → `toast.error` (or maps a typed refusal); no `useMutation` outside `api/`; the three `toast.error` calls in components (`settings-section.tsx:293,313`, `new.tsx:96`) are client-side validation on a save action, not a view failure; no view toasts *and* renders inline.

_(coverage: per-module `grep -E 'useMutation\(|onError|toast\.'`, `grep 'toast\.'` over components/routes)_

### Forms
- `apps/web/src/components/sim/sim-clock-card.tsx:146-161` — `useState` per field (`seasonId`, `weekId`, `anchor`, `instantValue`, `seededFrom`) driving the Week/Instant jump controls; outside the named carve-out. Arguably controls-feeding-a-mutation rather than a form, but it has a datetime field with seeding logic that the carve-out was written to avoid duplicating.
- `apps/web/src/routes/_authed/discovery.tsx:50-55` — `useState` `draftQuery` / `appliedQuery` behind a `<form onSubmit>` (single search field). Low — a filter, not a payload form.
- `FormTextField` bypass: no findings — all `form.Field` sites render through `form-field.tsx` / `number-field.tsx` / `form-date-time-field.tsx`.

_(coverage: `grep -l 'useForm|@tanstack/react-form'`, `grep '<form'`, `grep useState` in form-bearing files, `grep -E '<Input.*value='`)_

### Derived user display values / UserIdentity
- No findings — `displayNameOf`/`handleOf`/`initialsOf`/`identityLines` are the only homes (`app-header.tsx:4`, `avatar-theme-preview.tsx:1`); the only bare email is the member's own read-only profile field (`profile.tsx:185`), which the rule permits; every other-member render goes through `UserIdentity` (7 sites).

_(coverage: `grep -E 'displayName \?\?|\.email\b|initials|charAt\(0\)|`@'`, `grep '<UserIdentity'`, `grep Avatar`)_

### Relative-to-now labels / app clock
- `apps/web/src/components/ui/calendar.tsx:17` — `const year = new Date().getFullYear();` for the year-dropdown bounds. Has a stated reason (widget-local range, ±30/+2 years) and is not a label; listing for completeness, no action.
- Otherwise no findings — `Date.now()` appears only in `lib/app-clock.ts` (the offset store); 16 files consume `useAppNow()`.

_(coverage: `grep -E 'Date\.now\(\)|new Date\(\)'` excluding tests, `grep -l useAppNow`)_

### Mobile-first
- No findings — every grid is `grid-cols-1 … sm:/lg:` (mobile-up); no `w-[Npx]`/`min-w-[Npx]`; the one fixed width is the header menu `w-72` (a popover, fits 390px).

_(coverage: `grep -E 'w-\[[0-9]+px\]|min-w-\[|w-(64|72|80|96)|grid-cols-[3-9]'`, read each grid)_

### Kickoff local tz / standings "last updated"
- No findings — all date rendering goes through `lib/format.ts` (`toLocale*String(undefined, …)` = viewer's locale/tz); both boards render a `type-eyebrow` "Last updated" stamp (`pickem-standings-table.tsx:301`, `survivor-board.tsx:122`).

_(coverage: `grep -E 'toLocale|Intl\.DateTimeFormat|timeZone'`, `grep -i 'last updated|updated '`)_

### Sizing
| Rule | Findings | Effort |
| --- | --- | --- |
| One page skeleton | 5 (+1 rule question) | S–M (admin-gate restructure is the real one) |
| Loading / QueryState | 3 | S |
| Async buttons | 3 | S |
| Table | 0 | — |
| Surface tiers | 4 (survivor-board ×2 is the substantive one) | M |
| Type roles | 10 (survivor-board ×4, stamps ×4, settings h2 ×3 counted once, segmented control) | S–M |
| Orange | 1 (judgment) | S |
| Theme tokens | 1 (documented deviation) | — |
| Accessibility | 0 | — |
| Errors | 0 | — |
| Forms | 2 (both judgment) | M if sim-clock-card migrates |
| User display / UserIdentity | 0 | — |
| App clock | 0 (1 documented) | — |
| Mobile-first | 0 | — |
| Kickoff tz / last updated | 0 | — |

The concentration is `components/league/survivor-board.tsx` (boxes-in-rows, 2px rule, four hand-built labels) — it looks like the one board the VIS-5 pass didn't fully re-classify — plus a consistent small pattern of admin/sheet "updated …" stamps left in `text-xs` after VIS-8 converted the stats sheet's.
