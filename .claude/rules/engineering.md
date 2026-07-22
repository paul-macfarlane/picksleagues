# Engineering Rules

Standards for all code in this repo. When a rule and `docs/architecture.md` conflict, the architecture doc wins for architecture; these rules govern craft. Violating a rule is fine only with a stated reason.

## Architecture & boundaries

- **API-first.** The SPA consumes the generated OpenAPI client (`openapi-fetch`) only — never hand-rolled `fetch` against API routes, never types duplicated from the server. Anything a future mobile client couldn't do through the contract is a design smell.
- **One definition per DTO.** Zod schemas in `packages/schemas` are the single source for runtime validation, OpenAPI generation, and TS types. No parallel interfaces restating a schema. Username rules, settings shapes, and enums live here so the same rule serves API and UI.
- **Route handlers are thin boundaries:** validate (zod via `@hono/zod-openapi`) → auth/role guard → delegate to a domain service. No business logic or DB access inline in a route handler or job endpoint.
- **Route plumbing is shared, never copy-pasted.** OpenAPI error-response descriptors (401/403/404/500), the deps guards (`requireDbAndClock`/`requireSession` middleware), and the unhandled-error handler (`app.onError` → logged JSON 500) live in `apps/api/src/lib` — a route file never restates them. Expected refusals travel as typed service results the handler maps explicitly (exhaustive `switch` when there is more than one reason — TypeScript enforces coverage); anything *thrown* is a bug by definition and becomes the logged 500. Wire error slugs come from the `ERROR_CODE` const set in `packages/schemas`, never inline strings.
- **Services own their queries — no repository layer.** Domain services call Drizzle directly; Drizzle is already the typed data-access abstraction, and services taking `db: Db` compose into transactions naturally (a `tx` satisfies `Db`). A non-trivial query needed by two services gets extracted as a shared function — a targeted extraction, not a layer. The testing seams are integration tests against real Postgres and the pure `packages/scoring`, not mocked repositories.
- **`packages/scoring` stays pure.** Settlement/scoring functions take plain data and return plain data — zero I/O, no imports from `db` or `core`. This is the most intricate logic in the app and the reason it's exhaustively testable.
- **Provider shapes never leak.** ESPN response shapes live inside the ESPN adapter in `packages/core`; everything else sees only our domain types via `GameDataProvider`. Swapping providers must touch one module.
- **Request paths never call ESPN.** External data is ingested by jobs into our tables; reads serve our tables. An ESPN outage degrades ingestion, never the product.
- **Per-mode pick tables, not polymorphic ones** (arch D9). A new mode adds tables + a settings schema + a scoring module; shared behavior lives in `games`, `pick_results`, and `standings`. Don't fork shared tables per mode.
- **A file that accretes unrelated responsibilities gets split** along those responsibilities; conversely, don't mint a new module for a lone function an existing domain module already covers.
- **Loose coupling.** Depend on function signatures, not internals. A service or component should be replaceable without touching its callers.

## Time & locking (the load-bearing rules)

- **All "now" reads go through the injected `Clock`** — no raw `Date.now()`, no `new Date()` for current time, no SQL `now()` in domain logic (lint-enforced). Clock values reach SQL as bound parameters.
- **Lock state is derived, never stored** (arch D11): reads compute `locked = kickoff_at <= clock.now()`; every pick mutation re-validates `kickoff_at > clock.now()` inside its transaction and returns 409 on violation. No `locked` columns, no lock-flipping jobs.
- **Pick visibility is enforced in the query layer** — pick rows are serialized to non-owners only after the associated game kicks off. Never client-side filtering, never a visibility flag column.
- Join cutoffs and commissioner power windows (pre-start vs post-start) derive from the same clock + game timestamps.

## Data & database

- **Constraints encode the rules.** One membership per user per league, unique team per member per league (elimination), exactly 63 slots per bracket, citext-unique usernames — the DB enforces what the spec states; app-level checks are a second line of defense, not the only line.
- **Use transactions for multi-step writes** that must be atomic (settle + rebuild standings, join + cap check). Prefer collapsing a check-then-act into one guarded statement where possible. Never hold a transaction open across a network call.
- **Settlement is a pure derivation** (arch D10): `pick_results` and `standings` must be recomputable from (picks, results, settings) at any time. The incremental path is an optimization; never write state a full recompute wouldn't reproduce.
- **Jobs are idempotent** — safe to re-run, safe to double-trigger, safe to fire manually from the admin page. A missed tick means the next tick does the work; no job may depend on having run exactly once.
- **Override precedence is `override_* ?? provider_*`**, resolved in exactly the places the architecture names (serializers + settlement input loader). Ingestion writes only provider fields; a re-sync can never clobber a correction. Every override/rebuild writes `admin_audit`.
- **Settings JSONB evolves additively.** A change to a per-mode league-settings schema must either be additive with a Zod `.default()` (so previously stored rows still parse) or ship a data migration rewriting the stored JSONB — never let stored settings and the current schema silently diverge. Read paths that feed scoring/settlement parse through `LEAGUE_SETTINGS_SCHEMAS` so defaults materialize instead of being trusted to exist.
- **Constraint-violation detection goes through the shared `isUniqueViolation` helper** (`packages/db`) — never restate the DrizzleQueryError → pg `DatabaseError` unwrapping inline.
- **Validate all external input** with a schema before use — route params, query params, bodies, job payloads. Validate env vars once at startup. `APP_ENV` gates simulator routes by **non-registration** in production, not by auth.

