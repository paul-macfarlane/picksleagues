# Runbook: Pick'em Manual Regression

A click-through pass over the Pick'em rules that automated tests reach least well:
the ones that live in the **browser**, across a **clock change**, or in a game that
does something other than kick off and go final.

Every pass below drives an existing library scenario (`docs/simulator-guide.md`
§Scenario library) — four of the six edge cases plus the `mixed-week` baseline.
Nothing here needs a new scenario or a hand-built fixture.

Read `docs/simulator-guide.md` first for the canonical workflow, week anchors, and
reset scopes. This runbook assumes it and does not restate it.

**Everything below post-dates ADR-0018 and ADR-0019.** A week is one atomic,
immutable submission: no editing, no substitute pick, no re-pricing, no
accept-latest-spreads bar, no week moves, no push/tie setting, no standings
differential. A step that implies otherwise is stale, not the product.

## What automation already covers — skip these

Manual time is worth spending where the safety net is thin. It is **not** thin here:

| Covered by                                                                     | So don't spend a manual pass on                                                                                                                                                                                       |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/scoring` (`pickem.test.ts`, `standings.test.ts`)                      | Whether a cover / non-cover / push / tie / cancellation grades correctly in the abstract, that a push is a fixed 0.5, and that members level on points share a rank                                                    |
| `apps/api/test/pickem-picks.test.ts`                                           | The submission refusal matrix (`already_submitted`, `pick_set_incomplete`, `too_many_picks`, `pick_locked`, `spread_stale`, `spread_unavailable`, `duplicate_pick`), required-set sizing, `picksAllowed` caps, visibility filtering |
| `apps/api/test/pickem-picks.test.ts` §settings reset                            | Which settings changes clear picks, and the `picks_locked` refusal once one has locked                                                                                                                                 |
| `apps/api/test/settlement.test.ts`                                             | Settlement idempotency, re-settling, the nightly sweep, concurrent settlement, override precedence, and a `cancelled` status override turning a pick into a push                                                       |
| `apps/api/test/pickem-standings.test.ts`                                       | Weekly vs season boards, W/L/P counts, shared ranks, `lastUpdatedAt`                                                                                                                                                  |
| `e2e/pickem-journey.sim.spec.ts` (`mixed-week`, **straight-up**, 2 members, 1 week) | The happy path end to end: create → join → assemble → confirm → freeze → lock → reveal → settle, a cap shorter than the slate, and two tied members sharing a rank with nothing rendered behind them                   |

What is left over is this document: the branches around those, in a real browser,
with the clock moving underneath them.

## Setup (once per pass)

```
Reset → environment (drop it)      →  Scenarios → Load <slug>
→  Admin → Jobs → Sync schedule    →  Admin → Jobs → Sync odds
→  Clock → jump to week 1, anchor "before first kickoff"
→  Create a league, join as a second user
```

Two accounts are the point — one member's view of another is where the visibility
rule lives, and it cannot be checked from a single session. Use a second browser
profile, not a second tab.

**Pick type is a per-pass choice.** ATS exercises the spread; straight-up exercises
the tie. Where a pass depends on one, it says so.

**The league's weeks come from a preset, not a week pair.** The create form offers
one **Season range** select — Regular Season / Postseason / Full Season (ADR-0020)
— and the range only moves when the preset does. Every library scenario declares
regular-season week 1, so leave it on the default, Regular Season.

---

## Operator note — a game that changes week

Read this before the passes, because nothing in the passes will ever surface it.

Week moves are **out of scope** (ADR-0019). `moved` is not a game status, settlement
no longer compares a pick's week to its game's week, and no screen says a pick's
game has left the week. What happens instead is worth stating exactly, because the
intuitive guess is wrong: nothing is stranded. Settlement loads a week's picks and
then loads their games **by `pick.gameId`**, so an old-week pick on a moved game
still finds a real final score and **grades against it**. The member takes a real
win or a real loss in a week whose slate no longer contains the game, and every
number on screen is internally consistent — which is exactly why nothing catches it.

**Detection is operational.** Review each schedule sync:

- **The API log.** `nfl-sync-schedule.week-move` is logged once per moved game,
  naming its `providerGameId`, and the run's `job.completed` line carries
  `weekMoves: N`. Locally that is the API dev server's console; on a deployment it
  is the function log.
- **The job response.** Admin → Jobs → Sync schedule returns the same `details`
  object — the toast reports only the duration, so read the response body in the
  browser's network tab if you don't have the log to hand.
