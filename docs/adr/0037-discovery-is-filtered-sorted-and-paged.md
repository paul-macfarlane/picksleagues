# 0037. Discovery is filtered, sorted by remaining space, and paged

- **Status:** Accepted
- **Date:** 2026-08-11
- **Related:** mvp-spec.md §Public Discovery, backlog FB-35/FB-36/FB-37/FB-39

## Context

Spec §Public Discovery (locked v0.3) specified a deliberately plain browse
page: name, mode, member count, start, a join button, and — explicitly — "no
filters, categories, or recommendations." The restraint was right at the time:
the alternative was inventing a recommendation surface for a product with no
users.

Real use found three things it costs, none of which are recommendations:

1. **A member joins blind.** A card names the mode but not the settings, so
   nobody can tell an ATS league from a straight-up one, or a 3-picks-a-week
   league from a 16-, until after they are in it. Those two settings are what
   the league asks of them every week.
2. **Mode is the primary filter and had no affordance.** The one attribute that
   decides whether a member wants a league at all was rendered at caption
   weight, and a member browsing for a Survivor league had to read every card.
3. **The list was unbounded and ordered newest-first.** Newest-first actively
   works against filling leagues: a league two members short of playing sinks
   below every empty one created since.

The spec's "no filters" clause was aimed at *categories and recommendations* —
editorial surface with taste in it. A mode filter is none of that: it is the
enum the list is already keyed by.

## Decision

Amend spec §Public Discovery. Discovery serves:

- **A per-mode settings summary** on each entry — Pick'em's pick type and picks
  per week. A *chosen summary*, never the stored settings blob: this DTO is
  served to non-members, so anything on it is public by construction. Survivor
  carries none because it has no member-facing configurable setting; March
  Madness gets its own when the mode ships.
- **A mode filter**, server-side, alongside the existing name search.
- **Default ordering by remaining space, fullest-first**, with creation order
  (then id) as the tiebreak so the order is total — an order with ties has no
  defined sequence, and under paging that is a league appearing on two pages or
  on none.
- **Pagination at 10 per page**, server-side.

Filtering, ordering, and paging all run **after** the candidate rows are read,
and the page is cut from the fully filtered set. Joinability depends on
`leagueStartAt` — a per-mode, override-aware derivation over the league's own
start week — and pushing that into SQL means a second copy of it that drifts
from the one every other surface uses. Cutting the SQL instead and letting the
app-level filters punch holes in the page would produce short pages and a
dishonest total.

## Consequences

- Every discovery request reads all candidate rows. Bounded by this product's
  audience (friends-scale, dozens of public leagues — the same bound FB-2's
  performance audit was written against), and the cost is a filter pass over
  rows already in memory.
- If public leagues ever reach the thousands, the fix is named: push the start
  derivation into the query as a lateral join. Not slicing the SQL underneath
  app-level filters.
- Public discovery and the invite preview no longer show the same fields. The
  two shapes were deliberately aligned (`JoinPreviewResponse` "mirrors what a
  public discovery entry shows"); an invitee is arguably just as blind and may
  want the same summary, but that is a separate change and this ADR is the
  record that the mirror was broken knowingly.
- "No filters, categories, or recommendations" narrows to what it was defending:
  no editorial surface. A filter over an enum the data already carries is not
  that, and a future one (e.g. by season year) doesn't need a new ADR.
