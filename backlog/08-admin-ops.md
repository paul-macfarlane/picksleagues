# Epic: Admin & Operations (ADM)

Operational tooling for the app admin: job triggers, data corrections, audit. Available in all environments including production. Ref: arch §Manual Sports Data Overrides, D15.

- [ ] **ADM-1** — Admin role via env-var user-ID allowlist + admin page shell: manual job triggers, standings rebuild buttons; simulator controls appear in non-prod only. _(deps: DATA-3, FND-11)_
- [ ] **ADM-2** — Game data overrides (`PUT /admin/games/:id/override`): set/clear score, status, kickoff, spread as `override_*` parallel fields; `override_* ?? provider_*` precedence in serializers + settlement input loader; apply/clear triggers settlement recompute for affected leagues. _(deps: ADM-1, PKM-4)_
- [ ] **ADM-3** — `admin_audit` table recording every override/rebuild (who, what, when, prior value) + audit view on the admin page. _(deps: ADM-2)_
