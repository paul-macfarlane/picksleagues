# Epic: Leagues (LG)

League lifecycle, membership, invites, discovery, and commissioner powers — the mode-agnostic core. Ref: spec §Leagues; arch §Invites, §Domain Model, §API Surface.

- [ ] **LG-1** — Drizzle schema: `leagues` (mode, visibility, status, commissioner), `league_settings` (JSONB validated by per-mode Zod schema, typed via `$type<>`), `league_members`, `league_invites`. _(deps: FND-2)_
- [ ] **LG-2** — League creation flow (mode → name → visibility → mode settings → pre-start league) with the 10-active-commissioner cap enforced in-transaction. _(deps: LG-1, ID-1)_
- [ ] **LG-3** — Invites: generate/revoke links with opaque codes, optional expiry + max-use; `/join/:code` with signed-out → auth → back-to-join round-trip. _(deps: LG-2)_
- [ ] **LG-4** — Membership rules at the join endpoint: 2–100 size, one membership per user, clock-derived join cutoff (first week started / Round of 64 tipped). _(deps: LG-3, DATA-4, FND-6)_
- [ ] **LG-5** — Public discovery: browse page of public pre-cutoff leagues + name search (`GET /discovery`). _(deps: LG-2)_
- [ ] **LG-6** — Commissioner powers with pre-start/post-start windows: settings + kick + delete pre-start only, cosmetics + transfer anytime (recipient cap checked). _(deps: LG-2)_
- [ ] **LG-7** — Dashboard (my leagues with pick-status at a glance) + league home shell (members, info, commissioner tools; standings slot filled per mode later). _(deps: LG-2)_
