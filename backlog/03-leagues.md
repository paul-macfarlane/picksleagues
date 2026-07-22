# Epic: Leagues (LG)

League lifecycle, membership, invites, discovery, and commissioner powers — the mode-agnostic core. Ref: spec §Leagues; arch §Invites, §Domain Model, §API Surface.

- [~] **LG-1** — Drizzle schema: `leagues` (mode, visibility, status), `league_settings` (JSONB validated by per-mode Zod schema, typed via `$type<>`), `league_members` (role carries commissionership — no `commissioner_id` on `leagues`, ADR-0004), `league_invites`. _(deps: FND-2)_
- [ ] **LG-2** — League creation flow (mode → name → visibility → mode settings → pre-start league) with the 10-active-commissioner cap enforced in-transaction. _(deps: LG-1, ID-1)_
- [ ] **LG-3** — Invites: generate/revoke links with opaque codes, optional expiry + max-use; `/join/:code` with signed-out → auth → back-to-join round-trip. _(deps: LG-2)_
- [ ] **LG-4** — Membership rules at the join endpoint: 2–100 size, one membership per user, clock-derived join cutoff (first week started / Round of 64 tipped). _(deps: LG-3, DATA-4, FND-6)_
- [ ] **LG-5** — Public discovery: browse page of public pre-cutoff leagues + name search (`GET /discovery`). _(deps: LG-2)_
- [ ] **LG-6** — Commissioner powers with pre-start/post-start windows: settings + kick + delete pre-start only, cosmetics + promote/demote commissioners anytime (promote cap-checked; ≥1-commissioner invariant, ADR-0004). **Also inherited from ID-3:** wire the last-commissioner guard into account deletion — `deleteAccount` in `apps/api/src/services/users.ts` has a `TODO(LG-6, ADR-0004)` marking where the check runs inside the deletion transaction (block with 409 while the user is the last commissioner of any non-empty active league); shipped unguarded in ID-3 because it's vacuously safe with no league tables. _(deps: LG-2)_
- [ ] **LG-7** — Dashboard (my leagues with pick-status at a glance) + league home shell (members, info, commissioner tools; standings slot filled per mode later). _(deps: LG-2)_
- [ ] **LG-8** — Leave league, pre-start only per spec §Membership (ADR-0004): the last commissioner of a league with other members must promote a replacement first (same ≥1-commissioner guard as account deletion, ID-3); a commissioner who is the only member deletes the league instead. _(deps: LG-6)_
