# Epic: Identity (ID)

Username claim, profile management, and the onboarding flow. Ref: spec §Users & Identity; arch §Domain Model notes.

- [ ] **ID-1** — Username claim at first sign-in: validation rules (3–20, `a-z0-9_`, case-insensitive uniqueness) as a shared schema in `packages/schemas`; claim screen in the onboarding flow (OAuth → claim → dashboard), with invite-link return preserved. _(deps: FND-4, FND-11)_
- [ ] **ID-2** — `GET`/`PATCH /me` + profile screen: username change (old name released immediately), editable display name, provider avatar display. _(deps: ID-1)_
