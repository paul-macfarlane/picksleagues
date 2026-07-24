# Epic: Launch (LNCH)

Everything between "works on staging" and "friends are using it for the NFL season." Flesh out acceptance criteria when this epic starts. Ref: spec §Screens, §Data Freshness; arch §Background Jobs.

- [ ] **LNCH-1** — Rules guide: static in-app pages (MD/MDX), one per game mode, matching spec rules exactly; linked from league pages and pick entry. _(deps: FND-1)_
- [ ] **LNCH-2** — UI conventions sweep: all timestamps in the user's local timezone, "last updated" on standings pages, no real-time claims. _(deps: PKM-6)_
- [ ] **LNCH-3** — cron-job.org production schedules for all jobs (sync-schedule daily, sync-odds 3×/day, sync-scores 5-min, settle-sweep nightly; sync-bracket added with MM) + `docs/runbooks/` entry for cron setup and secret rotation. _(deps: DATA-4, DATA-5, DATA-6, PKM-4, FND-9)_
- [ ] **LNCH-4** — Mobile-first QA pass across all screens at phone width. _(deps: PKM-6, ELM-4)_
- [ ] **LNCH-5** — Production launch: env vars + OAuth verified in prod, Neon primary migrated, first real leagues created, monitoring/alerting confirmed live. _(deps: LNCH-3, ADM-2)_
- [~] **LNCH-6** — Dark mode: light/dark/system theme toggle with persisted preference; sweep every screen in both themes to verify the token system holds (no hard-coded colors slipped through). _(deps: FND-1)_ _(toggle + persistence shipped early in feedback round 3; the every-screen both-themes sweep remains)_
- [ ] **LNCH-7** — Branding: app logo + favicon/social images, applied across the SPA (header, auth screens, meta tags). Design direction to explore: a "P" in the paulitakes font with an added "i" whose dot is a checkmark — an idea, not a commitment; iterate if it doesn't work. _(deps: FND-1)_
