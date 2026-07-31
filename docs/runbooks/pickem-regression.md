# Runbook: Pick'em Manual Regression

A click-through pass over the Pick'em rules that automated tests reach least well:
the ones that live in the **browser**, across a **clock change**, or in a game that
does something other than kick off and go final.

Every pass below drives an existing library scenario (`docs/simulator-guide.md`
§Scenario library). Nothing here needs a new scenario or a hand-built fixture —
six of the seven were built for exactly these rules and are otherwise unused.

Read `docs/simulator-guide.md` first for the canonical workflow, week anchors, and
reset scopes. This runbook assumes it and does not restate it.

## What automation already covers — skip these

Manual time is worth spending where the safety net is thin. It is **not** thin here:

| Covered by                                                                        | So don't spend a manual pass on                                                     |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `packages/scoring` unit tests (table-driven, spec §Scoring is the test plan)       | Whether a cover/push/tie grades correctly in the abstract                            |
| `apps/api/test/settlement.test.ts`                                                  | Settlement idempotency, re-settling, the nightly sweep, concurrent settlement        |
| `apps/api/test/pickem-picks.test.ts`                                                | Lock 409s, cap enforcement, cross-week duplicates, ATS acceptance at the API         |
| `apps/api/test/standings-repick.test.ts`                                            | The re-pick endpoint's own rules and refusals                                        |
| `e2e/pickem-journey.sim.spec.ts` (`mixed-week`, **straight-up**, 2 members, 1 week) | The happy path: create → join → pick → lock → reveal → settle → standings            |

What is left over is this document.

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

---

## Pass 1 — ATS push, cover, non-cover

**Scenario:** `push-ats` · **League:** against the spread

1. Pick all three games; note the spread shown beside each.
2. Advance the clock past every kickoff → Sync scores → `/sim/settle`.

Assert:

- [X] The exact push grades **Push**, worth **0.5** on the default push/tie setting.
- [X] A graded push shows the **badge only** — no margin phrase beside it. ("pushed"
      is the *in-progress* wording; once graded, the badge is the whole verdict.)
- [X] The cover reads `covered by N`, the non-cover `short by N`.
- [X] Standings differential: the push contributes **0**, not the raw margin.
- [X] The spread rendered on the pick row matches the one stored against the pick
      after settlement — a member should never see the number move under a made pick.

## Pass 2 — Straight-up tie

**Scenario:** `tie-game` · **League:** straight-up

The pick type the E2E suite covers and manual testing has not. A tie is a push with
no spread involved.

Assert:

- [X] The tied game grades **Push** at the same 0.5, and shows no margin phrase.
- [X] No spread appears anywhere on the pick rows in a straight-up league.
- [X] Standings W-L-P counts the push in the **P** column, not as a loss.

## Pass 3 — Cancellation and the substitute flow

**Scenario:** `cancelled-game` · Either pick type

The highest-value pass in this document. This is ADR-0015's retention boundary, and
it has UI branches nothing automated renders.

> **The clock cannot cancel a game.** Cancellations and postponements are *announced*,
> not discovered at kickoff, so a fixture carrying one is terminal from the moment it
> loads — advancing time never produces one. Like a week move, it takes two syncs:
> pick the game while it is still headed for `final`, then edit the fixture.

Set **Picks Per Week to 1** for this pass so a single substitution is unambiguous.

1. Load `cancelled-game` → Sync schedule + odds. `cancelled-game-1` is *already*
   cancelled — leave it; it serves the last assertion below.
2. Pick **`cancelled-game-2`** (headed for `final`, so pickable).
3. Sim → Fixtures → set `cancelled-game-2`'s **final status** to `cancelled` →
   **Sync schedule.** (Schedule, not scores — scores fast-no-ops when nothing is
   active, and a cancelled game never becomes active.)

That leaves `cancelled-game-3` unstarted and unheld: the substitute target.

Assert:

- [X] The cancelled game's pick is **retained**, marked as a push, and is **not**
      silently deleted.
- [X] A **substitute** control is offered on it.
- [X] Substituting **replaces** rather than adds — the "N of M picks" count is
      unchanged afterward.
- [X] The confirm dialog says what the trade is: the push is given up, and the
      replacement scores only when its game finishes.
