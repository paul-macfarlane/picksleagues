# Verifying Picks Leagues changes at runtime

Build/launch/drive recipe for runtime-verifying changes in this repo (Vite SPA + Hono API + local Docker Postgres + season simulator). Kept as a doc rather than a skill so any session cites exact commands from one place.

## Launch

Prereqs: root `.env` (copy `.env.example`; `BETTER_AUTH_SECRET`/`JOB_SECRET` = `openssl rand -base64 32`; placeholder OAuth creds are fine for everything except completing a real OAuth sign-in).

```sh
pnpm db:up          # Docker Postgres 17 → localhost:5433 (postgres/postgres, db picksleagues); waits for healthy
pnpm db:migrate     # applies packages/db/migrations
pnpm dev            # both dev servers: web http://localhost:5173 (Vite), api http://localhost:3000 (tsx watch, loads ../../.env)
```

Readiness: `curl -s http://localhost:3000/api/health` → `{"status":"ok"}`. The SPA is served at :5173 and proxies `/api` to :3000 (same-origin — always drive auth/cookie flows through :5173, never :3000). Auth liveness: `curl -s http://localhost:3000/api/auth/ok`.

## Test layers

```sh
pnpm test               # unit (vitest, packages/*/src/**/*.test.ts) — no DB needed
pnpm test:integration   # in-process Hono + real Postgres; auto-creates + migrates picksleagues_test on :5433 (override with TEST_DATABASE_URL)
pnpm test:e2e           # Playwright chromium against its OWN stack — picksleagues_e2e on :5273/:3100, never the dev DB or dev ports (override with E2E_DATABASE_URL)
pnpm typecheck          # every workspace package, then e2e/tsconfig.json (e2e/ is in no workspace)
pnpm typecheck && pnpm lint && pnpm contract:check   # static gates; contract:check fails if openapi/ is stale
pnpm --filter @picksleagues/web build                # the ONLY build in the repo — there is no root `pnpm build`
```

**Scoping a partial vitest run: use `--project`, never `--dir` or a bare path.** The two projects in `vitest.config.ts` are selected by name, and `--dir` is only a path filter applied *within every* project — so `vitest run --dir packages/scoring` still runs the `integration` project, whose `globalSetup` creates and migrates the test database. Narrow with `vitest run --project unit <path>`. This matters because `--dir` reads like a scope filter and is not one, so a run meant to stay off the database can reach it while believing it has not.

**Visual evidence for a UI epic: `VIS_CAPTURE=1 pnpm test:e2e --grep capture`.** `e2e/capture-vis.sim.spec.ts` shoots every route at 390px and 1024px in both themes into `docs/evidence/test-results/vis-8/` — public and auth pages, the hub in every state, a Pick'em league (Straight Up and ATS) and a Survivor league each before kickoff and settled, the matchup stats sheet, and every admin and simulator tab — arranging each state through the API on the E2E stack. It asserts nothing and is skipped without the flag, so it never costs the merge gate; re-run it after a visual change and review the captures against the ADR-0043 checklist in `docs/design-system.md` (one band at most, no nested bordered surfaces, every number in a role, the pill vocabulary unchanged, orange only on action and selection). ~4 minutes; the parallel chromium project runs first as the simulated project's dependency.

**Copy-decoupling probe — three runs, not two.** To prove the e2e suite is decoupled from copy (the standing guarantee QLTY-2 established): (1) run the gate green on current copy; (2) reword the bound strings in the SPA and re-run — it must still pass; (3) revert and re-run to prove the revert is clean. Back the reverts with byte-exact file copies rather than hand edits, and confirm with `git status` before reporting.

## Drive

- The SPA consumes the generated OpenAPI client, so most behavior is verifiable straight against the API — `curl` routes per the committed spec in `openapi/openapi.json`.
- **The simulator is the primary verification harness** (non-prod only, and only when `SIM_ENABLED=true` — a 404 on any `/sim/*` route means the flag is unset/false or `APP_ENV=production`, ADR-0014, not a broken route): load a canned scenario (`POST /sim/scenarios/{slug}/load`) or replay a real past season (`POST /sim/scenarios/replay`), set or advance time (`POST /sim/clock`), inspect or hand-edit fixture games (`GET`/`PATCH /sim/fixtures/games`), check overall sim state including the scenario library (`GET /sim/state`), and reset (`POST /sim/reset`), then assert via ordinary API reads. `/sim/*` is admin-role-gated (ADR-0013) — mint a session and grant the `admin` role (`mintSession({ appRole: "admin" })` in `e2e/setup/session.ts`, or `UPDATE users SET app_role = 'admin' WHERE id = ...` against a session minted per the Auth-gated flows section below), no shared-secret header. Scenario library slugs (`apps/api/src/services/sim/scenarios/index.ts`): `push-ats`, `tie-game`, `cancelled-game`, `postponed-game`, `all-eliminated`, `mixed-week`. Time-dependent behavior (locking, cutoffs, deadlines) must be verified by moving the simulated clock, never by editing kickoff timestamps.
- DB inspection: `docker compose exec db psql -U postgres -d picksleagues` (`-d picksleagues_test` for the integration DB). Clean up synthetic rows afterward.

