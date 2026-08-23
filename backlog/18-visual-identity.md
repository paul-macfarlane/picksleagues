# Epic: Visual Identity (VIS)

`LNCH-9` gave the app a palette; two weeks of real use say it still reads as a
shadcn app, and the reason is structural — one card surface at every level, a
flat type scale, one orange meaning five things, generic chrome on domain
objects. ADR-0043 records the direction the owner chose (the broadcast
scoreboard: ink band, condensed numerals, orange = yours to act on) and the
five primitives that enforce it. This epic is the delivery, foundation first so
every later task composes from named things rather than restyling by hand.
Every task: both themes, 390px before any wider width, no testid changes, E2E
green. Evidence captures go to `docs/evidence/test-results/<task-id>/`.

- [x] **VIS-1** — Foundation: ink tokens, `--radius` 0.375rem, the Archivo width-axis import, the three type-role utilities (display / heading / eyebrow), `StatusPill` as a caps tag, `Table` headers in the eyebrow role, and orange re-homed off every non-action use (ADR-0043 §1, §3, §4). Adds the three rules to `engineering.md` (surface tiers, type roles, orange = action) and a `docs/design-system.md` reference naming which tier and role to reach for. Acceptance: AA contrast on every token pair in both themes; no new packages; every screen still renders — this PR changes primitives, not layouts. _(deps: none)_
- [x] **VIS-2** — Surface tiers: `Band` and `Section` primitives, then re-classify all 33 `Card` call sites as band / section / panel / row per ADR-0043 §2 so no bordered surface nests in another. Member screens get the full pass (hub, league layout, picks, standings, all picks, members, settings, discovery, profile); admin and sim are re-classified mechanically here and hand-finished in VIS-7. _(deps: VIS-1)_
- [x] **VIS-3** — The signature `MatchupLine` (ADR-0043 §5): one component behind `pickem-game-row`, `survivor-game-row`, `pickem-week-detail`'s `PickRow`, `slate-preview`, and `admin/games-browser` — spread before kickoff and score after it in the same numeral slot, the left rule carrying the state. Must keep the shared vocabulary (`PickOutcomeBadge`, `gameStateLabel`, `pickStandingLabel`) and every testid the Pick'em and Survivor journeys bind to. _(deps: VIS-2)_
- [x] **VIS-4** — The subject band: league header as the screen's one band (name in display caps, mode · season eyebrow, the viewer's rank and record as display numerals), hub league cards with a band strip and the viewer's standing, discovery cards in the same shape. _(deps: VIS-2)_
- [ ] **VIS-5** — The boards: Pick'em standings and the Survivor board with rank as a display numeral, the leader marked, "last updated" as an eyebrow; the week picker and the picks-progress count in the display role. _(deps: VIS-2)_
- [ ] **VIS-6** — Public and auth surfaces in the new voice: welcome, sign-in, claim-username, join, the rules guide pages, terms/privacy, legal footer. The welcome page's hero is a band, and it is the only screen permitted a band with no league in it. _(deps: VIS-4)_
- [ ] **VIS-7** — Admin and simulator hand-pass: browsers as sectioned card-lists, override forms and sync/audit panels on the tiers, the sim cards as panels, the sim-clock banner restyled as a ticker strip (still a warning, still inside the sticky header). _(deps: VIS-3, VIS-5)_
- [ ] **VIS-8** — Coherence audit: scripted capture of every route at 390px and 1024px in both themes; checklist per screen — one band at most, no nested bordered surfaces, every number in a role, pill vocabulary unchanged, orange only on action/selection; fix what fails, and the capture is the epic's evidence. _(deps: VIS-6, VIS-7)_
