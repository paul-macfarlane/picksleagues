# Epic: Launch (LNCH)

Everything between "works on staging" and "friends are using it for the NFL season." Flesh out acceptance criteria when this epic starts. Ref: spec §Screens, §Data Freshness; arch §Background Jobs.

- [ ] **LNCH-1** — Rules guide: static in-app pages (MD/MDX), one per game mode, matching spec rules exactly; linked from league pages and pick entry. _(deps: FND-1)_
- [ ] **LNCH-2** — UI conventions sweep: all timestamps in the user's local timezone, "last updated" on standings pages, no real-time claims. _(deps: PKM-6)_
- [ ] **LNCH-3** — cron-job.org production schedules for all jobs (sync-schedule daily, sync-odds 3×/day, sync-scores 5-min, settle-sweep nightly; sync-bracket added with MM) + `docs/runbooks/` entry for cron setup and secret rotation. _(deps: DATA-4, DATA-5, DATA-6, PKM-4, FND-9)_
- [ ] **LNCH-4** — Mobile-first QA pass across all screens at phone width. _(deps: PKM-6, ELM-4)_
- [ ] **LNCH-5** — Production launch: env vars + OAuth verified in prod, Neon primary migrated, first real leagues created, monitoring/alerting confirmed live. _(deps: LNCH-3, ADM-2)_
