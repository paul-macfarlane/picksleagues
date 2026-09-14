# 0051. Technical league-season discovery for monitoring

- **Status:** Accepted
- **Date:** 2026-09-14
- **Related:** AGENT-4; ADR-0049–0050; architecture.md §Engineering agent diagnostics (inventory extended); [approved monitoring design](https://app.notion.com/p/3dbc4dbb62178194a44fd59fda09304f)

## Context

A configured league list silently misses newly created leagues and season rollovers. The owner approved automatic discovery with optional runner exclusions, including concluded leagues so premature conclusion cannot hide a scoring problem.

## Decision

Add authenticated GET `/api/agent/v1/league-seasons`. Require a sport-season UUID, normally obtained from `/system`; retain that UUID across pages so season rollover cannot change the scope midway. Return only league-season UUID, game mode and lifecycle status for NFL Pick’em/Survivor. Do not filter by active status, membership, visibility or presence of picks. Use ascending UUID keyset pagination, default 50 and maximum 100 rows, with one lookahead row to establish `nextCursor`. A missing, empty or unsupported sport season returns an empty page. Explicit historical NFL season IDs are supported for later correction investigations.

## Consequences

The token now permits technical target enumeration, extending ADR-0049’s known-target-only discovery model without exposing names, members, picks or settings. This is an allowlist change approved for monitoring, not a generic query surface. Each page is one bounded SELECT; no count query, new index, migration, provider call or scoring replay is added. Pagination is not a cross-request snapshot: new random UUIDs below a saved cursor are found on the next complete sweep; consumers must restart discovery periodically. Exclusions, persistence, scheduling and request budgets belong to the future runner. Member rules remain unchanged.
