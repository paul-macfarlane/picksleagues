# Backlog

Work split by epic to keep context small, one file per epic. Season timing sets the outer bound: **NFL modes first** (season starts Sept 2026), March Madness last (not needed until Feb/March 2027) — all bracket/NCAAMB work lives in `07-march-madness.md`. Within that, see **Build order** below for the sequence actually being worked; the file numbers only record the order epics were written.

Both NFL modes ship today end-to-end (epics 00–06, 11), tails included (`PKM-10`, `ELM-11`), on the simplified rule surface epic 12 delivered and the de-brittled test suites epic 13 left behind. Launch (`09`) is complete — `LNCH-12`'s mode gate included, plus `LNCH-13`/`LNCH-14`, which production surfaced rather than the plan: Google rejected the app's OAuth branding because the SPA served every URL as an empty shell, so the public routes are now prerendered at build (ADR-0039). The owner-feedback epic (`14`) closed in two rounds (PR #75, PR #78), the scope sweep (`15`) finished triaging on 2026-08-11, game stats (`16`) delivered STAT-1–11 by 2026-08-14, and the pre-honeymoon hardening-and-handoff run (`DATA-10`, `FND-12`, `DATA-11`, `ADM-5`) is merged and promoted to prod. The pre-season tail (`STAT-12` matchup-sheet sizing, `ID-5` avatar theme preview, `LNCH-15` installable PWA, `LNCH-16` install affordance) landed by 2026-08-22 (PRs #97–#100). What remains is the mobile-feel epic (`17`) for the installed PWA, then March Madness (`07`) when its season approaches.

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
| `15-scope-sweep.md`    | `SWP`  | App-wide complexity-vs-value sweep: cut candidates, all triaged          |
| `16-game-stats.md`     | `STAT` | Pre-pick matchup stats (records, injuries, team stats, matchup context), tiered basic/advanced UX |

## Build order

File numbers are historical, not priority — they record the order epics were
written. This list holds only remaining work; completed rounds are summarized
below it. The order remaining work is taken (owner, 2026-08-22):

1. **`17-mobile-feel`** (owner, 2026-08-22) — `MOB-1` → `MOB-2` → `MOB-3` first (standalone polish + touch targets, bottom tab bar, view transitions): the "feels like an app" threshold for the installed PWA. `MOB-4`–`7` are a second round after living with the tab bar.
2. **`07-march-madness`** — the third mode, not needed until Feb 2027, on whatever surface `SWP-6` leaves. Completing it includes lifting `LNCH-12`'s gate.

`10-trust-safety` was in this list until `SWP-2` scrapped it (owner, 2026-08-09) —
its items are `wontfix` in place. `SWP-3` kept public discovery (owner, 2026-08-11)
and accepted the trade with it: a public league's recourse is the commissioner's
remove-member and a direct database update, not an in-app reporting flow. That
acceptance is what reopening the epic would have to argue against — real abuse
in a real public league, not the fact that strangers can see one.

Completed rounds, for reference: epics 12 (rule simplification) and 13 (quality)
ran first, which made everything after them cheaper than it was written to be;
then the mode tails (`PKM-10` PR #54, `ELM-11` ADR-0028), launch (`09`, owner
confirmed 2026-08-10), owner feedback (`14`, PR #75), the scope sweep (`15`,
triage closed 2026-08-11), game stats (`16`, STAT-1–11, last merge PR #90), and
the pre-honeymoon hardening & handoff (`DATA-10` → `FND-12` → `DATA-11` →
`ADM-5`, PRs #93–#96, promoted staging → main for the second admin's solo test),
and the pre-season tail (`STAT-12`, `ID-5`, `LNCH-15`, `LNCH-16`, PRs #97–#100).

## Working the backlog

- `/task next` picks the first unblocked todo in build order. `/task PKM-3` runs a specific one.
- Later epics are intentionally lighter — flesh out a task's acceptance criteria when you reach it, referencing the relevant spec/architecture sections.
- The shared settlement machinery (`pick_results`, `standings`, settle orchestration, nightly sweep) is built inside `05-pickem` since Pick'em proves it first; ELM and MM integrate with it rather than rebuilding it.