- [X] The substitute picker does not offer a game the member already holds, nor one
      already toggled-but-unsaved in the editor.
- [X] Declining to substitute leaves the push standing through settlement (spec:
      "If no unstarted games remain, the push stands").
- [X] `cancelled-game-1` — cancelled before anyone could pick it — is **absent from My
      Picks entirely** for both members. Not "visible but disabled": a game nobody
      holds and nobody can pick is dead weight on the screen, so `visibleGames` drops
      it (feedback round 6). A fresh pick on a cancelled game would be free points, and
      the row that would offer one doesn't exist.
- [X] After substituting, the standings drop the surrendered push **immediately** —
      before the replacement's game has played, and with no sync or settle in between.
      The board must never credit a pick the member no longer holds.

## Pass 4 — Postponement is *not* cancellation

**Scenario:** `postponed-game` · **Run it once per pick type — the ATS run found a bug**

The trap: a postponed game looks like a cancelled one and behaves like neither.
A postponement inside the week is played later and resolves normally — so unlike a
cancellation, it stays **pickable**, and this pass needs no fixture edit. The game
reads "Postponed" from the first sync; pick it directly, then advance past its kickoff.

Assert:

- [X] The pick on the postponed game **stays**, and grades **nothing** — no result,
      no points, no W/L/P movement. It is pending, not pushed.
- [X] **No substitute** is offered on it. (This is the difference from Pass 3, and it
      is correct: the game will be played.)
- [X] Once its kickoff passes, the pick is locked and revealed to other members like
      any other.
- [X] Standings do not count it in either direction.

In an **ATS** league, additionally — this is where the pick type changes the answer,
and where a postponed game was unpickable until the odds sync learned about it:

- [X] The postponed game **shows a spread**, the one its fixture declares.
- [X] It is **pickable**. A postponed game reading "no line yet", or a pick on it
      refused as `spread_unavailable`, means the odds sync skipped it — the bug this
      pass exists to catch. A game the slate calls pickable must never be one the
      write path always rejects.

## Pass 5 — A game that moves to another week

**Scenario:** `week-move` · Either pick type

No admin action can produce this — a week move is the *provider* repointing the game
(there is no `override_week_id`), so the simulator is the only way to see it.

A move is a game's week **changing between two syncs**, so the scenario is only step
one. Loading it does not move anything; you move a game with the fixture editor.

1. Load `week-move` → Sync schedule. Week 1 holds `week-move-1` (BUF/MIA) and
   `week-move-4` (SF/SEA, kicking off last). The scenario's own oddity,
   `week-move-3`, sits in week 2 despite a week-1 kickoff — that pins ingestion
   assigning by declared week, not by date. Leave it alone.
2. As a member, pick **`week-move-1` in week 1**. Leave `week-move-4` unpicked: it is
   the substitute target, and it exists for that.
3. Sim → Fixtures → edit `week-move-1`'s **week number** to 2 → **Sync schedule again.**
   That second sync is the move.
4. Sync scores → `/sim/settle`.

Assert:

- [X] The pick resolves as a **push** and is not lost.
- [X] Week 1's My Picks shows a dedicated row — *"Pick moved out of this week"* — since
      the game is no longer in that slate at all. Specifically **not** "No games synced
      for this week yet": a pick that moved out is absent from the slate by definition,
      so a week can be slate-empty and still owe the member their pick.
- [X] League Picks shows the same pick with the same explanation, not a blank row.
- [X] A **substitute** is offered, and `week-move-4` is an eligible target.
- [X] **The moved game is pickable again in its new week** (ADR-0017). Go to **week
      2**, where the game now lives, and pick it — it is accepted. You hold two picks
      on one matchup: week 1's settles as a push (its game left that week), week 2's
      grades normally. That is not a double-dip, because each cost a pick slot; the
      old behaviour refused it and left you one pick short of everyone else whenever
      the cap met the slate size.
- [X] Your week-2 cap is reachable. With Picks Per Week equal to the number of games
      in week 2, you can actually place all of them — the count in the action bar is
      not a number you're locked out of hitting.

## Pass 6 — The spread moves under a submission

**Scenario:** any, with an ATS league · **Fixture editor**

