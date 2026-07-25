# 0013. App-wide admin capability lives in `users.app_role`; `ADMIN_USER_IDS` becomes a bootstrap seed

- **Status:** Accepted
- **Date:** 2026-07-25
- **Related:** supersedes the env-var allowlist in `docs/architecture.md` §Manual Sports Data Overrides ("Admin role"); amends ADR-0011 (which described `/sim/*` as "admin-session-gated (env-var allowlist)"); relates to ADR-0006 (minted-session E2E); `.claude/rules/engineering.md` §Security

## Context

Admin capability was an env-var allowlist of Better Auth user ids (`ADMIN_USER_IDS`),
checked with an array membership test. That was the right call while the admin surface was
one page of job triggers: zero schema, zero UI, and a capability that cannot be granted by
an application bug because it is not application state.

Two things changed.

**E2E cannot grant it.** Playwright starts the API as a separate OS process whose
`loadEnv()` caches `ADMIN_USER_IDS` once at boot. Specs mint users *after* that, with
`randomUUID()`-derived ids, so a minted user can never be an admin: the allowlist is
immutable for the server's lifetime and the spec cannot know an id before minting it. CI
writes an empty `ADMIN_USER_IDS` into the `.env` both the server and the minting helper
read. SIM-7 puts the simulator control panel behind that gate and needs E2E coverage of it,
which is unreachable today. `docs/architecture.md` already claimed "E2E mints an admin
session per ADR-0006" — ADR-0006 describes no such mechanism and none existed.

Integration tests, by contrast, have no problem at all: each builds its own `Env` in-process
and can name a just-minted user. This is specifically an out-of-process problem.

**Nothing else about a user is configuration.** Every other user attribute is a column.
An app-wide role modelled as deploy configuration means granting or revoking admin requires
an env-var change and a redeploy — for a solo project that is tolerable, but it also means
the capability cannot be inspected, audited, or changed by the app itself, which the admin
epic's later tasks (ADM-3's `admin_audit`) will want.

## Decision

**1. `users.app_role` is the sole authorization source.** A `text` column typed
`$type<AppRole>()` against an `APP_ROLE = { USER, ADMIN }` const set, defaulting to `user` —
the same shape as `league_members.role` (ADR-0004), not a Postgres enum. `adminMiddleware`
reads it; `/me`'s `isAdmin` derives from the already-loaded user row.

**2. `ADMIN_USER_IDS` is demoted to a bootstrap seed.** On session resolution, a user whose
id appears in the list is promoted to `admin` in the database if they are not already. The
env var grants nothing by itself — authorization never consults it. This keeps a zero-SQL
path to the first admin in any fresh environment (a new Neon branch, a teammate's laptop,
CI) without making configuration the source of truth.

The seed is deliberately **promote-only**: removing an id never demotes anyone. A seed that
revoked would make the env var authoritative again by the back door, and would silently
strip a role granted deliberately at runtime.

**3. Seeding hooks into session resolution, not the admin guard.** `GET /me` must report a
seeded admin's capability on their very first request, because the SPA renders its admin
surfaces off that flag and would otherwise never route them to an admin endpoint at all.
Cost when the list is empty — the normal case — is one array check and no query.

**4. `requireAdmin` reads `db` from `deps`, not from the request context.** They are the same
instance (`requireDbAndClock` sets `deps.db` on the context), and reading from `deps` keeps
the guard mountable on the two routes that deliberately resolve their own dependencies to
preserve a `JobRunResponse`-shaped misconfiguration 500 — `/admin/jobs/nfl/{job}` and
`/sim/scenarios/replay`. Requiring context order would have forced either a dead fallback or
a second deps guard that re-parses the job slug.

## Consequences

Easier: E2E can mint an admin (`mintSession({ appRole })`), which unblocks admin and
simulator coverage. A role can be granted or revoked against a running deployment with one
UPDATE, no redeploy. Admin capability becomes auditable state that ADM-3 can record against.

Harder/accepted: authorization now costs a query per admin request rather than an array
check — irrelevant at this scale, and the same read `/me` already performs. Admin is now
application state, so an application bug *could* grant it; the mitigations are that only the
seed path writes the column, that path is promote-only and matches on primary key, and no
route exposes role mutation (an admin-managed promotion UI is deliberately not built —
revisit if a second admin ever needs onboarding without DB access).

`APP_ROLE` is a two-value set today. It is a role column rather than an `is_admin` boolean so
a third value (a read-only support role, say) doesn't require a migration to a different
shape — but no such value is planned, and adding one is not a reason to ship it early.
