# The runbook's first pass, as driven

The Survivor manual-regression runbook was written by running it against the
live local stack — SPA on :5173, API on :3000, Docker Postgres on :5433 — with
one real Chromium context per member at 390×844, all open at once and never
focused away from each other, because the whole point of two windows is that one
of them must not refetch.

Screenshots (23, phone width, one directory per pass) live beside this file
under `screenshots/` and are **gitignored by design** — images go to the pull
request, not the repository.

## Setup

No simulator reset was run. The dev database held no league, game, week or
season rows, so an environment reset would have destroyed nothing and was
skipped rather than fired at the owner's data. The owner's own
`replay-nfl-2024` scenario was never touched.

```
GET  /api/sim/state                       → active=null, offset=0
POST /api/sim/scenarios/survivor-season/load
POST /api/admin/jobs/nfl/sync-schedule    → {seasonYear:2026, weeksSynced:4, gamesCreated:16}
```

Anchor instant `2026-08-08T01:14:04.053Z`; weeks 15 (08-08) / 16 (08-15) /
17 (08-22) / 18 (08-29), four games each.

The Survivor fieldset on the real create form, captured verbatim — one control,
no pick type, no range picker, which is ADR-0024 and ADR-0026 visible on screen:

```
Survivor settings
Season range
  Regular season, through week 18 — starting at the first week that hasn't kicked off yet.
Push / tie result
  Advance (team consumed)      Eliminate
```

Three leagues: **Survivor Main** (created through the form) plus **Tie-Advance**
and **Tie-Eliminate**, because `edit_settings` is `preStartOnly` and two leagues
are the only way to observe both tie answers.

## What each pass observed

**Week 15 — change, re-change, per-member lock, two windows.** M1 saved
BUF → DAL → BUF; after reload `BUF aria-pressed=true`. The second window,
loaded before M1 picked and never refocused, still read `No picks revealed yet`
with no history disclosure; reloaded, the same row gained `Pick history (1)` →
`Hidden until kickoff`. Past BUF's kickoff, M1's sheet went to zero Save
controls with every team disabled and its reason in the accessible name
(`Bills, this week's pick is locked in`), while at the same instant M2's sheet
was still live with `Save count=1`. That is the per-member lock: it follows the
pick's own game, not the week.

**Week 15 settled — missed pick, and the tie matrix.** PHI @ DAL was patched to
24–24 before the finals landed. `sync-scores` → `{wentFinal:4,
settledLeagueSeasons:3, settledResults:6}`. M3, who never picked, came back
**Out in Week 15**. The same push graded **Alive** in Tie-Advance and **Out** in
Tie-Eliminate — the setting, doing the only thing it does. The board stamp
flipped from `Nothing has settled yet.` to a real instant (`data-settled` false
→ true), and there is no rank column and no points total anywhere on it.

**Week 16 — eliminated view, per-game reveal, cancellation.** M3 got the
eliminated card, zero Save controls, zero team buttons, an operable week
selector, and a board identical to an alive member's. With DAL kicked off and SF
not, M1's board named M2's `DAL` while M2's board showed M1's entry as
`Hidden until kickoff`. SEA @ SF was then cancelled via override;
`sync-schedule` → `{cancellations:1, settledLeagueSeasons:1}`. After settling,
M1's ledger read `consumed=[BUF]` with `picks=["BUF:correct","SF:push"]` —
**SF named as the week's pick and absent from Teams used**, which is the sticky
release visible on screen and the only place a member ever sees it.

**Week 17 — the released team re-picked, and the revival.** The two ledgers,
side by side, are the cross-member independence claim:

```
M1: BUF disabled "already used this season"; SF ENABLED (released)
M2: KC, DAL disabled "already used this season"; BUF ENABLED
```

M1 saved SF successfully — the release is real, not cosmetic — then changed to
SEA. Both survivors lost that week, and both came back **Alive** with a
**Revived** pill, `revived=1`, their busting teams still consumed and their
week-17 entries still graded Incorrect. M3, already out when the week began, was
not revived.

**Week 18 — the ending.** Both survivors picked winners. The board's description
became "The season is over — everyone still standing shares first place", both
carried `data-winner=true` with a **Co-winner** pill, `concluded=true`, and M3
remained Out in Week 15.

## What the pass found

Two copy defects, both stating something untrue to the member, neither changing
a stored outcome — the class of fault no assertion at a cheaper layer was ever
going to catch, because none of them reads a sentence. Both are recorded in the
runbook's own §Defects found on the first pass and both were fixed in the same
change that added the runbook.

One state the pass did **not** reach, recorded so the checklist is not mistaken
for coverage: a member whose picked game is cancelled while other games in the
week are still open can still change out of it, since the pick's own game never
kicks off. Every other week-16 game had already started here, so the push stood
and the branch went unexercised.

## Environment left as found

Leagues, games, weeks and seasons back to zero; `sim_scenarios` back to the
owner's single `replay-nfl-2024`; users back to the original nine; the clock
offset reset to 0, which mattered most — leaving it 24 simulated days in the
future would have been the genuinely harmful residue.
