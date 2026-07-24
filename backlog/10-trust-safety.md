# Epic: Trust & Safety (TS)

Post-MVP unless promoted: abuse-resistance for public leagues and the member-facing
notifications that make moderation legible. Motivated by kick-abuse risk in public
leagues (commissioners can remove anyone pre-start with no trace shown to the removed
member). Flesh out acceptance criteria when this epic starts; reconcile with spec/arch
(both locked at v0.3) via ADR before implementing.

- [ ] **TS-1** — Member reporting: a member can report a league/commissioner (e.g. unfair kicks, abusive conduct); reports land somewhere an admin can review (admin page list beats email). _(deps: ADM-1)_
- [ ] **TS-2** — In-app notifications: minimal notification table + bell/list UI; first use case is "you were removed from <league>" with the commissioner's stated reason. _(deps: LG epic)_
- [ ] **TS-3** — Kick requires a reason: commissioner must enter a short explanation to confirm a kick; stored with the membership removal and delivered via TS-2. Accountability lever even before reporting exists. _(deps: TS-2)_
- [ ] **TS-4** — Named single-use commissioner invite: if co-commissioner setup friction becomes real, add an invite bound to a specific invitee that grants commissioner on join — never a role on shareable bearer-link invites (decided in feedback round 3: invite links always join as member; promotion is explicit). _(deps: none)_
