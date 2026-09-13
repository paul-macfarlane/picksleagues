# Matchup schedule verification

The shared Schedule segment was checked on September 13, 2026 in Survivor and Pick'em at 390px and 1024px, in light and dark themes. Evidence uses the local `survivor-season` simulator fixture, with week 15 final, week 16 live, and weeks 17–18 upcoming. These four available fixture weeks are the entire ingested season in this scenario; no missing weeks or bye weeks are invented.

Opponents remain visible at phone width, completed and live scores identify both teams, and upcoming kickoffs and the update stamp use the viewer's timezone. The sheet retains a scrollable body and a fixed header. The schedule reads stored games without a stats-ingestion dependency.

The eight review images are published as the seven-day `review-screenshots-pr-154` Actions artifact, linked from PR #154. They are not repository assets; expired screenshots can be regenerated.

Reproduce on the isolated E2E stack:

```sh
SCHEDULE_CAPTURE=1 pnpm test:e2e e2e/capture-schedule.sim.spec.ts --project simulated --no-deps
```

Validation: typecheck, lint, 627 unit tests, six scoped schedule API integration tests, and the opt-in capture pass. The seven schedule unit tests cover ordering, team-relative results, missing scores, live and disrupted fixtures, current-season selection, prior-season fallback, and absent ingestion. API tests cover authentication, missing games, both teams' schedules, corrected scores, cancelled fixtures, and upcoming-season preference. Full E2E and full integration suites were not run for this scoped display/API change.
