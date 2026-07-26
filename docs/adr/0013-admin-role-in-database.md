# 0013. App-wide admin capability lives in `users.app_role`; the `ADMIN_USER_IDS` env allowlist is removed

- **Status:** Accepted
- **Date:** 2026-07-25
- **Related:** removes the env-var allowlist described in `docs/architecture.md` §Manual Sports Data Overrides ("Admin role"); amends ADR-0011 (which described `/sim/*` as "admin-session-gated (env-var allowlist)"); relates to ADR-0006 (minted-session E2E); `.claude/rules/engineering.md` §Security

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

**2. `ADMIN_USER_IDS` is deleted outright.** Granting admin is a direct database update:

```sql
UPDATE users SET app_role = 'admin' WHERE email = 'you@example.com';
```

An earlier draft of this ADR kept the env var as a promote-only "bootstrap seed", on the
theory that it gave a fresh environment a zero-SQL path to its first admin. That theory was
wrong, and the review that caught it is the reason this decision reads as it does: **you have
to query the database for a user's id before you can put it in the env var**, so the seed
replaced one `UPDATE` with three steps — look up the id, set the variable, restart or
redeploy so `loadEnv` re-reads it. It bought nothing and cost something real: because the
seed re-applied on every authenticated request, a listed id was a standing grant that
silently undid any database revocation, which is a footgun with no upside.

There is deliberately no `pnpm admin:grant` script either. Anyone who can grant admin already
has database access, and one documented SQL line beats a script that has to resolve
credentials, parse arguments, and be kept working.

**3. `requireAdmin` reads `db` from `deps`, not from the request context.** They are the same
instance (`requireDbAndClock` sets `deps.db` on the context), and reading from `deps` keeps
the guard mountable on the two routes that deliberately resolve their own dependencies —
`/admin/jobs/nfl/{job}` and `/sim/scenarios/replay`. Requiring context order would have
forced either a dead fallback or a second deps guard that re-parses the job slug to name it.

Note what this does *not* buy: when `db` itself is the missing dependency, `requireAdmin`
returns an `ErrorResponse` 500 before the handler runs, so those two routes' declared
`JobRunResponse` 500 envelope survives only for a missing clock or provider. That was
already true of `requireSession`'s auth-500 and is not a regression — but the ordering choice
is justified by keeping the guard mountable at all, not by preserving the envelope.

## Consequences

Easier: E2E can mint an admin (`mintSession({ appRole })`), which unblocks admin and
simulator coverage. A role can be granted or revoked against a running deployment with one
UPDATE, no redeploy. Admin capability becomes auditable state that ADM-3 can record against.

Harder/accepted: authorization now costs a query per admin request rather than an array
check — irrelevant at this scale, and the same read `/me` already performs.

Admin is now application state, so in principle an application bug could grant it. The
mitigation is that **no application code writes the column at all**: the only writes are the
manual `UPDATE`, the test helper, and `deleteAccount` clearing it back to `user` so an
anonymized tombstone row doesn't keep a capability. No route exposes role mutation, and no
admin-managed promotion UI is built — revisit only if a second admin ever needs onboarding
without database access. Better Auth cannot write the column either, because it is absent
from the adapter's `additionalFields`; a regression test pins that rather than leaving it to
inspection, since adding an `additionalFields` entry later would silently make it writable.

Bootstrapping a brand-new environment now requires database access. That is the intended
trade: it is one SQL statement, whoever sets up an environment already has the credentials,
and there is no configuration path that can grant a capability behind the database's back.

Nothing records *when* or *by whom* a role was granted. That's acceptable while the grant is
a deliberate manual act outside the app, and ADM-3's `admin_audit` is where in-app grants
would be recorded if a promotion surface is ever built.

`APP_ROLE` is a two-value set today. It is a role column rather than an `is_admin` boolean so
a third value (a read-only support role, say) doesn't require a migration to a different
shape — but no such value is planned, and adding one is not a reason to ship it early.
