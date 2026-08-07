# Manual UI drive — Audit tab

Driven 2026-08-07 against the integrated branch at `d2b0d40`, phone width
(390×844), Chromium via Playwright.

## Stack and fixture

The drive ran against a **throwaway database** (`picksleagues_adm3_drive`,
created and dropped inside the run) rather than the dev database, so no dev data
was read or written, and against inline environment values rather than a
`.env` file — the live secret file was never read or copied.

Fixture: one admin (`Ada Admin` / `@ada_admin`), one Pick'em league
("Sunday Sharps", 2026) with two members and three games — one settled a week
ago, one spare, and one carrying a **provider-bug anomaly** (final 31–28 written
against a kickoff still two days out, no admin involved).

Audit rows were then created through the real API, not seeded: one
`POST /admin/leagues/{id}/rebuild` and 28 `PUT /admin/games/{id}/override`
calls, giving 29 rows — deliberately more than one 25-row page.

## What the page rendered (page 1)

Accessibility tree, trimmed to the parts under test:

```
navigation "Admin sections": Jobs | Seasons | Games | Teams | Audit
"Data integrity"
  "Games whose kickoff is still ahead while their status or score already
   gives the outcome away — members can still pick them. Open the week and
   correct the kickoff or the result."
  listitem:
    "AWY @ HOM"
    "Kickoff 8/9/26, 11:23 AM · Final 28–31"
    link "Open AWY @ HOM in the games browser" -> /admin/games?weekId=b56c74b5-…
"Audit log"
  table columnheaders: When | Admin | Action | Target | Prior value
  25 rows, each: "8/7/26, 11:24 AM" | "Ada Admin" | "Game override" |
                 "AWY @ HOM / Game" | disclosure "Show"
  "Showing 1–25 of 29"
  button "Previous" [disabled]   button "Next"
```

The integrity card renders **above** the log, timestamps are absolute
(`8/7/26, 11:24 AM`), the actor renders through `UserIdentity`, and the repair
link carries the anomalous game's own `weekId`.

## Pager (AC5b)

| Step | Observed |
|---|---|
| Click **Next** | URL `→ /admin/audit?offset=25`; range `Showing 26–29 of 29`; Previous enabled, **Next disabled**; 4 data rows |
| Oldest row on page 2 | action `League rebuild`, target `Sunday Sharps 2026` / `League season` — the rebuild audit and its league-season label |
| Expand that row's prior value | `{ "resultCount": 2, "lastSettledAt": "2026-08-07T15:23:49.858Z", "standingsRowCount": 4, "lastStandingsUpdatedAt": "2026-08-07T15:23:49.858Z" }` |
| **Reload** on page 2 | stays on `?offset=25`, `Showing 26–29 of 29` |
| Browser **Back** | `→ /admin/audit`, `Showing 1–25 of 29` |
| Signed-out visit to `/admin/audit` | redirected to `/sign-in?redirect=%2Fadmin%2Faudit`; zero audit table headers present |

Rows swapped in place on paging — the table did not fall back to skeletons,
which is what `keepPreviousData` is there for.

## Repair path and all-clear (AC4e at the UI)

Moving the anomalous game's kickoff into the past through the override endpoint
returned 200 and the anomaly list dropped to zero. On reload the card read:

```
"All clear — no game is unlocked with a knowable outcome."
```

The total moved 29 → 30 in the same reload, because the repair override is
itself audited — the trail records its own repair.

## Screenshots

Three full-page captures at 390px were taken (page 1, page 2, all-clear).
Per `docs/agents/testing.md` images are **not committed**; they are attached to
the pull request. This transcript is the committed, durable record.
