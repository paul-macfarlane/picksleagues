# Backlog

Work split by epic to keep context small. One file per epic, ordered by dependency structure and season timing: **NFL modes first** (season starts Sept 2026), March Madness last (not needed until Feb/March 2027). The app is launchable for the NFL season after `06-elimination`; March Madness ships as a follow-on.

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
| `06-elimination.md`    | `ELM`  | Elimination mode, survivor board                            |
| `07-march-madness.md`  | `MM`   | Bracket ingestion, builder, scoring, pool leaderboard       |
| `09-launch.md`         | `LNCH` | Rules guide, prod cron, mobile QA, launch                   |
| `10-trust-safety.md`   | `TS`   | Post-MVP: public-league abuse resistance, member notifications |
| `11-schema-foundations.md` | `SF` | Season/team schema scalability ahead of the picks epics    |

## Working the backlog

- `/task next` picks the first unblocked todo in build order. `/task PKM-3` runs a specific one.
- Later epics are intentionally lighter — flesh out a task's acceptance criteria when you reach it, referencing the relevant spec/architecture sections.
- The shared settlement machinery (`pick_results`, `standings`, settle orchestration, nightly sweep) is built inside `05-pickem` since Pick'em proves it first; ELM and MM integrate with it rather than rebuilding it.