## Contract & codegen

- The OpenAPI spec and generated web client in `openapi/` are **committed**; CI fails if regeneration dirties them. Change the Zod schema → regenerate → commit schema, spec, and client together.

## Quality

- **TypeScript strict.** No `any` without a written reason; no `@ts-ignore` without a comment explaining why.
- **Value sets are const objects** + `as const` with a derived literal-union type (game status, league mode, pick outcome, member role, push/tie resolution, league actions, wire error codes). The TS `enum` keyword is banned. Non-test code never compares raw literals of a set; tests MAY assert raw literals — they pin the contract so a constant-value edit fails loudly.
- **Comments explain why, never what.** State constraints, invariants, cross-file couplings, and ADR/architecture refs; delete sentences that restate the signature or narrate steps.
- **The spec is the test plan.** Every scoring rule and edge case in `docs/mvp-spec.md` has a table-driven unit test in `packages/scoring` — a spec rule without a test case is a review failure. Integration tests (in-process Hono against real Postgres) cover what units can't: transactional lock validation, spread-staleness 409s, visibility filtering, join cutoffs and caps, settlement idempotency (run twice, assert identical state), override precedence. E2E (Playwright) runs the full local stack with `SimulatedProvider` + the simulated clock — no network mocks anywhere — and is the merge gate.
- **Extract repeated test setup into shared helpers** rather than copy-pasting fixtures; prefer table-driven tests (`it.each`) when cases differ only in inputs/outputs.
- **Mobile-first.** Design and verify layouts at phone width first, then scale up. All kickoff times and deadlines display in the user's local timezone; standings show a "last updated" timestamp; the UI never claims real-time freshness.
- **Theme tokens only.** No arbitrary color values in components — CSS-variable tokens so light/dark both work. Sole exception: third-party brand-mandated colors (OAuth buttons), with the guideline cited in a comment.
- **Accessibility:** semantic HTML, labelled controls, keyboard-operable interactions, sufficient contrast.
- **Errors are handled,** not swallowed. User-facing failures show a clear message; server failures are logged with context; job endpoints return non-2xx on failure so the cron scheduler's failure notifications fire (ADR-0007 — no in-app alerting). In the SPA, a failed user action surfaces via the shared sonner toast (`toast.error`) — one mechanism, every action, no bespoke error UI.
- **Forms use TanStack Form.** SPA data-entry forms are built on `@tanstack/react-form` — no hand-rolled `useState`-per-field forms, no react-hook-form. Field validators are the shared Zod schemas from `packages/schemas` passed directly (Zod v4 is Standard Schema — no resolver shim, no restated rules). Per-field Label/Input/error a11y wiring goes through `FormTextField` (`apps/web/src/components/form-field.tsx`); server-side field conflicts (e.g. username 409) map to field errors via `form.setErrorMap`, everything else follows the toast rule.
- **Derived user-display values have one home.** Formatting derived from user/session data (display name fallback, initials, and the like) lives in shared helpers (`apps/web/src/lib/user.ts`), never inline in components — inline copies drift.
- **Extensionless relative imports.** The repo resolves with `moduleResolution: "bundler"` and every runtime path goes through a transpiler (tsx/vite/vitest/esbuild) — never write NodeNext-style `.js` suffixes on relative imports.
- **Match surrounding code** in naming, structure, and idiom. Consistency over personal preference.
- **Prefer the latest stable versions.** Upgrade when there's no breaking change; call out and schedule breaking upgrades rather than silently pinning old.

## Security

- Job endpoints require the shared-secret header. Sim endpoints require the shared secret **and** are not registered when `APP_ENV=production`.
- Admin capability = env-var user-ID allowlist, checked server-side; admin surfaces are invisible to non-admins.
- Secrets and DB access are server-only; nothing secret ships in the SPA bundle. No PII beyond what OAuth provides.
