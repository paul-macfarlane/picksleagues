# Epic: Trust & Safety (TS)

**Scrapped (owner, 2026-08-09 — SWP-2, `backlog/15-scope-sweep.md`).** Every item
below solves a stranger-scale problem; among friends and co-workers, disputes
resolve socially (the spec already says so for mid-season conflicts) and the
admin remedy for a bad avatar is the direct database update TS-5 itself names.
Nothing here had been built, so the cut touches no code and no locked doc. If
public discovery ever earns real stranger traffic (see SWP-3), that decision —
not this file — is the place to reopen the question.

Original framing, kept for context: post-MVP abuse-resistance for public
leagues and the member-facing notifications that make moderation legible,
motivated by kick-abuse risk in public leagues (commissioners can remove anyone
pre-start with no trace shown to the removed member).

- [ ] **TS-1** — Member reporting: a member can report a league/commissioner (e.g. unfair kicks, abusive conduct); reports land somewhere an admin can review (admin page list beats email). _(deps: ADM-1)_ _(wontfix)_
- [ ] **TS-2** — In-app notifications: minimal notification table + bell/list UI; first use case is "you were removed from <league>" with the commissioner's stated reason. _(deps: LG epic)_ _(wontfix)_
- [ ] **TS-3** — Kick requires a reason: commissioner must enter a short explanation to confirm a kick; stored with the membership removal and delivered via TS-2. Accountability lever even before reporting exists. _(deps: TS-2)_ _(wontfix)_
- [ ] **TS-4** — Named single-use commissioner invite: if co-commissioner setup friction becomes real, add an invite bound to a specific invitee that grants commissioner on join — never a role on shareable bearer-link invites (decided in feedback round 3: invite links always join as member; promotion is explicit). _(deps: none)_ _(wontfix)_
- [ ] **TS-5** — Member-set avatar moderation: report a member's avatar, plus an admin remedy that clears `users.image_override` from the admin surface. ADR-0022 shipped member-set avatar URLs accepting that validation happens once at write (the bytes at the URL can change afterwards) and that a member-chosen host sees every viewer's IP — the answer to both is report-and-remove, not stricter input rules. Today the only remedy is a direct database update, which at this scale is also the accepted permanent answer. _(deps: ADM-1, TS-1)_ _(wontfix)_
