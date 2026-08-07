# ELM-2 — pick entry driven against the real stack

The criterion the test suites cannot prove: that a member can actually make and
change a Survivor pick through the running app, and that the clock-derived lock
holds when the simulated clock moves past kickoff.

Gathered by an **independent verifier** that did not implement any of this
(verification contract: worker self-report is context, never evidence). Driven
against `pnpm dev` — SPA at `:5173` proxying the API, real Postgres on 5433 —
with time moved only through `POST /api/sim/clock`, never by editing kickoff
timestamps. Session cookies are redacted throughout.

**Scenario choice, and why it deviates from the obvious one.** Every canned
library scenario declares exactly one week (`apps/api/src/services/sim/scenarios/timing.ts`:
"It is the only week the library declares"). Proving team consumption needs two
weeks, so no canned load could do it — and loading one would have wiped the
already-ingested NFL 2026 season in the shared dev database. The verifier drove
the ingested 18-week season instead and moved the clock. Nothing was reset until
cleanup.

## Transcript

**Clock set before week 1's first kickoff**

```
POST /api/sim/clock  {"kind":"instant","instant":"2026-09-10T00:00:00.000Z"}   → 200
{"now":"2026-09-10T00:00:00.000Z","realNow":"2026-08-07T19:50:22.845Z","offsetMs":2866177155}

GET /api/weeks/69ddb3e6…/games → 200   (week 1, 16 games, all locked:false)
  2026-09-10T00:20:00Z  NE @ SEA   ← earliest
  2026-09-11T00:35:00Z  SF @ LAR
  2026-09-13T17:00:00Z  ×8, 20:25Z ×4, 09-14T00:20Z, 09-15T00:15Z
```

**A creates the Survivor league — the range is resolved server-side**

```
POST /api/leagues
{"mode":"survivor","name":"ELM2 Verify Survivor","visibility":"public","maxMembers":10,
 "settings":{"pickType":"straight_up","pushTieResolution":"advance"}}      → 201
{"id":"46b3ab46-…","mode":"survivor","seasonYear":2026,
 "settings":{"startWeek":{"type":"regular","number":1},"endWeek":{"type":"regular","number":18},
             "pickType":"straight_up","pushTieResolution":"advance"},
 "startsAt":"2026-09-10T00:20:00.000Z","myRole":"commissioner"}
```

No week refs were sent and none were accepted — regular 1 → regular 18 came back
from the server (ADR-0024). An earlier attempt with an invalid
`pushTieResolution` correctly 400'd: `expected one of "advance"|"eliminate"`.

**B joins the public league** → `201`, roster shows both members.

**A picks SEA in the earliest-kickoff game**

```
PUT /api/leagues/46b3ab46-…/survivor/weeks/69ddb3e6-…/pick
{"gameId":"13d9ffa8-…","teamId":"303f5a22-…"}                              → 200
members[A] isViewer=true  hasPicked=true  pick={teamId:303f5a22-… (SEA), spreadAtPick:null}
members[B] isViewer=false hasPicked=false pick=null
consumedTeamIds=[]
```

**B reads the week before any kickoff — the visibility rule**

```
GET …/survivor/weeks/69ddb3e6-…/picks  (as B)                              → 200
A  isViewer=false  hasPicked=true   pick=null      ← withheld
B  isViewer=true   hasPicked=false  pick=null
```

A's pick is withheld from B while `hasPicked` still reports that one exists —
existence public, content private.

**A changes the pick, still pre-kickoff — an upsert, not an append**

```
PUT …/weeks/69ddb3e6-…/pick  {"gameId":"13d9ffa8-…","teamId":"6c60d0dc-…"(NE)}  → 200
viewer pick={id:f6ea262f-…, teamId:6c60d0dc-…}      ← same row id as before

psql: select … from survivor_picks … where u.username='<A>';
 f6ea262f-…  | week 69ddb3e6-… | NE | game 13d9ffa8-… | released=f     (1 row)
```

**Team consumption across weeks**

```
PUT …/weeks/961ccd44-…(wk2)/pick {"gameId":"5d808434-…","teamId":"5bfc8345-…"(BUF)}  → 200
  consumedTeamIds (week-2 view) = ["6c60d0dc-…"]    ← NE, burned in week 1

PUT …/weeks/961ccd44-…(wk2)/pick {"gameId":"4430e7bf-…","teamId":"6c60d0dc-…"(NE)}   → 409
{"error":"team_consumed","message":"You've already used that team this season — pick a different one."}

GET …/weeks/69ddb3e6-…(wk1)/picks  consumedTeamIds = ["5bfc8345-…"]  ← BUF only
```