- **Admin → Games.** Confirms which game now sits in which week.

**The remedy is one override.** Admin → Games → the moved game → status override →
**Cancelled**. A cancelled game's pick resolves as a push and the push stands
(ADR-0018 decision 3), so every affected member is made whole by one action on one
row, and the override writes its `admin_audit` entry like any other correction. It
works whether or not the game has been played — settlement resolves
`override_status ?? status` before it looks at scores — so a later re-settle repairs
an already-graded week.

**Rehearse it once**, so the log line is familiar rather than novel on the day:
Sim → Fixtures → change a game's **week** → Sync schedule → read `weekMoves: 1` →
apply the `cancelled` override → `/sim/settle` → the pick reads Push. Note what does
*not* happen along the way: no row on the member's week says anything, and no badge
changes, until the override lands.

---

## Pass 1 — Confirm and freeze: one submission per week

**Scenario:** `mixed-week` · **League:** straight up

Run this first: every other pass submits through this flow. The merge-gate e2e pins
the happy path for one league shape; what it does not take are the branches below.

1. My Picks, week 1. Select some but not all of the required set.
2. Fill the set, open the confirmation, and **cancel** it.
3. Submit for real.

Assert:

- [ ] The action bar counts `N of M picks`, and **Submit stays disabled** until the
      sheet is a full set. `M` is what the week can still take, not the number of
      rows on screen.
- [ ] At `M`, every *unselected* row's buttons go dead while a held side stays
      operable — giving one back is what frees the slot.
- [ ] The confirmation names the count and the week and says, in as many words, that
      the picks are final and can't be changed, replaced, or removed.
- [ ] **Cancel writes nothing.** The sheet is exactly as it was, still editable,
      still complete.
- [ ] Confirming freezes the week: the submit control is **gone**, not disabled;
      both sides of every row are disabled; and the side you took is still visibly
      the one you took, rather than both sides dimming into anonymity.
- [ ] **Two tabs.** Open the same week in a second tab *before* submitting, assemble
      a set in both, submit in one, then submit in the other. The second is refused
      with "a week can only be submitted once", and the tab replaces its dead sheet
      with the read-only week it now holds — it must not sit on a sheet that can
      never be submitted.
- [ ] **A kickoff mid-sheet.** With an unsubmitted sheet open and selections made,
      advance the clock past the first kickoff → Sync scores → return to the tab
      *without reloading*. The started game leaves the sheet, its selection goes
      with it, the required count drops by one, and a sheet that was complete is
      still complete. A selection on a game that has kicked off must never reach the
      submission: under submit-once that refusal costs the whole week, not one pick.

## Pass 2 — ATS push, cover, non-cover

**Scenario:** `push-ats` · **League:** against the spread

1. The sheet asks for all three games; note the spread shown beside each side. Take
   **home** in both graded games — `push-ats-2`'s home side covers, `push-ats-3`'s
   wins outright without covering — so the week grades one of each alongside the
   push. Either side of `push-ats-1` does; it lands exactly on the number.
2. Submit → confirm.
3. Advance the clock past every kickoff → Sync scores → `/sim/settle`.

Assert:

- [ ] The exact push grades **Push**, worth **0.5**. Fixed, with no setting behind it
      — the Push/Tie Resolution league setting is gone (ADR-0018 decision 4), so
      there is no configuration under which this reads anything else.
- [ ] A graded push shows the **badge only** — no margin phrase beside it. ("pushing"
      is the *in-progress* wording; once graded, the badge is the whole verdict, and
      a push has no magnitude to state.)
- [ ] The cover reads `covered by 8`, the non-cover `short by 7` — the magnitude
      measured against the spread, not the scoreboard margin.
- [ ] Standings: **1.5** points from three picks, W-L-P `1-1-1`. The half point
      renders as a half point, neither rounded nor truncated.
- [ ] Both sides of a settled row carry the spread the pick was made **at** — the
      number settlement graded on — and it agrees with the margin phrase on the same
      row. A member should never see the number move under a made pick.

## Pass 3 — Straight-up tie

**Scenario:** `tie-game` · **League:** straight up

Two games, both required. A tie is a push with no spread involved.

Assert:

- [ ] Both games grade **Push** at 0.5, and neither shows a margin phrase.
      (`tie-game-2` is a spread-0 pick'em, so it is a tie and a push at once; in a
      straight-up league it is simply the tie.)
