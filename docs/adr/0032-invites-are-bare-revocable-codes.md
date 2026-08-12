# 0032. Invite links are bare revocable codes; expiry and max-use caps removed

- **Status:** Accepted
- **Date:** 2026-08-09
- **Related:** [0029](0029-invite-creation-is-pre-start-only.md) (creation
  window and revocation — unchanged, and the answer to the leak case this
  leans on); `docs/mvp-spec.md` §Invites; backlog SWP-4
  (`backlog/15-scope-sweep.md`)

## Context

Invites shipped with two optional knobs — an expiry instant and a max-use cap
— each carrying a form field, a column, a derived status (`expired` /
`exhausted`), a join-refusal reason with copy on two surfaces, and enforcement
logic (the clock comparison; a guarded use-count increment predicated on
`use_count < max_uses` so the cap couldn't be raced past).

The 2026-08-09 scope sweep (SWP-4) asked who turns those knobs. Nobody
handing a link to friends sets an expiry or a use cap; the case they exist
for — a link escaping to strangers — was already answered by revocation,
which ADR-0029 deliberately kept available anytime, and by the join cutoff,
which closes every link at league start regardless. Two knobs the audience
won't turn cost a form, two columns, two statuses, and enforcement branches
on the hottest join path.

## Decision

**An invite is a bare opaque code.** Creation takes no options — the POST
has no request body at all, so a stale client still sending
`expiresAt`/`maxUses` is ignored rather than refused. Revocation is the only
lifecycle: `INVITE_STATUS` collapses to `active | revoked`, and
`invite_expired` / `invite_exhausted` leave the join-refusal vocabulary.

The `expires_at` and `max_uses` columns are dropped (migration 0027). Any
expiry or cap on an existing link silently stops applying — the link becomes
a bare revocable code like every new one, which is the cut's intent (owner,
2026-08-09; there are no active leagues, so in practice nothing changes).

**`use_count` stays, as information.** The commissioner panel's "Uses"
readout keeps it, and the join transaction keeps incrementing it through the
guarded UPDATE (`revoked_at IS NULL`) — the guard now serializes joins
against a concurrent revocation rather than enforcing a cap, so a revocation
that lands mid-join turns the join away instead of slipping through.

ADR-0029 is untouched: creation stays pre-start-only, revocation stays open
anytime, and both keep being the whole of an invite's lifecycle story.

## Consequences

- The join path loses two refusal branches and their copy; the invite panel
  loses its two-field form (one button mints a link); the derived-status
  home (`inviteStatus`) collapses to a null check but stays the single named
  answer to "is this invite usable".
- **Lost: time-boxed and n-use links.** A commissioner who wants a link dead
  revokes it — one action, already shipped, and the only one this audience
  was ever going to use. Restorable by re-adding the columns and the guarded
  predicate if a real league asks, which would reopen this ADR.
- The drop-columns migration is irreversible in place (the values are gone),
  accepted at zero active leagues.
