# 0038. Invite links unfurl with the league's name, from a sessionless read

- **Status:** Accepted
- **Date:** 2026-08-11
- **Related:** ADR-0032 (bare revocable invite codes), mvp-spec.md §Invites, backlog FB-41

## Context

Invite links are how this product actually spreads — a commissioner pastes one
into a group thread. Pasted there, it unfurled as the generic app pitch
("Picks Leagues — Season-long sports leagues with friends"), which reads as an
advert rather than as an invitation from a friend.

A link preview is built by a bot that fetches the URL and reads `<title>` and
`og:*` out of the returned HTML. It never runs the SPA. Every route in this app
falls through to one static `index.html` whose tags are fixed at build time, so
**no per-invite preview is possible without serving `/join/*` its own HTML.**

The bot also has no session. `GET /api/join/{code}` — the existing preview —
requires one, so it cannot be the source.

## Decision

`/join/<code>` is routed to the API function ahead of the SPA fallback. The
function returns **the built SPA shell with four tags rewritten** (`<title>`,
`description`, `og:title`, `og:description`), naming the league, its mode, and
its remaining capacity. The document is otherwise byte-identical, hashed asset
URLs included, so a human following the link boots exactly the same SPA — the
route is not a separate page and must never become one.

Its data comes from `getInviteLinkPreview`, **a read that takes no user id.**

Three consequences of that, all deliberate:

- **It widens what a bare code discloses.** Before this, a code holder had to
  sign in before learning which league they had been invited to; now fetching
  the URL is enough. That is bounded by what a code already is: unguessable,
  revocable, and worth a full membership to anyone holding it (ADR-0032). The
  same thread that can see the unfurl can click the link.
- **A revoked code and a code that never existed unfurl identically** — the
  generic tags. Distinguishing them would answer a question about someone
  else's league to whoever holds a dead link.
- **The read is capped at what an unfurl needs.** Name, mode, member count,
  capacity, start. Not the member list, not standings, not anything a member
  authored.

Path mapping is done in `vercel.ts`, not with a `dest` rewrite in the routing
config: which path the platform hands a function on a rewrite is a contract this
repo cannot test locally, and getting it wrong would 404 every invite link in
production only.

## Consequences

- **It is not locally verifiable.** Vite serves `/join/*` itself in dev, so the
  route only exists in a Vercel build; the shell is absent beside the function
  outside one, and the handler falls back to a minimal tags-only document. The
  proof is a staging deploy and a real paste into a real thread.
- The rewrite is anchored to the tag *attributes*, matched across a whole tag —
  the build reformats long meta tags onto several lines, and a pattern written
  for the source file's one-line spelling silently matched nothing. The unit
  tests run both spellings and assert the old copy is gone, because the failure
  mode here is a page that renders perfectly and says the wrong thing.
- `og:image` stays the app-wide image. A per-league image would mean rendering
  one, which is a different feature.
- One more path served by the function rather than the CDN. Cached for 60s, so
  a thread full of preview bots costs one database read, and the capacity line
  is never more than a minute stale.