- [ ] No spread appears anywhere in a straight-up league — not on the sheet, not on
      the frozen week, not on League Picks.
- [ ] Standings read W-L-P `0-0-2` and **1** point from two picks — not 0, not 2.

## Pass 4 — Cancellation is a push, and the push stands

**Scenario:** `cancelled-game` · Either pick type

The highest-value pass in this document. Its whole member-visible surface is one
row's copy and one number on the board, and the state that produces it cannot be
reached with the clock.

> **The clock cannot cancel a game.** Cancellations and postponements are *announced*,
> not discovered at kickoff, so a fixture carrying one is terminal from the moment it
> loads — advancing time never produces one. Getting a *pick* onto a cancelled game
> therefore takes two syncs: submit while the game is still headed for `final`, then
> edit the fixture.

1. Load `cancelled-game` → Sync schedule + odds → clock to week 1, before the first
   kickoff. `cancelled-game-1` is *already* cancelled — leave it; it serves two
   assertions below.
2. My Picks: the sheet holds **two** rows, `cancelled-game-2` and `cancelled-game-3`,
   and asks for **two**.
3. Submit both → confirm.
4. Sim → Fixtures → set `cancelled-game-2`'s **final status** to `cancelled` →
   **Sync schedule.** (Schedule, not scores — scores fast-no-op when nothing is
   active, and a cancelled game never becomes active.)

Do not move the clock. `cancelled-game-3` is still unstarted, which is precisely the
state the deleted substitute flow used to key on.

Assert:

- [ ] The cancelled game's pick is **retained** and marked a push — never silently
      deleted.
- [ ] The row says why: the game was cancelled, the pick resolved as a push, and the
      member's other picks are unaffected.
- [ ] There is **no substitute control, no re-pick, and no way back into the week** —
      not on the row, not in the action bar, nowhere. The slot is spent (ADR-0018
      decision 3).
- [ ] The push **stands** with `cancelled-game-3` unplayed and unpicked-over. The old
      rule made the push conditional on the rest of the slate; this one does not.
- [ ] The standings credit the 0.5 within that one sync — no clock move, no
      `/sim/settle` — because `sync-schedule` re-settles the league-weeks holding
      picks on games whose status changed. W-L-P counts it in **P**.
- [ ] `cancelled-game-1` — cancelled before anyone could pick it — is **absent from
      the member's week entirely**, for both members. Not "visible but disabled": a
      game nobody holds and nobody can pick is dead weight on the screen, and a fresh
      pick on it would be free points.
- [ ] It never counted either: the sheet asked for two, not three.

## Pass 5 — Postponement is *not* cancellation

**Scenario:** `postponed-game` · **Run it once per pick type — the ATS run found a bug**

The trap: a postponed game looks like a cancelled one and behaves like neither. A
postponement inside the week is played later and resolves normally — so unlike a
cancellation it stays **pickable**, and this pass needs no fixture edit. The game
reads "Postponed" from the first sync; submit it with the rest, then advance past its
kickoff.

Assert:

- [ ] The sheet asks for **all three** games, the postponed one included. (Contrast
      Pass 4, where the cancelled game is neither shown nor counted. That difference
      is the whole pass.)
- [ ] The pick on the postponed game **stays**, and grades **nothing** — no result,
      no points, no W/L/P movement. It is pending, not pushed.
- [ ] Once its kickoff passes, the pick locks and is revealed to the other member
      like any other. Locking is derived from the kickoff, so a game that never
      starts still locks on time.
- [ ] Standings do not count it in either direction.

In an **ATS** league, additionally — this is where the pick type changes the answer,
and where a postponed game was unpickable until the odds sync learned about it:

- [ ] The postponed game **shows a spread**, the one its fixture declares. `sync-odds`
      prices every unstarted status, not only `scheduled`.
- [ ] It is pickable **and counted**: the sheet asks for three. A "No line yet" pill
      on it, a dead pair of buttons, and a required count of two mean the odds sync
      skipped it — the bug this pass exists to catch. Under submit-once the cost is
      higher than it was: an unpriced game doesn't merely block itself, it changes
      the size the whole week's one submission must match.

## Pass 6 — The spread moves under a submission

**Scenario:** `push-ats` (any ATS-capable one) · **League:** against the spread ·
**Fixture editor**

The one ATS path that overrides-driven testing cannot produce, because it needs the
line to move *between* load and submit. There is no re-pricing and no accept-latest
bar left to check: one write, one handshake (ADR-0018).

