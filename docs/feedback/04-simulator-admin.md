# Feedback: Simulator & Admin Ops epic (SIM/ADM)

Conventions in [README.md](README.md).

## Round 1 — post-SIM-backend review (2026-07-25)

Five items, on PR #14 (SIM-1/2/3/4/6).

| Item | Resolution |
| --- | --- |
| 1. App-wide role belongs in the database | Done — `users.app_role` is the sole authorization source, migration 0013, ADR-0013. `mintSession({ appRole })` added, which is what unblocks admin e2e. `f3f0b2b`, then `ADMIN_USER_IDS` removed outright in round 2 below. |
| — premise correction | The env var was **not** hurting integration tests (each builds its own `Env`). The blocker was e2e: Playwright boots the API as a separate process that caches the allowlist before specs mint their users. `docs/architecture.md` had already claimed E2E minted admin sessions "per ADR-0006" — ADR-0006 describes no such mechanism and none existed. |
| 2. Env var to toggle the simulator | Done — `SIM_ENABLED`, default false, with production as a hard override (`isSimEnabled` = `APP_ENV !== production && SIM_ENABLED`). ADR-0014. Chose the override over a pure flag because the simulator moves the clock and truncates data; one mis-set Vercel var must not point that at prod. Also collapsed five copies of the predicate into one. `fe262f0` |
| 3. `fetch-week-games.ts` exports `fetchSeasonGames` | Done — file renamed to `fetch-season-games.ts`; the function name was the accurate one and every sibling in `services/nfl/` matches its export. `1dc1be8` |
| 4. `sim.test.ts` is large — trim or split? | **Split, nothing trimmed.** No redundant tests: the two apparent overlaps (reset asserted two ways; clock projection asserted through ingestion *and* through the fixtures endpoint) each prove a different code path. Six files on the existing describe boundaries + `test/setup/sim-helpers.ts`; largest is now 312 lines. 301 tests before and after. `bc587a9` |
| 5. Defer bracket work to its own epic | Already its own epic — only SIM-8 sat outside it, so it became **MM-8** with its dep corrected from MM-1 to MM-2 (bracket ingestion is what introduces the NCAAMB provider surface). Found en route: **MM-1's deliverable already shipped inside LG-2**, so it was marked done. MVP scope unchanged — March Madness stays an MVP mode, sequenced last. `1dc1be8`, `ad8a43a` |

### Evaluator findings (4 major, all fixed)

| Finding | Resolution |
| --- | --- |
| Seed re-grants on every request, so a DB revocation of a still-listed id doesn't stick — ADR-0013 claimed revocation was "a deliberate database change" | Kept the code and corrected the docs at the time — **then superseded by round 2**, which deleted the seed outright. This finding is a large part of why: a mechanism whose revocation semantics needed a paragraph to explain was not earning its keep. |
| `docs/architecture.md` §Simulator & Time still described the env-var allowlist and the false ADR-0006 e2e claim | Rewritten, along with the §Simulator & Time lines that still framed the gate as `APP_ENV`. |
| `.claude/skills/verify/SKILL.md` told agents to mint "an allowlisted user" — they'd have got a 403 | Rewritten to the admin-role mechanism, plus a note that a 404 on `/sim/*` now means `SIM_ENABLED` is off. |
| SIM-8 → MM-8 renumbering broke `backlog/README.md`'s stable-id rule and left a dangling reference in ADR-0012 | ADR-0012 updated; the backlog pointer now names the old id so a grep lands there. |
| Minors | `deleteAccount` now clears `app_role` (a tombstone row kept `admin`); MM-7's dep corrected; `resolveGameDataProvider` and "Better Auth cannot write `app_role`" both got the tests they lacked; two overstated comments corrected; runbook warns that blanking `SIM_ENABLED` (vs. deleting it) fails cold start. |

## Round 2 — drop the bootstrap seed (2026-07-26)

One item, following directly from round 1.

| Item | Resolution |
| --- | --- |
| `ADMIN_USER_IDS` isn't needed — setting the role manually in the database is less work than finding a user id, putting it in the env, and letting a seed run | Agreed and removed entirely. The seed's justification was a "zero-SQL path to the first admin", but you must query the database for the id *before* you can set the variable — so it turned one `UPDATE` into three steps and added a footgun: because it re-applied on every authenticated request, a listed id was a standing grant that silently undid any database revocation. Granting admin is now `UPDATE users SET app_role = 'admin' WHERE email = …`, documented in `.env.example` and the runbook. No `admin:grant` script either — whoever can grant admin already has database access. ADR-0013 rewritten to record the decision as shipped rather than the draft that didn't. |

Net: `requireSession` is simpler than before the seed existed, no application code writes
`app_role` except `deleteAccount` clearing it, and one env var is gone from every scope.
Tests dropped 217→215 unit and 304→299 integration — exactly the seeding cases, with all
authorization-source coverage kept (and the revocation test simplified, since there's no
longer a seed fighting it).

### Carried forward

- **Staging's Vercel `SIM_ENABLED` must be set to `true` manually** — default-false means it is off until someone sets it, and nothing infers it from the branch.
- `mintSession({ appRole })` is unexercised by any spec until SIM-7 adds one; item 1's motivating scenario is unproven end-to-end until then.
