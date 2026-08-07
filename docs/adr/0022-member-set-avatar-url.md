# 0022. Member-set avatar URL

- **Status:** Accepted
- **Date:** 2026-08-07
- **Related:** [0013](0013-admin-role-in-database.md) (admin capability off Better Auth
  `additionalFields`, same reasoning applied here); `docs/mvp-spec.md` §Users & Identity;
  `override_* ?? provider_*` convention (`packages/db/src/schema/sports.ts`); backlog ID-4,
  TS-5 (`backlog/10-trust-safety.md`)

## Context

The spec says the avatar is provider-pulled with no custom uploads. Members want their own.
Uploads mean stored bytes, an image pipeline, cost, and a day-one moderation obligation. A URL
is a pointer — no bytes stored — but it forces three questions: what validation is *honest*,
whether the provider value stays provider-owned, and what it means that this image renders to
every member of every league the user is in.

## Decision

**A URL, not an upload.** "No custom uploads" stands unchanged; this adds a pointer alongside
it.

**Validation is any `https:` URL, ≤2048 chars** (`packages/schemas/src/image-url.ts`).
Explicitly rejected, with reasons:

- A **host allowlist** — a maintenance treadmill that blocks legitimate hosts and stops
  nothing; any allowlisted host serving user-uploaded content serves arbitrary bytes by
  definition.
- A **server-side HEAD/GET check** — TOCTOU by construction: the bytes change the moment
  after it passes, and building it turns a member-supplied URL into an SSRF vector out of our
  own egress. It buys a false sense of having checked.

`https:` only is honest about what it is: a *rendering* constraint, since an `http:` avatar is
blocked as mixed content anyway — not a security control. Note for the record that
`z.url({ protocol: /^https$/ })` accepts IP-literal and single-label hosts
(`https://1.2.3.4/…`, `https://localhost/…`); a `hostname` constraint would reject those and
was considered and not adopted, having the same theatre problem as an allowlist. What actually
bounds the risk is downstream: the value renders in an `<img src>` (no script execution), and a
broken or non-image src degrades to initials through Base UI's `AvatarImage` and
`UserIdentity`'s `AvatarFallback`.

**`users.image` stays provider-owned.** The member's value is a new nullable
`users.image_override`; reads resolve `image_override ?? image` in the serializers, the same
precedence the schema already uses for game-data overrides. Better Auth's
`/api/auth/update-user` accepts `z.record(z.string(), z.any())` and writes `image` verbatim
with no validation, so a value stored there would be reachable by a route this repo's
validation never sees — the same reasoning that keeps `app_role` off Better Auth's
`additionalFields` (ADR-0013). The split also makes "clear" a null-out reverting cleanly to
provider truth, and stops a later provider-image refresh clobbering a member's choice.
**This does not close the write path to the fallback itself** — see Consequences.

**Wire shape:** `MeResponse` carries the resolved `image` *and* the raw `imageOverride`; every
other surface carries only the resolved `image`. The form must echo what the member typed;
nobody else has a use for the distinction, and shipping it would tell every league member
whether another member's avatar is provider-supplied.

## Consequences

**The residual bypass (accepted).** With `image_override` null the rendered value *is*
`users.image`, which any signed-in user can still set to any string via
`POST /api/auth/update-user` — that route is not disabled by this decision. The column split
protects the member-facing write path and preserves provider truth across a clear; it does
**not** close the bypass on the fallback leg. Accepted because there is no privilege escalation
(a user rewriting their own fallback), the SPA never calls that route, and the one-line closure
(`disabledPaths: ["/update-user"]`) would retire the existing test that proves `app_role` is
unwritable through a *live* route — a guard worth more than the residual costs.

**IP and referrer exposure (accepted).** Every viewer's browser fetches the avatar directly
from the member's chosen host, handing it the viewer's IP, User-Agent, and `Referer`. A member
can point their avatar at a host they control and log the IP of everyone in their leagues.
Accepted: it is the same exposure any third-party image carries, it identifies no member by
name, and both alternatives (proxying through our egress, or storing uploads) mean serving
bytes we hold. Name `referrerPolicy="no-referrer"` on `AvatarImage` as an unshipped follow-up
that would remove the *which page* half.

**Content swap (accepted).** Validation happens once, at write; the bytes served can become
anything afterwards. No input rule prevents this, which is exactly why the answer is
moderation rather than stricter validation. Today the only remedy is a direct
`UPDATE users SET image_override = NULL`; backlog **TS-5** makes it a product surface.

**This borrows the `override_* ?? provider_*` shape, not its `admin_audit` obligation.** That
rule governs an admin correcting someone else's provider data; here the actor is the member
editing their own row, and `users.updated_at` is the record. Worth writing down, because a
literal reading of the engineering rule ("Every override writes `admin_audit`") would
otherwise be raised at every review of this column.

Length is bounded in Zod, not the column (`text`, like `display_name`) — a length bound
doesn't race, so the DB isn't the second line of defence the "constraints encode the rules"
rule is about.

**Revisit if** report volume makes DB-update remediation untenable (promote TS-5), or members
ask for real uploads — a different ADR, about storage, cost, and moderation.
