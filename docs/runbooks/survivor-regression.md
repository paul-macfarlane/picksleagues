# Runbook: Survivor Manual Regression

A click-through pass over the Survivor rules that automated tests reach least
well: the ones that live in the **browser**, across a **clock change**, or in a
game that does something other than kick off and go final.

**Unlike the Pick'em runbook, this one is a single continuous run.** Pick'em's
passes are independent because a Pick'em week answers for itself; a Survivor week
does not. The team ledger, elimination, the everyone-out revival and the ending
are all facts about a *season*, and settlement grades weeks prefix-ordered
against the alive set the previous week produced (ADR-0025). So the passes below
are stations on one four-week timeline, in the order the clock reaches them, and
running one out of order means arranging the state the previous ones left.

Everything drives one existing library scenario, `survivor-season`
(`docs/simulator-guide.md` §Scenario library) — weeks 15–18 of a real-shaped NFL
season, the shortest run that holds an elimination, a revival and a conclusion in
that order. Two of the passes hand-edit one fixture each; nothing here needs a
new scenario.

Read `docs/simulator-guide.md` first for the canonical workflow, week anchors,
and reset scopes. This runbook assumes it and does not restate it.

**Three rules shape everything below**, and a step that implies otherwise is
stale rather than the product. Survivor is **straight-up only** (ADR-0026): no
spread appears anywhere, and the Push/Tie Resolution setting rules on exactly one
thing, a tied final score. Its season range is the **whole regular season**,
resolved server-side rather than chosen (ADR-0024) — there is no range control on
the form. And a used team is **spent for the season**, except where a
cancellation hands it back (ADR-0025).

## What automation already covers — skip these

Manual time is worth spending where the safety net is thin. It is **not** thin
here:

