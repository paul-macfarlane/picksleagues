# 0039. Public routes are prerendered at build

- **Status:** Accepted
- **Date:** 2026-08-11
- **Related:** architecture.md D1 (amended here), backlog LNCH-13, LNCH-14, ADR-0038

## Context

Google rejected the app's OAuth branding with "your home page does not explain
the purpose of your app." The cause was structural, not editorial: every URL —
`/welcome`, `/privacy`, `/terms`, `/rules/*` — returned the same 3.6 KB shell
whose body is one empty `<div id="root">`. The reviewer's fetcher does not run
the SPA, so the home page genuinely had no text and no privacy-policy link.

D1 anticipated the opposite of this. It rejected Next.js partly because "Picks
Leagues is a logged-in app with no SEO surface, so SSR buys nothing" — true of
the product itself, and false of the handful of pages that exist precisely to
be read by someone who has not signed in. Verification is the forcing case, but
the rules guides have the same problem for search.

Options considered:

1. **Adopt SSR for the app** — reverses D1 wholesale for six static prose pages,
   and puts a rendering server in front of a product whose every other screen
   needs a session.
2. **A `<noscript>` pitch in `index.html`** — cheapest, but it ships on every
   route including the authed app, and it asks an automated reviewer to credit
   markup written for the absence of the thing the page depends on.
3. **Prerender the public routes at build** ✅

Prerendering was initially scoped around an assumption that turned out to be
wrong — that the real route tree could not render under Node, because
`StaticPage` reads a session and `welcome`'s `beforeLoad` fetches one. A probe
showed the tree renders fine; only the auth client fails, and only because it
resolves its base URL from `window.location.origin`. Aliasing that one module
to a signed-out stub removed the need to restructure any component.

## Decision

Public routes are rendered to static HTML during the web build (a Vite SSR build
of `apps/web/prerender`, run by `pnpm --filter @picksleagues/web build`). Each
document is the built `index.html` with its head tags swapped and the route's
markup inside the mount point, so a crawler reads the page and a member boots
the same SPA from the same hashed assets. React replaces that markup on mount
rather than hydrating it.

`apps/web/prerender/routes.ts` is the single list of prerendered paths and their
head tags, and is also the source for the Build Output routes that serve them
and for `/sitemap.xml`.

**`/` is deliberately excluded** (owner, 2026-08-11). `/welcome` is the URL
registered with Google; serving marketing markup at `/` would flash it at
signed-in members before React swapped in their dashboard.

**D1 is amended, not reversed.** The SPA-plus-API shape stands; what changes is
D1's claim that there is no SEO surface. There is one, it is small and entirely
static, and it is served by a build step rather than a server.

## Consequences

A public page is now crawlable and unfurls under its own title and canonical
URL. Adding one means adding it to `routes.ts` — one edit that makes it
prerendered, routed, and listed in the sitemap. Forgetting is the failure mode:
a new public route silently keeps serving the empty shell.

Three couplings are now load-bearing and are asserted at build time rather than
trusted, because every one of them fails silently — the page still renders, just
without its content:

- `apps/web/index.html`'s tag spellings, shared with the invite unfurl
  (ADR-0038). Both consumers go through `packages/html-shell` so a rename
  breaks one place.
- The mount point being an empty `<div id="root"></div>`.
- Each route actually rendering its content. A route that redirects or throws
  still *renders* — as an error boundary, roughly 80 characters of "Something
  went wrong!" — so the build enforces a floor on rendered prose. This caught
  `/welcome` during development.

CI now builds the web app so those assertions fail a pull request rather than a
Vercel deploy.

The prerendered document is served to everyone, so it can only ever hold the
signed-out view: a signed-in member briefly sees the visitor header on a static
page before React swaps in the app header. Accepted — the alternative is either
no prerendering or a per-session document, and this surface is six static pages.

Client-side navigation does not update the document title; a page's head tags
are correct as served and stale after an in-app navigation. Unchanged from
before this work, when every route shared one title. Fixing it means routing
head management through the router's `HeadContent`, which would require removing
the static tags from `index.html` — the ones the invite unfurl rewrites.

Revisit if the product grows a genuinely dynamic public surface (public league
pages, shareable standings). Those need per-request rendering, and this build
step would be the wrong shape for them.