## Auth-gated flows

Sign-in is OAuth-only (Google/Discord), so headless verification mints a session instead: `createAuthenticatedUser(auth, overrides?)` in `apps/api/test/setup/auth-helpers.ts` creates a user + session through Better Auth's internal adapter and returns `{ user, session, cookie }` where `cookie` is the ready-to-send `Cookie` header value (the signed `better-auth.session_token`). Integration tests pass `cookie` to in-process `app.request(..., { headers: { cookie } })`. For a live dev server, run a tiny tsx script from `apps/api` that calls `loadEnv` → `createDb` → `createAuth` → `createAuthenticatedUser`, then curl with `-b "<cookie>"`. **Load the env from inside the script** (`process.loadEnvFile("../../.env")` as its first statement) — it reads the same file as a `--env-file` flag without naming a secret-bearing path on the command line, which keeps the command clean of guard prompts and shell history alike. For Playwright, `e2e/setup/session.ts` wraps the same flow: `mintSession()` returns a cookie shaped for `context.addCookies`, plus `cleanup(userIds)` (ADR-0006; see `e2e/identity.spec.ts` for usage). Clean up minted rows afterward (`DELETE FROM users WHERE ...` cascades sessions). Smoke-level checks that don't need a session: `POST /api/auth/sign-in/social` with `{"provider":"google","callbackURL":"/"}` returns a provider redirect URL even with placeholder creds.

## Parallel sessions

A second session works in a sibling worktree (`/worktree`). What's shared, and therefore what collides:

- The dev Postgres (:5433) and dev servers (5173/3000) are one instance. Don't reset the simulator or reseed while another session is mid-verification.
- `pnpm test:integration` (picksleagues_test) and `pnpm test:e2e` (picksleagues_e2e, ports 5273/3100) are **exclusive across sessions** — one at a time. Typecheck, lint, and unit tests are collision-free and always safe.

## Gotchas

- **Touch-target and safe-area checks need phone emulation, not just a narrow window.** The 44pt `touch-hit` expansion (`apps/web/src/index.css`) is gated on `(pointer: coarse)`, which a resized desktop Chromium never matches; drive with a Playwright device profile (`devices["iPhone 13"]` sets `hasTouch`, so the media query matches) and read `getComputedStyle(el, "::before").inset` for the expansion. `env(safe-area-inset-*)` is 0 everywhere but a real notched device in standalone mode, so the inset padding itself is only provable on a phone.
- **Phone-width coverage lives in the Pick'em journey.** The joiner's context in `e2e/pickem-journey.sim.spec.ts` is `devices["iPhone 13"]`, so every merge runs one member through join → pick sheet → Submit at 390px with the bottom tab bar (`AppTabBar`, MOB-2) on screen and the pick-sheet action bar stacked above it. Anything that must hold at phone width belongs on that member, not in a new project.
- Host port is **5433** (5432 is taken by a local Postgres install, 5434 by paulitakes).
- `BETTER_AUTH_URL` must be `http://localhost:5173` (the SPA origin), or the session cookie lands where the SPA can't see it.
- `apps/web/src/routeTree.gen.ts` is regenerated by the router plugin on dev/build; it's ignored by ESLint/Prettier — never hand-edit or reformat it.
- Playwright reuses already-running dev servers locally; if a run leaves stray servers behind, check `lsof -nP -iTCP:3000 -iTCP:5173 -sTCP:LISTEN`.
- **Toasts are the one sanctioned exception to "never bind to DOM structure"** (`.claude/rules/engineering.md` §Quality): sonner exposes no data-attribute pass-through for our own handle, so `[data-sonner-toast][data-type="error"]` (as `e2e/identity.spec.ts` uses) is the binding. Accepted risk, named so it isn't rediscovered as a bug — a sonner major that renames those attributes fails the merge gate with no product change. The alternative is binding to toast copy, which is worse: copy changes on the owner's judgement alone and must not tax that.
