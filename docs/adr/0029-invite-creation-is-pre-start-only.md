# 0029. Invite creation closes at league start; revocation stays open

- **Status:** Accepted
- **Date:** 2026-08-09
- **Related:** `docs/mvp-spec.md` §Invites, §Membership (join cutoff), §Commissioner Powers
  (the table row this ADR splits); `docs/architecture.md` §Invites;
  [0004](0004-multi-commissioner-leagues.md) (commissionership as a membership role, the
  matrix's role axis); [0020](0020-season-range-presets.md) (the mid-week creation window a
  league starts into); backlog LG-13

## Context

Spec v0.3 §Commissioner Powers grants "Generate/revoke invite links" **Anytime**, with the
parenthetical "(joins still blocked after cutoff)". That parenthetical is the problem: the
join endpoint derives its cutoff from `leagueStartAt` and refuses with `join_closed` once the
league's first game has kicked off, so an invite minted after the start is born unusable. The
commissioner gets a link, shares it, and the recipient hits a wall — which reads as a product
that lost the invite rather than one that deliberately closed the door.

Nothing is unsafe about the current behaviour; membership is enforced at the join, not at the
mint. What is wrong is where the refusal surfaces. It lands on the *invitee*, who has no
context and no recourse, instead of on the commissioner, who has both.

The obvious fix — flip `MANAGE_INVITES` to `preStartOnly: true` in the LEAGUE_ACTION matrix —
is wrong, because that one action covers three endpoints. Listing and revoking must outlive
the start: a link minted legitimately during the pre-start window is still live afterwards
(invite status is derived from expiry/use-count/revocation, never from the league's start), so
a leaked or over-shared code has to remain killable for as long as it exists. Closing
revocation at the start would take away the only tool for the one failure the invite system
can actually produce.

## Decision

**Split `MANAGE_INVITES` into two actions on the LEAGUE_ACTION matrix**, rather than giving
the existing one a window:

| Action | Endpoints | Rule |
| --- | --- | --- |
| `CREATE_INVITE` | `POST /leagues/{id}/invites` | commissioner, **pre-start only** |
| `MANAGE_INVITES` | `GET /leagues/{id}/invites`, `DELETE /leagues/{id}/invites/{code}` | commissioner, **anytime** |

`CREATE_INVITE`'s window is the same `leagueStartAt` boundary the join cutoff already uses, so
the two refusals can never disagree about when the door closed. A post-start create returns
**409 `league_started`** — the same wire code as a post-start kick or delete, because it is the
same window closing.

The check is deliberately **not** wrapped in a transaction. The boundary is a wall-clock
instant, so a transaction could not stop it passing mid-request, and an invite that slipped
through is inert: the join endpoint re-derives the same cutoff and refuses. The check is a
better-placed refusal, not a new invariant.

The SPA keeps the Invites panel mounted post-start (its gate is the anytime `MANAGE_INVITES`)
and disables only the New invite form, with an inline reason — the LG-10 pattern of a control
that explains its own unavailability rather than failing on submit.

## Consequences

The commissioner learns the door is closed at the moment they would otherwise mint a dead
link, and the invitee never sees a refusal that isn't theirs to fix. Revocation is untouched,
so the leaked-link path keeps working for the whole life of the link.

`docs/mvp-spec.md` §Commissioner Powers and §Invites are amended in the same change — the
single-row "Generate/revoke invite links | Anytime" becomes two rows, and §Invites states the
window on generation. This is a deviation from the locked v0.3 spec, recorded here and
reconciled there; `docs/architecture.md` §Invites needed no change, since it already describes
the cutoff as query-time-derived without claiming a window for generation.

The cost is a second invite capability to keep straight. The mitigation is that both live in
one matrix (`packages/schemas/src/league-actions.ts`) whose table test pins every row against
the spec with raw literals, so a future edit to either window fails loudly rather than drifting.

Revisit if invites ever gain a use the join cutoff doesn't govern — a post-start "spectator"
or read-only link would need its own action rather than reopening this one.
