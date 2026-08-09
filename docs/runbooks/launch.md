# Runbook: Production Launch (LNCH-5)

The checklist between "staging works" and "friends are playing on
www.picksleagues.com". Every step here is **human-executed** — it needs the Vercel /
Neon / Google / Discord / cron-job.org consoles, which no agent session touches
(engineering guardrails). Check items off in order; each names its verification.

## 1. Environments and secrets

Per `docs/runbooks/environments.md` (FND-9):

- [ ] Vercel Production env vars set: `DATABASE_URL` (Neon **primary** branch),
      `BETTER_AUTH_SECRET` (unique to prod), `BETTER_AUTH_URL=https://www.picksleagues.com`,
      `JOB_SECRET` (unique to prod), `APP_ENV=production`, prod OAuth client IDs/secrets.
      `SIM_ENABLED` **unset** — ADR-0011/ADR-0014: sim routes must not register in prod.
- [ ] Neon primary migrated: `pnpm --filter @picksleagues/db drizzle-kit migrate` against
      the primary branch URL (the guard hook prompts on a non-localhost `DATABASE_URL` —
      that prompt is the point; a human runs this).
- [ ] Domain: `www.picksleagues.com` assigned to the Production deployment;
      `picksleagues.com` → `www` redirect.

## 2. OAuth

- [ ] Google OAuth client (production): authorized redirect URI exactly
      `https://www.picksleagues.com/api/auth/callback/google`; publishing status
      **In production** (not Testing, which expires refresh tokens and caps users).
- [ ] Discord application (production): redirect
      `https://www.picksleagues.com/api/auth/callback/discord`.
- [ ] Verify: sign in on the prod domain with each provider, land on claim-username,
      claim, reach the dashboard. (Two accounts or two browsers proves both providers.)

## 3. Data and jobs

- [ ] Seed the season: `POST /api/jobs/nfl/sync-schedule` against prod with the prod
      `x-job-secret` (manual first run, `docs/runbooks/jobs.md` §Manual triggering);
      confirm the response counters and that the admin Games browser shows the slate.
- [ ] `POST /api/jobs/nfl/sync-odds` once; spot-check spreads on a few games.
- [ ] Create the four cron-job.org schedules per `docs/runbooks/jobs.md`
      §cron-job.org configuration (URLs, POST, `x-job-secret` header, UTC patterns).
- [ ] Enable **Notify on failure** on all four — this is the alerting (ADR-0007).
- [ ] Verify: cron-job.org execution history shows a green run of each job.

## 4. Admin

- [ ] Grant your own account the admin role — direct SQL against the primary
      (ADR-0013; no env-var allowlist): `UPDATE users SET app_role = 'admin' WHERE id = '<your user id>';`
- [ ] Verify: the Admin nav entry appears and `/admin` renders; confirm a
      **non**-admin account sees neither.

## 5. Smoke on prod

- [ ] Signed-out `https://www.picksleagues.com/` lands on the splash; Terms/Privacy/rules
      pages render; favicon and social unfurl look right (paste the URL in a Discord
      message to check the OG image).
- [ ] Create a real league in each NFL mode, invite a second account via link, join,
      submit a pick in each mode at phone width.
- [ ] After the first real game weekend: standings show results and a "Last updated"
      stamp; cron-job.org history stayed green through the Sunday load.

## 6. Rollback stance

Deploys roll back from the Vercel dashboard (previous deployment → Promote). The
database migrates forward-only — no destructive migration ships in this repo without its
own plan — so a code rollback never needs a data rollback. Neon's point-in-time restore
is the disaster path, not the deploy path.

When every box above is checked, tick LNCH-5 in `backlog/09-launch.md` and the epic is
done.
