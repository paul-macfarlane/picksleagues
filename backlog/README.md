# Backlog

Work split by epic to keep context small, one file per epic. Season timing sets the outer bound: **NFL modes first** (season starts Sept 2026), March Madness last (not needed until Feb/March 2027) — all bracket/NCAAMB work lives in `07-march-madness.md`. Within that, see **Build order** below for the sequence actually being worked; the file numbers only record the order epics were written.

Pick'em ships today end-to-end (epics 00–05, 11). What stands between that and a launchable product is epic 12's rule simplification, epic 13's quality pass, and the visual/legal slice of `09-launch`. Survivor follows.

## Task format

Each task is a checkbox with a stable ID:

```
- [ ] **FND-1** — Short description. _(deps: none)_
```

Status markers:

- `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

Keep the ID stable once created — commands, ADRs, and commits reference it. Add new tasks by appending the next number in that epic; don't renumber.

Write tasks as **goals**: the outcome plus the `docs/mvp-spec.md` / `docs/architecture.md` section that defines it. Don't restate doc mechanics in the task line — the docs are the source of truth for _how_, and inline copies drift.

## Epics

| File                   | Prefix | Epic                                                        |
| ---------------------- | ------ | ----------------------------------------------------------- |
| `00-foundation.md`     | `FND`  | Monorepo scaffold, envs, auth, Clock, contract, CI, tests   |
| `01-identity.md`       | `ID`   | Username claim, profile, onboarding                         |
| `02-game-data.md`      | `DATA` | Seasons/weeks/games schema, ESPN provider, sync jobs        |
| `03-leagues.md`        | `LG`   | Leagues, settings, invites, membership, discovery           |
| `04-simulator-admin.md` | `SIM`/`ADM` | Admin page + simulator: data browsers, sim clock/replay UI, overrides, audit (merged per ADR-0011) |
| `05-pickem.md`         | `PKM`  | Pick'em mode + shared settlement core (results, standings)  |
| `06-survivor.md`       | `ELM`  | Survivor mode, survivor board                               |
| `07-march-madness.md`  | `MM`   | Bracket ingestion, builder, scoring, pool leaderboard       |
| `09-launch.md`         | `LNCH` | Rules guide, prod cron, mobile QA, launch                   |
| `10-trust-safety.md`   | `TS`   | Post-MVP: public-league abuse resistance, member notifications |
| `11-schema-foundations.md` | `SF` | Season/team schema scalability ahead of the picks epics    |
| `12-simplification.md` | `SIMP` | Collapse the Pick'em rule surface: immutable weekly submissions, fixed push, no tiebreaker, no week moves |
| `13-quality.md`        | `QLTY` | Non-functional: justify or cut each engineering rule, de-brittle the test suites |

## Build order

File numbers are historical, not priority — they record the order epics were
written. The order work is actually taken (owner, 2026-08-03):

1. **`12-simplification`** — the Pick'em rules the app ships on. Everything downstream is cheaper once the rule surface is smaller, and the deletions remove a large share of what epic 13 would otherwise have to fix.
2. **`13-quality`** — justify or cut the standards, then de-brittle the tests. Deliberately after 12 (which deletes much of the brittle surface) and before the facelift (which those tests would otherwise veto).
3. **`09-launch`, visual + legal slice** — LNCH-7 branding, LNCH-9 design pass, LNCH-10 ToS/privacy, LNCH-11 splash. This is what makes it look like a product rather than a project.
4. **`06-survivor`** — the second game mode, on a rule surface and a UI that have both settled.
5. **`09-launch`, remainder** — cron schedules, mobile QA, production cutover.
6. **`07-march-madness`**, then **`10-trust-safety`** — not needed until Feb/March 2027 and post-MVP respectively.

`ID-4` and `ADM-3` are the two open stragglers in otherwise-complete epics; take
them when they block something rather than for tidiness.

## Working the backlog

- `/task next` picks the first unblocked todo in build order. `/task PKM-3` runs a specific one.
- Later epics are intentionally lighter — flesh out a task's acceptance criteria when you reach it, referencing the relevant spec/architecture sections.
- The shared settlement machinery (`pick_results`, `standings`, settle orchestration, nightly sweep) is built inside `05-pickem` since Pick'em proves it first; ELM and MM integrate with it rather than rebuilding it.