1. My Picks: assemble the **full** set. **Leave the page open.**
2. In another tab: Sim → Fixtures → edit one selected game's **spread** → Sync odds.
3. Back on the still-open page, Submit → confirm.

Assert:

- [ ] The submission is **refused** with a stale-spread message telling the member to
      review the new lines and submit again — not a generic failure.
- [ ] The page **refetches on its own** and the edited game now shows the new number
      on **both** sides. Nothing is held at an old line on an unsubmitted sheet:
      there is no pick yet, so there is no accepted number yet.
- [ ] The selections survive the refusal, so a second attempt is one click plus the
      confirmation — and it succeeds, storing the new spread.
- [ ] The frozen week shows that **new** number on the pick, which is what settlement
      will grade against.
- [ ] After the game finishes, the margin phrase agrees with the number on the same
      row (`covered by N` measured from the stored spread), never from whatever line
      the game carried later.
- [ ] Once the game kicks off, League Picks shows the pick at the same stored number
      — that surface reads the pick's spread too, so the two cannot disagree.

## Pass 7 — A settings change that destroys picks

**Any scenario** · a Pick'em league with a week submitted by both members

The only screen in the app that permanently destroys member data — and, under
submit-once, **the only way a member ever re-submits a week** (ADR-0018).

1. As commissioner, Settings → change **Picks per week**, and run it in *both*
   directions.

Assert:

- [ ] A **raise** invalidates exactly as a lowering does. Under submit-once nobody can
      add to a submitted week, so raising the cap without clearing would leave every
      member who had already submitted permanently undersized with no way to comply.
- [ ] An inline warning appears **before** saving, naming a real pick count and member
      count — not a generic caution.
- [ ] Confirming is required; cancelling changes nothing.
- [ ] The counts match what is actually deleted.
- [ ] A change that strands nothing — the league's name — raises **no** warning and no
      dialog.
- [ ] Changing **Pick type** warns the same way. So does moving **Season range** to a
      narrower preset (Full Season → Regular Season); widening it (Regular Season →
      Full Season) does not, because every existing pick still sits in a week the
      league plays.
- [ ] After saving, the members' weeks are open again: the sheet is back, and a
      **fresh full set** can be submitted. Not "re-pick within the new cap" — there is
      no partial edit, only another whole submission.
- [ ] Once any pick has **locked**, the same save is refused (`picks_locked`) and
      nothing changes — neither the settings nor the picks.

## Pass 8 — Season conclusion and renewal

**Scenario:** any · advance the clock past the season's last week

Conclusion is the easy half; renewal is where a multi-season bug would live
(ADR-0009).

Assert:

- [ ] A concluded season **refuses new picks** with a clear message ("This season is
      over — picks are closed."), rather than failing obscurely.
- [ ] Final standings remain readable after conclusion.
- [ ] The league offers **renewal** once a newer season row exists, to the
      commissioner only.
- [ ] A renewed league starts an **empty pick ledger** — last season's picks and
      standings do not carry over, and last season's remain reachable.

---

## What this runbook cannot reach

Stated so the checklist isn't mistaken for full coverage:

- **Real provider ingestion.** Every score here comes from a simulated provider or an
  override. The live `sync-scores` path — provider columns, real ESPN payloads —
  first runs for real on an actual game day.
- **A week move nobody reviews.** The operator note above is the entire mitigation
  (ADR-0019). There is no click that would have caught it, which is why the note is
  a procedure rather than a pass.
- **A known unreachable state.** A game can end up unlocked with its outcome already
  knowable, with no admin at fault: a legal later-kickoff override, then `sync-scores`
  writing a final score off the *provider* kickoff. Ingestion cannot consult the
  override guard by design. Detection and repair are filed against ADM-3.
- **Scale.** Every pass is 2 members over one week. Season-long accumulation, rank
  ties across a full season, and a 10-member league are untested by anything.

## Timing note — the offseason branch

`nflSeasonYearFor` maps **January–July** back to the prior season label, so through
those months `resolveRecurringSyncSeasonYear` takes its **roll-forward branch**: the
derived default has concluded, so recurring syncs target `default + 1`. From **August
1** the derivation returns the current year directly and that branch goes dormant
until January.

It is the branch whose absence made an ATS league unable to take any picks at all
(see PR #22). If you want to exercise it against the real clock rather than an
explicit `?season=`, that window is Jan–Jul.