| Covered by                                | So don't spend a manual pass on                                                                                                                                                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/scoring/src/survivor.test.ts`   | The grading matrix as a table: won/lost either side, a one-point win, a tie under **both** push/tie settings, and a cancelled game under both (push and team returned either way); missed-pick elimination; the everyone-out revival, including mixes of wrong picks, missed picks and a fatal tie; an incomplete week grading to nothing; an all-cancelled slate; idempotency and input purity |
| `apps/api/test/survivor-picks.test.ts`    | The refusal matrix (`pick_locked` both into and out of a started game, `game_not_pickable`, `team_not_in_game`, `team_consumed`, `member_eliminated`, a Pick'em league at the Survivor path, a week outside the range, a postseason week); that a save *replaces* rather than adds; that a released team is re-pickable; the ledger's partial unique index; and pick visibility at the endpoint — another member's team withheld until kickoff while the fact they picked is shown, and their consumed teams never leaked |
| `apps/api/test/survivor-settlement.test.ts` | Week completeness and prefix ordering (ADR-0025), a late correction cascading forward from the earliest affected week, the sticky-release rule surviving a reverted cancellation, override precedence in the input loader, settling twice landing identically, a full recompute reproducing the incremental path, the rebuild audit row, and the nightly sweep dispatching to Survivor |
| `apps/api/test/survivor-standings.test.ts` | The board's own refusals and visibility rules — a withheld team, consumed teams derived from revealed picks only, an eliminated member receiving the identical board — plus no last-updated stamp before settlement, the revived marker, and co-winners appearing only once the end week settles |
| `apps/api/test/leagues.test.ts` §`survivorPickStatus` | The dashboard glance's states: pick needed, still needed after the first kickoff while a later game is open, pick in, week closed, elimination reported ahead of a pick already in, and several Survivor leagues resolved in one payload                                                          |
| `e2e/survivor-journey.sim.spec.ts` (`survivor-season`, 3 members, 4 weeks) | The spine end to end: create through the form → join → pick → settle → eliminate → revive → co-winners, and the eliminated member getting a verdict rather than a sheet                                                                                    |

What is left over is this document: the same season in a real browser, with a
second window watching, and two fixture edits the clock cannot produce.

## Setup (once per run)

```
Reset → environment (drop it)          →  Scenarios → Load survivor-season
→  Admin → Jobs → Sync schedule        →  (no odds sync — ADR-0026, nothing reads a spread)
→  Create three leagues, join them     →  only then start moving the clock
```

**Create every league before the clock moves.** A Survivor league's start week is
the first week not already under way (ADR-0020 §The mid-week resolution rule), so
a league created at week 17 gets a two-week season and none of the passes below
fit it. Created against the freshly loaded scenario, all three resolve to weeks
15–18 — assert that first, because every pass rests on it.

The three leagues, all NFL Survivor:

| League          | Push / tie result       | Used by      |
| --------------- | ----------------------- | ------------ |
| **Main**        | Advance (team consumed) | Passes 1–2, 4–8 |
| **Tie-Advance** | Advance (team consumed) | Pass 3       |
| **Tie-Eliminate** | Eliminate             | Pass 3       |

Two leagues rather than one edited mid-run, because `edit_settings` is
`preStartOnly` (`packages/schemas/src/league-actions.ts`): once a Survivor league
has started, its tie rule is fixed, and putting the two answers side by side is
the only way to see them both.

**Three members**, named M1 (commissioner), M2 and M3 throughout. Two cannot hold
the states these passes need at once: a league whose entire alive set busts
revives all of it, so an elimination that *sticks* has to belong to someone who
was already out.

**Two browser windows, side by side — never two tabs in one window.** Two
accounts are the point to begin with: the pick-visibility rule (spec §Pick
Visibility) is a claim about what one member sees of another, and it cannot be
checked from a single session, so the second account needs its own browser
profile.

The windows matter beyond the accounts. TanStack Query refetches on
`visibilitychange` and on nothing else (`focusManager`, query-core 5.x): it has
no `focus`/`blur` listener, and treats itself as focused whenever
`document.visibilityState !== "hidden"`. A **tab** you switch away from goes
hidden and reloads the instant you come back — which silently repairs exactly the
stale view Passes 1 and 5 exist to inspect. Two **windows** both stay `visible`,
so neither refetches, and you can change the world in one while the other holds
what it held. Don't full-screen either window; an occluded window does go hidden.
To be certain, paste this into the watching window's console and confirm it stays
silent while you work in the other:

```js
document.addEventListener("visibilitychange", () => console.log("hidden:", document.hidden));
```

**Week anchors used below.** "Open week N" means the simulated clock an hour into
that week's window, before any of its kickoffs. "Play out week N" means past its
last kickoff plus the game window, then Admin → Jobs → **Sync scores**, then
`/sim/settle`. The score sync already settles a game's picks as it goes final;
`/sim/settle` is the full rebuild on top, and its `weeks` count is how far the
season has actually got — under prefix ordering that number is the season's
progress, not a per-run total.

---

## Pass 1 — One team, changeable until it kicks off

**Week 15** · **Main** · **both windows**

Survivor has no submission ceremony and no frozen-week screen: ADR-0018's
one-shot semantic is Pick'em's alone. What it has instead is a single sheet whose
Save replaces, and a lock that arrives per *game* rather than per week.

1. M1 → My Picks, week 15. Take **BUF** (the first kickoff) → Save.
2. Change to **DAL** → Save. Change back to **BUF** → Save. Reload.
3. M2 → My Picks, week 15. Take **KC** (the second kickoff) → Save.
4. M3 picks nothing at all, and keeps picking nothing. Pass 2 collects them.
5. Advance the clock to **one minute past BUF's kickoff only** → Sync scores.

Assert:

- [x] The sheet asks for **one** team, states the two rules that govern it —
      changeable until that team's game kicks off, each team once all season — and
      shows every game, including ones already closed. Pick'em filters started
      games off its sheet; this one must not, because with a single pick to place,
      a member scanning for a team needs to see that its game has gone rather than
      find it missing.
- [x] Saving replaces rather than adds. After BUF → DAL → BUF and a reload, the
      sheet holds exactly BUF (`aria-pressed`), DAL is unpressed, and there is no
      second pick anywhere.
- [x] The action bar reads `<team> selected — not saved yet` while a change is
      held and `Your pick: <team>` once it lands, and **Save pick** is disabled
      when there is nothing to save. The label never changes to a spinner.
- [x] In M2's **still-open** window — never focused away, never reloaded — M1's
      row is exactly as it was before M1 picked. Reload it and the row gains a
      **Pick history (1)** disclosure whose week-15 entry reads *Hidden until
      kickoff*, with **No picks revealed yet** where the used teams go. The league
      learns that M1 is in, not who they took.
- [x] Once BUF kicks off, M1's whole sheet freezes: the Save control is **gone**,
      not disabled; **every** team control on the week is disabled — including
      teams in games that have not kicked off — and each carries its reason in its
      accessible name (`Bills, this week's pick is locked in`). The pick on record
      is still visibly the one they took.
- [x] The freeze is **per member, not per week**. In the same instant M2's sheet
      is still live: BUF is disabled (`this game has kicked off`) while KC is
      enabled, because M2's own game is still ahead. Lock state is derived from
      each game's kickoff, never stored (arch D11).
- [x] The started game reads its live state on the row (`Q1 14:42 · MIA 0 – BUF
      0`), and every kickoff is shown in the member's own timezone.

## Pass 2 — A member who never picks

**Week 15, settled** · **Main**

The elimination automation reaches perfectly and the browser reaches only here:
what the board *says* about someone who simply never showed up.

1. Play out week 15 → `/sim/settle`.

Assert:

- [x] Before settlement the board's stamp reads **Nothing has settled yet.**;
      after it, **Last updated \<instant\>**. The board never claims freshness it
      does not have.
- [x] M3, who submitted nothing, is **Out in Week 15** — a missed pick eliminates
      exactly as a wrong one does (spec §Game Mode 2).
- [x] M3's row carries **No picks revealed yet** to everyone else and **You
      haven't used any teams yet** to M3 — an empty ledger on someone else's row
      means nothing was revealed, which is not the same claim as nothing was
      picked, and the row must not conflate them.
- [x] M1 and M2 read **Alive**, each with one team in **Teams used** and a
      week-15 history entry graded **Correct**.
- [x] Every pick in the week is now revealed to every member, the two the viewer
      doesn't own included. Reveal is per game and the week's games have all
      kicked off.
- [x] There is **no rank column and no points total** anywhere on the board
      (ADR-0016). The question it answers is who is left.
- [x] M3's dashboard glance reads **Eliminated** without opening the league.

## Pass 3 — A tie, under both settings

**Week 15** · **Tie-Advance and Tie-Eliminate** · **fixture editor**

The one league setting Survivor still has, and the only pass that needs two
leagues. The grading is pinned in `packages/scoring`; what is not is that the
*same* verdict word produces two different fates on screen, and that the
commissioner's one control is the thing that decides which.

> **The clock cannot produce a tie**, any more than it can produce a
> cancellation: a scenario's final score is declared by its fixture. Edit the
> fixture *before* the game goes final, or the ingested score is already written.

1. In both tie leagues, M1 takes **DAL** and M2 takes **KC**, week 15.
2. Sim → Fixtures → week 15 → `survivor-season-15-3` (PHI @ DAL) → final score
   **24–24**.
3. Play out week 15 → `/sim/settle` for each league.

Assert:

- [x] The create form's Survivor fieldset offers **exactly one** setting —
      Push / tie result, Advance (team consumed) vs Eliminate. No pick type
      (ADR-0026) and no season range, which reads instead as a sentence: *Regular
      season, through week 18 — starting at the first week that hasn't kicked off
      yet* (ADR-0024).
- [x] In **Tie-Advance**, M1's week-15 entry grades **Push**, M1 stays **Alive**,
      and **DAL is in Teams used** — advancing costs the team anyway.
- [x] In **Tie-Eliminate**, the same fixture and the same pick grade **Push**
      again — the badge names what the game did — but M1 is **Out in Week 15**.
      The badge and the status pill are answering different questions, and a
      reader must be able to tell which is which.
- [x] The eliminate league's board puts the surviving member **first** and the
      eliminated one below, whatever order the roster is in.
- [x] Neither league's tie touches the other, and neither touches Main, whose
      members held no stake in that game.

## Pass 4 — The ledger, and whose ledger it is

**Week 16** · **Main** · **both windows**

The one rule a Survivor member has to carry in their head all season, so the
screen has to carry it for them.

1. Open week 16. Read every team control in both windows.

Assert:

- [x] M1's **BUF** is disabled and reads `Bills, already used this season` in its
      accessible name, with a visible **used** marker beside the abbreviation. A
      dimmed button alone does not distinguish *spent* from *kicked off*, and the
      two are different problems.
- [x] **MIA, in the very same game, is still enabled.** The ledger is about the
      team, not the fixture.
- [x] M2's sheet disagrees with M1's, correctly: **BUF is enabled** for M2 and
      **KC** is the one disabled. One member's ledger constrains that member and
      nobody else — a ledger leak here would also be a visibility leak, since it
      would state which teams a rival has spent.
- [x] Neither sheet shows a spread anywhere (ADR-0026).

## Pass 5 — A cancellation hands the team back

**Week 16** · **Main** · **fixture editor**

The highest-value pass in this document, and the only place the sticky-release
rule (ADR-0025) is member-visible. A returned team is the one exception to
"a used team is spent", and its whole surface is one row's state and one absence
from a list of pills.

> **Two syncs, and the order matters.** A cancellation is *announced*, not
> discovered at kickoff, so a fixture carrying one is terminal from the moment it
> loads — advancing time never produces one. Getting a *pick* onto a cancelled
> game therefore means picking it while it is still headed for `final`, then
> editing the fixture. Use **Sync schedule**, not scores: scores fast-no-op when
> nothing is active, and a cancelled game never becomes active.

1. Week 16: M1 takes **SF** (the last kickoff), M2 takes **DAL** (the third).
2. Advance the clock past **DAL's kickoff but not SF's** → Sync scores.
3. Sim → Fixtures → week 16 → `survivor-season-16-4` (SEA @ SF) → final status
   **cancelled**, both scores cleared → **Sync schedule**.
4. Play out week 16 → `/sim/settle`.

Assert:

- [x] At step 2, reveal is **per game**: M1 sees M2's DAL named, while in M2's
      window M1's week-16 entry still reads *Hidden until kickoff*. One member's
      pick becoming visible must not drag another's out with it.
- [x] The `Sync schedule` response reports `cancellations: 1` and re-settles the
      affected league season in the same run.
- [x] M1's pick is **retained** on the cancelled row: the **Your pick** pill is
      still there, the row's state line reads **Cancelled**, and both of its team
      controls are disabled reading `this game was cancelled`. The pick is never
      silently deleted.
- [x] With every other game of the week already kicked off, the sheet says so —
      **This week is closed — no games are still open to pick** — and offers no
      Save. There is no substitute flow to find.
- [x] After settlement M1's week-16 entry grades **Push** and M1 stays **Alive**.
- [x] **SF is absent from M1's Teams used**, while BUF from week 15 is still
      there. That absence is the entire rule: a game that was never played cannot
      spend a team.
- [x] The board still shows **SF** as the team of the week-16 entry. The pick is
      kept and named; only the ledger entry is undone.

## Pass 6 — The eliminated member's league

**Week 16** · **Main** · **M3's window**

A view no other surface in the app has: total visibility with nothing to do.

Assert:

- [x] M3's My Picks is a **card, not a disabled sheet** — "You're out", stating
      that they can still follow the league. A greyed sheet would imply a pick
      that could still be made if something changed, and nothing will.
- [x] There is **no Save control at all**, and no team button anywhere on the
      week.
- [x] The **week selector stays operable**, so an eliminated member can still walk
      the season.
- [x] The card **states the consequence and claims no cause**: "You're eliminated
      for the season, so there are no more picks to make." A missed pick
      eliminates exactly as a losing one does, and this surface cannot tell them
      apart, so naming a cause here can only be wrong for one of them. See
      §Defects found on the first pass.
- [x] M3's board is the **same board** an alive member gets: every revealed pick,
      every used team, every status — no reduction, no extra.
- [x] M3's dashboard glance reads **Eliminated**, and elimination is reported
      ahead of anything else that week could have said.

## Pass 7 — The released team re-picked, and everyone out at once

**Week 17** · **Main** · **both windows**

Two rules that only exist in a season: that a returned team is genuinely usable
again, and that a league which busts entirely does not simply end.

1. Open week 17. M1 takes **SF** → Save — the team the cancellation handed back.
2. M1 changes to **SEA** → Save. M2 takes **BUF**. Both lose this week.
3. Play out week 17 → `/sim/settle`.

Assert:

- [x] **SF is enabled on M1's week-17 sheet** and carries no *used* marker, while
      BUF and SEA behave normally. The release is not cosmetic: saving SF
      **succeeds**, with no refusal toast.
- [x] M2 can take **BUF** in the same week M1 cannot. Still true three weeks in.
- [x] Both members' picks lose, so the whole alive set busts — and both come back
      **Alive** carrying a **Revived** pill (spec §Game Mode 2 — everyone
      eliminated in the same week).
- [x] Only the life comes back. **SEA and BUF stay in Teams used**, and both
      week-17 entries stay graded **Incorrect**. The revival rewrites no history.
- [x] M3, already out when the week began, is **not** revived and carries no
      revived marker. The rule reaches the set that busted together, not the
      league.
- [x] The board is not concluded yet, and nobody is a winner.

## Pass 8 — The ending

**Week 18** · **Main**

Conclusion is the only thing that turns a Survivor board into a result, and
co-winners are the answer rather than a tie to break (spec §End of League).

1. Open week 18. M1 takes **SF**, M2 takes **DEN**. Both win.
2. Play out week 18 → `/sim/settle`.

Assert:

- [x] The board's own description changes to say the season is over and everyone
      still standing shares first.
- [x] Both survivors read **Co-winner** and carry their **Revived** pill
      alongside it — surviving does not erase having been brought back.
- [x] M3 is still **Out in Week 15** and is **not** a winner.
- [x] Each member's **Teams used** is exactly the teams their played picks spent —
      four for M2, three for M1, whose cancelled week spent none.
- [x] The full pick history reads back per week with its grade, for every member,
      to every member.
- [x] The final week's frozen sheet does not promise a week that does not exist:
      it reads "Your pick has kicked off, so this week is set." and stops there.
      See §Defects found on the first pass.

---

## Defects found on the first pass

Both were found by running this runbook the first time, and both were fixed in
the same change that added it. Recorded rather than deleted, because what a
manual pass is *for* is the class of fault no suite was ever going to catch:
neither changed a stored outcome, both told a member something untrue about
their own season, and no assertion at any cheaper layer was ever going to look
at a sentence.

- **The eliminated-week card named a cause it could not know.** `EliminatedWeek`
  rendered "One of your picks lost, so you're eliminated for the season" for
  every elimination — including a member eliminated for a **missed** pick, who
  never had a pick to lose. The board on the same screen was correct; only the
  member's own card misstated it. Now states the consequence and names no cause.
  (Pass 6.)
- **The frozen-week line promised a week that did not exist.** "Come back next
  week" was unconditional, so it also rendered in the final week of a league's
  resolved range. The sheet holds one week and cannot see whether another
  follows, so the sentence is gone. (Pass 8.)

Both corrections are copy in
`apps/web/src/components/league/survivor-picks.tsx`. The assertions above are
checked against the corrected components by source inspection; the stack was not
driven a second time to re-observe two sentences. The next full pass re-proves
them the ordinary way.

## What this runbook cannot reach

Stated so the checklist isn't mistaken for full coverage:

- **A whole real season.** Every pass is 3 members over four weeks. Eighteen weeks
  is where a ledger genuinely runs out of teams — the state in which a member has
  nothing legal left to pick has no fixture here and no pass anywhere.
- **Changing out of a cancelled game while the week is still open.** A pick's own
  game never kicks off if it is cancelled, so `pick_locked` never fires and the
  sheet stays live — a member can abandon the push and take another team, as long
  as some game in the week is still open. Pass 5 cancels the *last* game of its
  week, so the push stood and this branch went unexercised. Neither the runbook
  nor any suite asserts it in either direction.
- **Real provider ingestion.** Every score is a simulated provider's or an
  override's. The live `sync-scores` path first runs for real on an actual game
  day.
- **A settings change on a running league.** `edit_settings` is `preStartOnly`, so
  the tie rule is fixed at creation and Pass 3 uses two leagues to see both
  answers. Whether a *pre-start* Survivor settings edit behaves is the settings
  pass in `docs/runbooks/pickem-regression.md`, not this one.
- **Postponement.** A postponed game stays pickable and resolves later, so
  Survivor inherits the Pick'em behaviour with nothing mode-specific about it;
  `postponed-game` is a one-week fixture and a Survivor league built on it has no
  season to carry the consequence into.
- **A revival that isn't the whole league.** The everyone-out rule only fires when
  the *entire* alive set busts, which in a three-member league means two people.
  Whether a twelve-member league ever reaches that state in practice is an
  unanswered question about the mode, not about the code.
- **Renewal into a second season.** `survivor-season` ingests four weeks of one
  year; the next-season path (ADR-0009) is exercised in the Pick'em runbook and
  nothing in Survivor's ledger is known to differ.
