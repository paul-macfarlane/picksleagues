# 0004. Multi-commissioner leagues; no mid-season leaving

- **Status:** Accepted
- **Date:** 2026-07-21
- **Related:** mvp-spec.md §Users & Identity (Limits), §Membership, §Commissioner Powers; architecture.md §Domain Model, §API Surface; backlog LG-1, LG-2, LG-6, LG-8, ID-3

## Context

Backlogging account deletion (ID-3) and leave-league (LG-8) surfaced a shared guard: a league must never lose its last commissioner. The v0.3 spec allowed exactly one commissioner per league with a transfer power, which makes that guard awkward (every departure forces a full handoff) and there was no product reason for the single-commissioner restriction. Separately, the spec froze post-start membership for kicks/deletes but never said whether members could leave.

## Decision

- A league has **one or more commissioners**, all with identical powers. `league_members.role` is the sole source of commissionership; `leagues.commissioner_id` is dropped from the domain model.
- Any commissioner may **promote** a member (subject to the recipient's 10-active-league cap, enforced at create + promote) or **demote** a commissioner, including stepping down. The dedicated transfer power is removed — transfer = promote + self-demote.
- **Invariant:** every league has ≥1 commissioner at all times. Any demotion, kick, leave, or account deletion that would violate it is blocked until another commissioner is promoted.
- **No mid-season leaving:** leaving a league is pre-start only, extending the existing post-start membership freeze. Account deletion remains possible anytime because it anonymizes the profile in place (ID-3) — the member row and history survive, so the freeze is not breached.

## Consequences

- Deletion/leave guards reduce to one invariant check instead of forced-transfer flows; commissioners get redundancy (a co-commissioner can act if one is absent).
- Demote applies to any commissioner, not just self — commissioner disputes resolve socially, consistent with the spec's post-start stance.
- Cap enforcement now also runs at the promote endpoint; standings/membership never shrink mid-season, keeping settlement inputs stable.
- Spec and architecture docs amended in place (sections marked ADR-0004); revisit if leagues ever need per-commissioner permission tiers.
