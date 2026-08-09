# LG-13 — invite panel before and after the league starts

**Result:** PASS · 2026-08-09 · driven simulator against the full local stack
(`docs/agents/verification-runbook.md`), phone width (390×844).

Proves the one criterion no test layer should pin: what the commissioner's
Invites panel *shows* once the window closes. The refusal itself is pinned in
`apps/api/test/invites-join.test.ts` ("post-start invite management"); the
screenshots are attached to the PR per the evidence policy (text only here).

## Method

A throwaway sim spec, deleted after the run — not committed, because a browser
test of a disabled control is presentation policy, which
`.claude/rules/engineering.md` keeps out of the suites on purpose.

1. Seed the 2099 NFL season (one week-1 game, kickoff `2099-09-12T17:00:00Z`).
2. Reset the sim clock to real time, create a Pick'em league through the form.
3. Pre-start: mint an invite link — panel fully operable.
4. Move the simulated clock to `2099-09-12T17:01:00Z` (one minute past kickoff).
5. Reload the Members tab and drive the panel.

## Observed

League resolved to the Regular Season preset with a derivable start:

```
LEAGUE: {"mode":"pickem","seasonYear":2099,
         "settings":{"startWeek":{"type":"regular","number":1},
                     "endWeek":{"type":"regular","number":18},
                     "seasonRangePreset":"regular_season"},
         "startsAt":"2099-09-12T17:00:00.000Z","myRole":"commissioner"}
```

Clock moved; the SPA's own clock followed the server's (`/api/me` `now`), which
is what makes the client-side window hint trustworthy (arch D11):

```
CLOCK POST: 200 {"clock":{"now":"2099-09-12T17:01:00.000Z",
                          "realNow":"2026-08-09T16:09:49.541Z"}}
ME:             {"simEnabled":true,"now":"2099-09-12T17:01:00.024Z"}
```

Server refuses a post-start mint with the catalogued 409:

```
SERVER create-invite: 409 {"error":"league_started",
  "message":"New invite links can't be created once the league has started."}
```

UI assertions, all passing:

| Assertion | Pre-start | Post-start |
| --- | --- | --- |
| Invites panel rendered | yes | **yes** — survives the start |
| "Create invite link" button | enabled | **disabled** |
| "Max uses (optional)" input | enabled | **disabled** |
| Locked reason visible | no | **yes** |
| "Revoke" on an existing link | enabled | **enabled** |
| Revoke actually revokes | — | **yes** → list falls to "No invites yet." |

The locked reason reads: *"New invite links can't be created once the league
starts. Existing links can still be revoked."* It sits directly above the
disabled controls, each pointing at it via `aria-describedby` — the same
inline-reason shape the Members card above already uses for its locked Kick and
Leave controls.

```
  ✓  9 [simulated] › LG-13 manual drive › invite panel before and after the league starts (1.1s)
  9 passed (9.7s)
```

## Note on a false start

Two earlier attempts failed and neither was a product fault:

- `getByRole("heading", {name: "Invites"})` never matches — `CardTitle` renders
  a `<div>` repo-wide, predating LG-13.
- A malformed clock reset (`{kind: "instant", instant: null}` instead of
  `{kind: "reset"}`) leaked a 73-year offset onto the shared `app_state`
  singleton, so the *next* run created its league past week 1's kickoff.
  ADR-0020 then resolved that league onto the Postseason preset, whose weeks
  the seed does not have, leaving `startsAt: null` — correctly read as
  not-started by both the server and the UI. Cleared with
  `update app_state set sim_clock_offset_ms = 0`.

The second is worth knowing before driving the simulator by hand: a sim spec
that dies before its reset leaves the offset set for whatever runs next, and
the symptom surfaces as an unrelated league resolving to an unexpected preset.
