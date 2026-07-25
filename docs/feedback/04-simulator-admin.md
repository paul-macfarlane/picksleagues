# Feedback: Simulator & Admin Ops epic (SIM/ADM)

Conventions in [README.md](README.md).

## Round 1 — post-SIM-backend review (2026-07-25)

Five items, on PR #14 (SIM-1/2/3/4/6).

| Item | Resolution |
| --- | --- |
| 1. App-wide role belongs in the database | Done — `users.app_role` is the sole authorization source, migration 0013, ADR-0013. `ADMIN_USER_IDS` demoted to a promote-only bootstrap seed applied on every authenticated request; nothing reads it to decide access. `mintSession({ appRole })` added, which is what unblocks admin e2e. `f3f0b2b` |
| — premise correction | The env var was **not** hurting integration tests (each builds its own `Env`). The blocker was e2e: Playwright boots the API as a separate process that caches the allowlist before specs mint their users. `docs/architecture.md` had already claimed E2E minted admin sessions "per ADR-0006" — ADR-0006 describes no such mechanism and none existed. |
| 2. Env var to toggle the simulator | Done — `SIM_ENABLED`, default false, with production as a hard override (`isSimEnabled` = `APP_ENV !== production && SIM_ENABLED`). ADR-0014. Chose the override over a pure flag because the simulator moves the clock and truncates data; one mis-set Vercel var must not point that at prod. Also collapsed five copies of the predicate into one. `fe262f0` |
| 3. `fetch-week-games.ts` exports `fetchSeasonGames` | Done — file renamed to `fetch-season-games.ts`; the function name was the accurate one and every sibling in `services/nfl/` matches its export. `1dc1be8` |
| 4. `sim.test.ts` is large — trim or split? | **Split, nothing trimmed.** No redundant tests: the two apparent overlaps (reset asserted two ways; clock projection asserted through ingestion *and* through the fixtures endpoint) each prove a different code path. Six files on the existing describe boundaries + `test/setup/sim-helpers.ts`; largest is now 312 lines. 301 tests before and after. `bc587a9` |
| 5. Defer bracket work to its own epic | Already its own epic — only SIM-8 sat outside it, so it became **MM-8** with its dep corrected from MM-1 to MM-2 (bracket ingestion is what introduces the NCAAMB provider surface). Found en route: **MM-1's deliverable already shipped inside LG-2**, so it was marked done. MVP scope unchanged — March Madness stays an MVP mode, sequenced last. `1dc1be8`, `ad8a43a` |

### Evaluator findings (4 major, all fixed)

| Finding | Resolution |
| --- | --- |
| Seed re-grants on every request, so a DB revocation of a still-listed id doesn't stick — ADR-0013 claimed revocation was "a deliberate database change" | Kept the code (a declarative floor is the better semantic), corrected ADR-0013 and six code comments, and added the test that pins it. Revoking a seeded admin means removing the id **and** updating the row. |
| `docs/architecture.md` §Simulator & Time still described the env-var allowlist and the false ADR-0006 e2e claim | Rewritten, along with the §Simulator & Time lines that still framed the gate as `APP_ENV`. |
| `.claude/skills/verify/SKILL.md` told agents to mint "an allowlisted user" — they'd have got a 403 | Rewritten to the admin-role mechanism, plus a note that a 404 on `/sim/*` now means `SIM_ENABLED` is off. |
| SIM-8 → MM-8 renumbering broke `backlog/README.md`'s stable-id rule and left a dangling reference in ADR-0012 | ADR-0012 updated; the backlog pointer now names the old id so a grep lands there. |
| Minors | `deleteAccount` now clears `app_role` (a tombstone row kept `admin`); MM-7's dep corrected; `resolveGameDataProvider` and "Better Auth cannot write `app_role`" both got the tests they lacked; two overstated comments corrected; runbook warns that blanking `SIM_ENABLED` (vs. deleting it) fails cold start. |

### Carried forward

- **Staging's Vercel `SIM_ENABLED` must be set to `true` manually** — default-false means it is off until someone sets it, and nothing infers it from the branch.
- `mintSession({ appRole })` is unexercised by any spec until SIM-7 adds one; item 1's motivating scenario is unproven end-to-end until then.
