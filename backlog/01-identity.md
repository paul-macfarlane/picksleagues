# Epic: Identity (ID)

Username claim, profile management, and the onboarding flow. Ref: spec §Users & Identity; arch §Domain Model notes.

- [ ] **ID-1** — Username claim at first sign-in: validation rules (3–20, `a-z0-9_`, case-insensitive uniqueness) as a shared schema in `packages/schemas`; claim screen in the onboarding flow (OAuth → claim → dashboard), with invite-link return preserved. _(deps: FND-4, FND-11)_
- [ ] **ID-2** — `GET`/`PATCH /me` + profile screen: username change (old name released immediately), editable display name, provider avatar display. _(deps: ID-1)_
- [ ] **ID-3** — Account deletion with anonymization: profile is anonymized in place (username released, display name replaced with a deleted-user placeholder, avatar + OAuth identities/sessions removed) so picks, results, and standings history survive in every league; deletion is blocked while the user is the last commissioner of any non-empty active league until they promote another commissioner (same ≥1-commissioner guard as leaving, LG-8; ADR-0004). Spec §Users & Identity has no deletion rules yet — add them as part of this task. _(deps: ID-2, LG-6)_
