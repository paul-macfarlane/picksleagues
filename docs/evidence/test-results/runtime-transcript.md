# Runtime evidence — commissioner windows

Captured 2026-08-06 against the integrated commit on
`feat/lg-10-commissioner-windows`, driven through the repository's e2e stack
(SPA :5273 → API :3100 → Postgres `picksleagues_e2e`, `SimulatedProvider`, no
network mocks) at phone width 375×812.

The driver was a temporary spec, deleted after capture: enablement is
presentation policy and the engineering rules keep it out of the permanent
suites. The merge gate in `merge-gate/e2e.txt` was then re-run without it.

## Fixture

Seeded 2099 NFL season with one week-1 game (`e2e/setup/league-seed.ts`), so the
league's derived `startsAt` is `2099-09-12T17:00:00.000Z` and the league is
genuinely pre-start under real time. Two minted sessions (commissioner +
joiner) plus an admin session to drive `/api/sim/clock`. Time moved **only**
via `POST /api/sim/clock`, never by editing kickoffs. Cleanup: sim reset with
`scope: "environment"`, `cleanupFutureSeason()`, and `cleanup([userIds])`.

## Criteria

| # | Result | Evidence |
|---|---|---|
| AC-1 | PASS | `lg-10-prestart/` — name, visibility, max members, mode fields, Save, Kick, Leave, Promote, Delete all enabled; expectation copy in future tense |
| AC-2 | PASS | `lg-10-poststart/` — visibility/max-members/mode fields disabled with the locked reason; Delete disabled + reason; Kick disabled + card note; Leave disabled + reason |
| AC-3 | PASS | `lg-10-anytime/` — Promote/Demote enabled, invites enabled, name-only save succeeded and the API read back the new name |
| AC-4 | PASS | transcript below — disabled states derived from the simulated instant while the browser sat at real time |
| AC-5 | PASS | transcript below — all four mutations still refuse with `409 league_started` |

## AC-4 — the window is the server's clock, not the browser's

```
AC-4 simulated now    = 2099-09-12T17:01:00.000Z
AC-4 browser wall now = 2026-08-06T19:56:03.717Z
```

73 years apart. Every disabled state in `lg-10-poststart/` was rendered against
the first value.

## AC-5 — server enforcement unchanged

```
{
  "PATCH visibility":          { "status": 409, "error": "league_started" },
  "DELETE member (kick)":      { "status": 409, "error": "league_started" },
  "DELETE members/me (leave)": { "status": 409, "error": "league_started" },
  "DELETE league":             { "status": 409, "error": "league_started" }
}
```

## Driver result

```
12 passed (10.7s)
```