The one ATS path that overrides-driven testing cannot produce, because it needs the
line to move *between* load and submit.

1. Open My Picks and make selections. **Leave the page open.**
2. In another tab: Sim → Fixtures → edit one selected game's **spread** → Sync odds.
3. Back on the still-open page, press **Save picks**.

Assert:

- [ ] The save is **refused** with a stale-spread message that says to review and
      resubmit — not a generic failure.
- [ ] The page **refetches on its own** and now shows the new number.
- [ ] Resubmitting succeeds and stores the **new** spread.
- [ ] Every *other* unstarted pick is re-priced too — changing one pick re-prices the
      whole week (ADR-0015). A pick made at an old line must not keep it.

The same fixture edit, without submitting, covers how a moved line is *displayed* —
the ordinary case, since spreads drift all week:

- [ ] The **held** side keeps the spread you picked at. It must never show the new
      number: a highlighted button reads as "you picked this" whatever the copy
      beside it says.
- [ ] The **opposite** side shows the live number — taking it genuinely would cost
      that. The two sides disagreeing is correct here, and is what a moved line
      looks like.
- [ ] The row says so: *"Line moved to −6 — your pick holds −3.5."*
- [ ] The action bar reports it week-wide: *"N picks are at spreads that have moved."*
- [ ] An **Accept latest spreads** control appears in the bar, not on the row —
      accepting re-prices *every* unstarted pick, so a per-row button would state
      the opposite of what it does.
- [ ] **Switch that pick to the other team.** Both sides must now read the *live*
      number, and the "Line moved" note must disappear — the holding is being given
      up, so no old price is true about the row any more. The failure to watch for is
      the two labels trading places: the newly-picked side showing the **inverse** of
      the old line (`−3.5` rendering as `+3.5`) while the abandoned side takes the
      live one. Switching back restores the held/live split above.
- [ ] Accepting flips the held buttons to the new numbers, enables Save, and changes
      the line to *"Saving updates N picks to the latest spreads."*
- [ ] You never have to toggle a pick off and on to take a moved line. If that is the
      only way to enable Save, the accept control is missing or mis-gated.
- [ ] A **locked** pick shows the spread it was **made at**, never the live one.
      Cross-check it against the margin phrase on the same row ("covered by N"),
      which is computed from the stored number — the two must agree. They didn't
      before: the button showed the current line beside a margin measured from the
      old one.
- [ ] League Picks shows the same locked pick at the same stored number.

## Pass 7 — A settings change that destroys picks

**Any scenario** · Pick'em league with picks submitted by both members

The only screen in the app that permanently destroys member data.

1. As commissioner, lower **Picks Per Week** below what members hold (or flip pick type).

Assert:

- [ ] An inline warning appears **before** saving, naming a real pick count and member
      count — not a generic caution.
- [ ] Confirming is required; cancelling changes nothing.
- [ ] The counts match what is actually deleted.
- [ ] A change that would strand nothing (e.g. renaming the league) raises **no**
      warning and no dialog.
- [ ] After saving, members see their picks gone and can re-pick within the new cap.

## Pass 8 — Season conclusion and renewal

**Scenario:** any · advance the clock past the season's last week

Conclusion is the easy half; renewal is where a multi-season bug would live
(ADR-0009).

Assert:

- [ ] A concluded season **refuses new picks** with a clear message, rather than
      failing obscurely.
- [ ] Final standings remain readable after conclusion.
- [ ] The league offers **renewal** once a newer season row exists.
- [ ] A renewed league starts an **empty pick ledger** — last season's picks and
      standings do not carry over, and last season's remain reachable.

---

## What this runbook cannot reach

Stated so the checklist isn't mistaken for full coverage:

- **Real provider ingestion.** Every score here comes from a simulated provider or an
  override. The live `sync-scores` path — provider columns, real ESPN payloads —
  first runs for real on an actual game day.
- **A known unreachable state.** A game can end up unlocked with its outcome already
  knowable, with no admin at fault: a legal later-kickoff override, then `sync-scores`
  writing a final score off the *provider* kickoff. Ingestion cannot consult the
  override guard by design. Detection and repair are filed against ADM-3.
- **Scale.** Every pass is 2 members over 1–2 weeks. Cumulative differential, rank
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
