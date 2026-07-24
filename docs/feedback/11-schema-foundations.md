# Feedback: Schema Foundations epic (SF)

Rounds of human feedback during the Schema Foundations epic. Conventions in
`docs/feedback/README.md`.

## Round 1 — PR #11 review (2026-07-23)

3 items.

| Item | Resolution |
| --- | --- |
| Teams need city + light/dark logos | New `fetchNflTeams` provider method against ESPN's teams listing (rel-filtered default/dark, scoreboard variants excluded); nullable `location`/`logo_light_url`/`logo_dark_url` columns (migration 0011); idempotent enrich step beside the team upsert, fetched once per run; TBD placeholders keep nulls. Live-verified: 32 teams enriched, rerun no-op (`99fec30`) |
| "Browse public leagues" in switcher redundant with Discover | Removed from the switcher's empty state; Discover in the nav is canonical (`6a00c84`) |
| Sticky navbar | Header sticks at `z-40` with solid background — under every portaled overlay (all `z-50`), above content (`6a00c84`) |
