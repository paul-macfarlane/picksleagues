# Backlog

Work split by epic to keep context small, one file per epic. Season timing sets the outer bound: **NFL modes first** (season starts Sept 2026), March Madness last (not needed until Feb/March 2027) — all bracket/NCAAMB work lives in `07-march-madness.md`. Within that, see **Build order** below for the sequence actually being worked; the file numbers only record the order epics were written.

Both NFL modes ship today end-to-end (epics 00–06, 11), tails included (`PKM-10`, `ELM-11`), on the simplified rule surface epic 12 delivered and the de-brittled test suites epic 13 left behind. What stands between that and a launchable product is gating the one mode that doesn't exist yet (`LNCH-12`) and the rest of `09-launch`.

## Task format

Each task is a checkbox with a stable ID:

```
- [ ] **FND-1** — Short description. _(deps: none)_
```

Status markers:

- `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

These four are the entire state vocabulary — don't invent others. `[~]` covers every working phase (planning, implementation, review, PR open); the backlog deliberately does not distinguish them, so moving between phases is no transition at all. `[!]` is a flag, not a lifecycle stage — it can sit on a task in any phase and always carries a note naming the blocker. A task is **available** when it is `[ ]` and every ID in its `deps:` is `[x]`.

Keep the ID stable once created — commands, ADRs, and commits reference it. Add new tasks by appending the next number in that epic; don't renumber. This tracker is the only one: GitHub Issues is unused and stays that way — never `gh issue create` here.

Write tasks as **goals**: the outcome plus the `docs/mvp-spec.md` / `docs/architecture.md` section that defines it. Don't restate doc mechanics in the task line — the docs are the source of truth for _how_, and inline copies drift. A thin task line is therefore normal, not a readiness gap: the referenced doc section is the contract.

**Triage tags** ride as trailing tags on the task line, after the deps — e.g. `_(deps: none)_ _(needs-info)_`. The vocabulary: `needs-triage` (owner must evaluate), `needs-info` (waiting on reporter), `ready-for-agent` (fully specified, agent-runnable), `ready-for-human` (requires human implementation), `wontfix`. A tag never replaces the state marker — they are separate axes.

**Technical plans never live in epic files.** Planning happens in the working conversation; what outlives it goes to an ADR or the PR body. A 400-line plan inlined among ticket lines destroys the thin contract this file format exists to keep — the first one written that way took `12-simplification.md` from 63 lines to 460.

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
| `10-trust-safety.md`   | `TS`   | Scrapped (SWP-2): stranger-scale abuse machinery a friends-scale app doesn't need |
| `11-schema-foundations.md` | `SF` | Season/team schema scalability ahead of the picks epics    |
| `12-simplification.md` | `SIMP` | Collapse the Pick'em rule surface: immutable weekly submissions, fixed push, no tiebreaker, no week moves |
| `13-quality.md`        | `QLTY` | Non-functional: justify or cut each engineering rule, de-brittle the test suites |
| `14-owner-feedback.md` | `FB`   | Items the owner raised from real use: fixture bug, perf audit, QoL, scope questions |
| `15-scope-sweep.md`    | `SWP`  | App-wide complexity-vs-value sweep: cut candidates awaiting owner triage |

## Build order

File numbers are historical, not priority — they record the order epics were
written. The order work is actually taken (owner, 2026-08-09):

1. **`05-pickem`, remainder** — `PKM-10`, the dashboard pick-status glance the launch mode still answers with a placeholder. **Done** (PR #54).
2. **`06-survivor`, remainder** — `ELM-11`, eliminating a member the moment their loss is certain. **Done** (delivered 2026-08-08, ADR-0028; the checkbox lagged the merge, which is how this list re-listed it).
3. **`LNCH-12`** — gate March Madness so nobody can create a league in a mode that doesn't exist. Ahead of the rest of launch because it is the one item where shipping without it strands real members in a dead league.
4. **`09-launch`, remainder** — branding, design pass, ToS/privacy, splash, rules guide, loading states, cron schedules, mobile QA, production cutover. Within it the visual + legal slice (LNCH-7, 9, 10, 11) comes first: it is what makes the app read as a product rather than a project.
5. **`14-owner-feedback`** — what the owner noticed using the thing. Deliberately after launch: none of it blocks going live, and one item (`FB-2`) is a question whose answer gets better once there is real usage to point at.
6. **`15-scope-sweep`** — owner triage of the app-wide cut candidates (2026-08-09 sweep). Sits before the epics below because its rulings decide whether they get built at all: `SWP-2`/`SWP-3` gate trust-safety, `SWP-6` reshapes March Madness before it starts.
7. **`07-march-madness`** — the third mode, not needed until Feb 2027, on whatever surface `SWP-6` leaves. Completing it includes lifting `LNCH-12`'s gate.

`10-trust-safety` was step 7 until `SWP-2` scrapped it (owner, 2026-08-09) — its
items are `wontfix` in place, and `SWP-3`'s public-discovery ruling is where the
question could ever reopen.

Prior rounds, for reference: epics 12 (rule simplification) and 13 (quality) ran
first and are complete, which is why the launch and mode work listed above is
cheaper than it was written to be.

## Working the backlog

- `/task next` picks the first unblocked todo in build order. `/task PKM-3` runs a specific one.
- Later epics are intentionally lighter — flesh out a task's acceptance criteria when you reach it, referencing the relevant spec/architecture sections.
- The shared settlement machinery (`pick_results`, `standings`, settle orchestration, nightly sweep) is built inside `05-pickem` since Pick'em proves it first; ELM and MM integrate with it rather than rebuilding it.
