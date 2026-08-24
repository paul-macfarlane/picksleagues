# 0044. Score freshness is ~15 minutes, not ~5

- **Status:** Accepted
- **Date:** 2026-08-23
- **Related:** mvp-spec.md §MVP Scope at a Glance, §Core User Flows, §Data Freshness & Expectations; architecture.md §Design Constraints, §Background Jobs, D7, D10; `docs/runbooks/jobs.md`; `docs/sweeps/ALN-3-spec-vs-app.md` row P1 (ALN-4 verdict, owner, 2026-08-23)

## Context

Both locked docs promise scores and standings that refresh "approximately every
5 minutes during game days", and D10 uses that target to justify the polled
design. Production has never run that cadence: at launch (commit `27bdbb1`,
2026-08-09) `nfl-sync-scores` was configured on cron-job.org at every 15
minutes, and only the runbook's cadence table was updated — no ADR, no spec
amendment, and the runbook's own `JOB_SECRET` rotation step kept saying "≤5
minutes". The ALN-3 spec-vs-app sweep surfaced the divergence as its headline
finding: a user-facing promise the configured system is 3× off.

Nothing in code encodes a cadence — the job is an idempotent HTTP endpoint and
would serve either schedule unchanged — so the question is purely which promise
to make. At friends scale (<50 users), a 15-minute window between a game going
final and standings moving has drawn no complaints through a real launch, and
the owner is deliberately frugal with third-party quota and attention surface.

## Decision

~15 minutes is the freshness promise. The cron-job.org schedule stays
`*/15 * * * *`; the spec, architecture, and runbook all state ~15 minutes, and
the UI's existing posture (a "last updated" stamp, never a realtime claim) is
unchanged. D10's polled-plus-nightly-sweep design is unaffected — the target it
was chosen against was an upper bound on acceptable staleness, and 15 minutes
still clears the bar nightly-only could not.

## Consequences

- Standings, pick outcomes, and eliminations can lag a final by up to ~15
  minutes; the provisional in-progress readings age on the same cadence. The
  "as of" and "last updated" stamps carry that honestly, as they always did.
- The docs stop promising a number production doesn't run, which was the actual
  harm — the cadence itself was never the problem.
- Tightening back to 5 minutes (or a game-day split schedule) is a
  cron-job.org edit plus a docs pass, nothing more; a real user complaint about
  staleness is the trigger for revisiting.