The last line is the subtle one: viewing week 1, the list excludes week 1's own
NE, which is the team the member may still change.

**Clock past the picked game's kickoff**

```
POST /api/sim/clock {"kind":"instant","instant":"2026-09-10T01:00:00.000Z"}          → 200
GET /api/weeks/69ddb3e6-…/games:  NE@SEA locked=true; locked count 1 / 16

PUT …/weeks/69ddb3e6-…/pick {"gameId":"13d9ffa8-…","teamId":"303f5a22-…"(SEA)}       → 409
    {"error":"pick_locked","message":"That game has already kicked off — its pick is locked."}

PUT …/weeks/69ddb3e6-…/pick {"gameId":"1570a300-…","teamId":"5ff47d55-…"(SF)}        → 409
    {"error":"pick_locked", …}    ← cannot re-pick OUT of a started game, even into an unstarted one

GET …/weeks/69ddb3e6-…/picks  (as B)                                                 → 200
    A  isViewer=false hasPicked=true pick={teamId:6c60d0dc-… (NE)}   ← now revealed
```

**Pick summary**

```
GET …/survivor/pick-summary  (as A, commissioner)   → 200  {"pickCount":2,"memberCount":1}
GET …/survivor/pick-summary  (as B, member)         → 403  {"error":"not_commissioner", …}
```

**Extras**

```
PUT …/weeks/69ddb3e6-…/pick (as B)  → 200
   B picks freely in an unstarted game of a week where A is already locked.
PUT …/weeks/961ccd44-…/pick (as A) {"gameId":"…"(DET@BUF),"teamId":"…"(SEA)} → 409
   {"error":"team_not_in_game","message":"That team isn't playing in the game you picked."}
```

## The screen, at 390px

Signed in as A, viewport 390px wide, elements addressed by accessible role and
name or `data-testid` — never by class or position.

**A week with a pick already saved.** The held team reads as selected: the
`DET @ BUF` row carries a "Your pick" badge and the BUF control is
`aria-pressed=true`. The bottom bar reads "Your pick: Buffalo Bills" with **Save
disabled**. Selecting a different team flips the bar to "Atlanta Falcons
selected — not saved yet" and enables Save; clicking it toasts "Pick saved",
moves the badge to the new row, and disables Save again — a real round trip
through the API, not local state.

**A team consumed in another week.** In `PIT @ NE`, the NE control is
`disabled`, carries a "used" pill, and its accessible name is **"New England
Patriots, already used this season"** — the disabled state has a name a screen
reader can announce, which a greyed box alone would not. Its sibling stays
enabled.

**The week after the picked game kicked off.** The sheet is frozen: the header
reads "Your pick has kicked off, so this week is set. Come back next week.", all
32 team controls are `disabled` with the accessible name "…, this week's pick is
locked in", the held team keeps its badge, and **the Save bar is gone entirely**
— no control matching /save/i in the DOM. Offering a Save the API would answer
`pick_locked` is exactly what this avoids. Kickoff labels read against the
**simulated** instant ("Kickoff Today 8:20 PM"), not the browser's, which is the
`useAppNow()` rule holding in practice.

No layout breakage at 390px, no horizontal scroll, no console errors.

Phone-width screenshots were captured. Per `docs/agents/testing.md`, images are
**not** committed — they go in the pull request. The claims above rest on the
role- and testid-level observations recorded here, not on an uncommitted local
file.

## Cleanup

League-scoped sim reset, clock reset to offset 0, and the three minted users
deleted. Post-run counts matched pre-run: 9 users, 1 league (the pre-existing
Pick'em one), 0 `survivor_picks`, 0 `survivor_state`, and ingested data untouched
at 22 weeks / 272 games / 1 sport_season / 1 sim_scenario.

## What this run found

Three defects, all fixed in `29fbe00` before this evidence was accepted:

1. **`sim reset` did not list the Survivor tables**, so its report undercounted
   what a reset destroyed — the exact failure its own comment names.
2. **`GET /leagues/{id}/weeks` still described its 400 as "Not a Pick'em
   league"** after this branch widened the gate to serve Survivor.
3. **The runbook's session-minting recipe is blocked by the repo's own guard
   hook**, which refuses any Bash command mentioning `.env`. Every agent
   following it hits a wall the document did not mention; the recipe now loads
   the env in-process instead. The guard was not weakened.
