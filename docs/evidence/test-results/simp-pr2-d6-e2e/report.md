# simp-pr2 / D6 — SIMP-14 verification

Deliverable: the Pick'em merge-gate journey is rewritten for the collapsed rule
surface — every submission goes through the irreversibility confirmation, a
submitted week is read-only, a second submission is refused with
`already_submitted`, and two members level on points share a rank with nothing
rendered behind it.

- Repository: `picksleagues`, branch `feat/simp-pr2-rule-surface-collapse`
- Comparison point: `d1ce23e` (`chore(simp): claim SIMP-14`)
- Files changed: `e2e/pickem-journey.sim.spec.ts`,
  `apps/web/src/components/league/pickem-standings-table.tsx` (three cell
  testids), this report

---

## 0. `pnpm test:e2e` was NOT run — the journey is unverified at runtime

**Stated plainly, because everything below depends on it.** The Playwright suite
was not executed. It is human-gated by repository policy (`CLAUDE.md`: "Never run
`pnpm test:e2e` without explicit human approval"), and that approval was not
given for this work package. No screenshot, video, trace, or Playwright report
exists for this deliverable, and none is claimed.

Consequently **the rewritten journey has never been run in a browser.** It
typechecks, it lints, it is formatted, and every selector in it is traced below
to the markup that renders it — but "the assertions pass" is not something this
report asserts. The first real signal comes from the owner-approved run the
frontier orchestrator gates after this commit.

Two further caveats for whoever runs it:

- `playwright.config.ts` runs `*.sim.spec.ts` in a project that `dependencies`
  on the parallel `chromium` project, and Playwright **skips** a dependent
  project when its dependency fails. Check the journey reports `passed`, not
  `skipped`.
- Nothing else about the run changes: it drives the E2E database
  (`picksleagues_e2e`) and the E2E ports, not the dev stack.

No Vercel command was run. No proof-artifact root needed clearing: this
deliverable produced no screenshots or videos, so there was no stale UI evidence
to replace.

---

## 1. Gate output — every non-e2e gate, all green

Run in this order from the repository root, each exiting 0.

### `pnpm db:up` — exit 0

```
$ docker compose up -d db --wait
 Container picksleagues-db-1 Running
 Container picksleagues-db-1 Waiting
 Container picksleagues-db-1 Healthy
```

### `pnpm format` — exit 0

```
$ prettier --write .
```

Rewrapped `e2e/pickem-journey.sim.spec.ts` once (a chained locator); every other
file `(unchanged)`. The ~330-line listing is omitted.

### `pnpm lint` — exit 0

```
$ eslint .
```

No output.

### `pnpm typecheck` — exit 0

```
$ pnpm -r typecheck
Scope: 7 of 8 workspace projects
packages/schemas typecheck$ tsc
packages/schemas typecheck: Done
packages/scoring typecheck$ tsc
packages/db typecheck$ tsc
packages/core typecheck$ tsc
packages/scoring typecheck: Done
packages/core typecheck: Done
packages/db typecheck: Done
apps/api typecheck$ tsc
apps/web typecheck$ tsc -b
apps/web typecheck: Done
apps/api typecheck: Done
```

**`pnpm typecheck` does not cover `e2e/`.** It is `pnpm -r typecheck` over the
seven workspace packages, and `e2e/` is not one — nor does `eslint.config.js` use
a type-aware preset. Since this deliverable's only substantial file lives there,
the spec was typechecked directly with a throwaway config extending
`tsconfig.base.json` (`"lib": ["ES2023", "DOM"]`, `"include": ["e2e/**/*.ts"]`),
which reported **no diagnostics**. The temporary config was deleted; it is not
part of the commit. Closing the gap permanently is a repo-wide tooling change and
is not in this ticket's scope — raised as a risk in section 6.

### `pnpm test` — exit 0

```
$ vitest run --project unit

 RUN  v4.1.10 /Users/paulmacfarlane/code/picksleagues


 Test Files  27 passed (27)
      Tests  501 passed (501)
   Start at  22:11:27
   Duration  985ms (transform 1.54s, setup 0ms, import 3.69s, tests 290ms, environment 1ms)
```

### `pnpm test:integration` — exit 0

```
$ vitest run --project integration

 RUN  v4.1.10 /Users/paulmacfarlane/code/picksleagues


 Test Files  26 passed (26)
      Tests  474 passed (474)
   Start at  22:11:30
   Duration  25.53s (transform 553ms, setup 0ms, import 12.55s, tests 10.53s, environment 1ms)
```

Unchanged from D5 (501 / 474): this deliverable adds no unit or integration case.
The refusal and sizing matrices already live there and were deliberately not
ported into the browser.

### `pnpm contract:check` — exit 0

```
$ pnpm contract:generate && test -z "$(git status --porcelain -- openapi)" || (...)
$ pnpm --filter @picksleagues/api generate:openapi
$ tsx scripts/generate-openapi.ts && openapi-typescript ../../openapi/openapi.json -o ../../openapi/client/schema.d.ts
Wrote /Users/paulmacfarlane/code/picksleagues/openapi/openapi.json
openapi-typescript 7.13.0
../../openapi/openapi.json -> ../../openapi/client/schema.d.ts [67.3ms]
```

Regeneration is a no-op — no schema and no route changed.

### `pnpm --filter @picksleagues/web build` — exit 0

```
$ tsc -b && vite build
... 3565 modules transformed ...
dist/assets/schemas-B7sqQlGY.js                            112.12 kB | gzip: 30.28 kB
dist/assets/src-8XQVkclK.js                                192.13 kB | gzip: 44.41 kB
dist/assets/index-D2JiMbhA.js                              260.36 kB | gzip: 80.58 kB

built in 449ms
```

### `pnpm test:e2e` — **not run** (see section 0)

---

## 2. Selector traceability

This table substitutes for a run. Every role-and-name, testid, and text selector
in `e2e/pickem-journey.sim.spec.ts` is listed with the source line that renders
it. Line numbers are as of this commit.

### Pick entry and submission

| Spec | Selector | Renders at | Note |
|---|---|---|---|
| 71, 311-312, 370, 460-461, 482 | `getByRole("button", { name: <ABBR>, exact: true })` | `league/pickem-game-row.tsx:77-97` (`SideButton`) | `<Button>` with `{team.abbreviation}`; the `TeamLogo` images carry `alt=""` (`components/team-logo.tsx:52,61`), so the accessible name is the bare abbreviation. In a straight-up league `spread` is `null`, so nothing is appended (`:96`) |
| 78 | `getByRole("button", { name: "Submit picks" })` | `league/pickem-picks.tsx:341-343` | `AlertDialogTrigger render={<Button disabled={...} />}` with the text child `Submit picks` |
| 94 | `getByRole("alertdialog")` | `ui/alert-dialog.tsx:42` (`AlertDialogPrimitive.Popup`) | Base UI alert-dialog popup. The same locator is already exercised by `e2e/identity.spec.ts:127` |
| 94 | `...getByRole("button", { name: "Submit picks" })` inside the dialog | `league/pickem-picks.tsx:357-359` (`AlertDialogAction`) | Deliberately the same name as the trigger — the trigger is only ever resolved while the dialog is closed |
| 311-312, 482 | `.toBeDisabled()` on a side button | `league/pickem-game-row.tsx:274,281` | `SubmittedPickRow` passes bare `disabled`, unconditionally |
| 460-461 | `aria-pressed` | `league/pickem-game-row.tsx:80` | `aria-pressed={held}` |
| 442 | `getByText("In progress")` | `league/game-state.tsx:24-26` (`GameStatePill`), mounted from `pickem-game-row.tsx:251` | Renders only for `GAME_STATUS.IN_PROGRESS` |
| 443, 571 | `getByText("Locked")` -> count 0 | `league/pickem-game-row.tsx:255` | Last branch of the badge chain; an in-progress or graded pick takes the slot first |
| 454, 573 | `getByText("MIA 0 - BUF 0")` / `("MIA 17 - BUF 27")` (en dash in the spec) | `lib/game.ts:86-89` (`labelledScore`) via `gameStateLabel` (`:109-117`), rendered at `pickem-game-row.tsx:261` | Substring match — the element also carries the status lead |
| 459, 577 | `getByText("Your pick: BUF · tied")` / `("... · won by 10")` | `league/pickem-game-row.tsx:295-302`; phrasing from `lib/game.ts:225-237` (provisional) and `:194-201` (settled) | Rendered only once `isClosedToPicks(game)` (`:289`) |
| 475 | `getByText(/Kickoff (Today\|Tomorrow) /)` | `lib/format.ts:41-52` (`formatKickoff`) via `gameStateLabel` (`lib/game.ts:110`) | Reads `useAppNow()` (`pickem-game-row.tsx:216`), which is the server's clock |
| 570 | `getByText("Correct", { exact: true })` | `league/pick-outcome.tsx:63-77` (`PickOutcomeBadge`) mounted at `pickem-game-row.tsx:249` | `exact` is load-bearing: an inexact `getByText("Correct")` is case-insensitive and would also match `Incorrect` |
| 70, 310, 359, 441, 481, 569 | `locator("li", { hasText: "<AWAY> @ <HOME>" })` | `league/pickem-game-row.tsx:112` (`Matchup`), rows at `:157` / `:235` | Structural, and kept as-is from the previous journey: an `li` here is the game row, and the matchup text is the only stable identity a row has |

### Week/pick detail (League Picks)

| Spec | Selector | Renders at | Note |
|---|---|---|---|
| 122 | `getByTestId("member-picks-row")` | `league/pickem-week-detail.tsx:201` | Deliberate testid, with a comment saying it exists for these assertions |
| 132 | `locator("summary")` | `league/pickem-week-detail.tsx:202` | Native details/summary disclosure |
| 162 | `getByRole("link", { name: "League Picks" })` | `routes/_authed/leagues/$leagueId/route.tsx:95` | |
| 164 | `locator('[data-slot="card"]', { hasText: "Picks — Week 1" })` | `ui/card.tsx` `data-slot="card"`; title at `pickem-week-detail.tsx:114` | |
| 414, 504 | `getByText("N more picks in — not yet revealed.")` | `league/pickem-week-detail.tsx:249-252` | |
| 409-410, 415, 505, 542-543 | `locator("li")` inside a member row | `league/pickem-week-detail.tsx:240-242` (`PickRow` at `:284`) | Counting, so it works on a collapsed `<details>` |
| 506 | `toContainText("MIA")` | `league/pickem-week-detail.tsx:291` | The picked team's abbreviation leads the row |
| 551-552, 563-564 | `getByText("Correct"/"Incorrect", { exact: true })` | `league/pick-outcome.tsx:63-77` via `pickem-week-detail.tsx:301` | |
| 555-556 | `getByText(/^won by \d/)` / `(/^lost by \d/)` | `lib/game.ts:194-201` (`settledMarginLabel`), rendered in its own span at `pickem-week-detail.tsx:302` | Anchored, so only the standing span matches — not its parent |
| 562 | `locator("li", { hasText: "(MIA @ BUF)" })` | `league/pickem-week-detail.tsx:293-295` | The parenthesised matchup that follows the picked team |

### Standings

| Spec | Selector | Renders at | Note |
|---|---|---|---|
| 180 | `getByRole("row").filter({ hasText: <username> })` | `league/pickem-standings-table.tsx:215-221` (`<tr>`); the name comes from `UserIdentity` (`components/user-identity.tsx:79-82`) -> `identityLines` returns `primary = displayName` (`lib/user.ts:40`) | The journey mints `displayName === username`, so the filter matches the rendered name |
| 181-183 | `getByTestId("standings-rank" / "standings-record" / "standings-points")` | `league/pickem-standings-table.tsx:228-231, 244-247, 250-255` | **Added by this deliverable.** A `<td>` has no accessible name, so the only alternative was the column index this rewrite exists to remove |
| 181 | value `T-1` | `lib/standings.ts:23-25` (`rankLabel`), counts from `sharedRankCounts` (`:17-21`) | A shared rank renders `T-<rank>` |
| 185 | `getByRole("columnheader")` -> count 4 | `league/pickem-standings-table.tsx:181-210` (four `SortableHeader`s -> `<th scope="col">` at `:122`) | This is the "nothing behind the shared rank" assertion: a fifth column is where a differential would have to reappear |
| 386 | `getByText("Nothing has settled yet.")` | `league/pickem-standings-table.tsx:255` | The `lastUpdatedAt` fallback |
| 530 | `getByText(/^Last updated/)` | `league/pickem-standings-table.tsx:254` | |
| 388, 533 | `getByRole("combobox", { name: "View" })` | `league/pickem-standings-section.tsx:59-65` (`LabeledSelect label="View"`) | |
| 389, 534 | `getByRole("option", { name: "Week 1", exact: true })` | Options built at `pickem-standings-section.tsx:32-33` from `GET /leagues/{id}/weeks`; the label is the week's own (`Week 1`, `sim/scenarios/timing.ts:38`) | |
| 528, 535 | `locator('[data-slot="card"]', { hasText: "Standings" })` | `pickem-standings-section.tsx:40` | |

### League creation, invite, join, navigation

| Spec | Selector | Renders at |
|---|---|---|
| 246 | `getByRole("link", { name: "Create a league" })` | `routes/_authed/index.tsx:62` |
| 248 | `locator("#name")` | `routes/_authed/leagues/new.tsx` name input (`id="name"`) |
| 249 | `getByRole("button", { name: "Create league" })` | `routes/_authed/leagues/new.tsx:236` |
| 254, 264 | `getByRole("link", { name: "Members" })` | `routes/_authed/leagues/$leagueId/route.tsx:100` |
| 255 | `getByRole("button", { name: "Create invite link" })` | `league/invite-panel.tsx:165` |
| 256 | `getByRole("button", { name: "Revoke" })` | `league/invite-panel.tsx:106` |
| 261 | `getByRole("button", { name: "Join league" })` | `routes/join.$code.tsx:121` |
| 265-266 | `getByText("@<username>")` | `components/user-identity.tsx:84-86` via `identityLines` roomy variant (`lib/user.ts:41`) |
| 395 | `getByRole("link", { name: "Overview" })` + `aria-current="page"` | `routes/_authed/leagues/$leagueId/route.tsx:83` |

**No selector in the spec is untraced.** Everything above resolved to rendered
markup; nothing was left as a guess.

---

## 3. What the journey now proves, and what went

Kept as one journey through the stack, not a matrix of branches.

| Assertion | Where |
|---|---|
| Two members create/join a league | test 1 (unchanged) |
| A sheet three-quarters full cannot be submitted | test 2 — `expect(submitControl).toBeDisabled()` after 3 of 4 |
| Submission goes through the confirmation, and only its action writes | `submitSheet` helper — trigger -> `alertdialog` -> action |
| A submitted week is read-only **immediately**, with every game unstarted | test 2 — no submit control, both side buttons disabled |
| A required set smaller than the visible slate | test 3 — 4 rows, complete at 2, a third selection's controls dead |
| A submitted week shows only the member's picks | test 3 — the two passed-over games are absent |
| Picks are hidden behind a count before kickoff | test 4 (unchanged) |
| A kickoff locks and reveals one pick without a remount | test 5 (unchanged mechanics) |
| An unstarted game's pick is frozen too | test 5 — `DEN` disabled mid-week |
| A second submission is refused `already_submitted` | test 5 — direct API probe |
| Settlement, and two tied members sharing a rank with nothing behind it | test 6 |

### Deleted assertions, and why each went

| Deleted | Reason |
|---|---|
| `getByRole("button", { name: "Save picks" })` x5 | D5 renamed the control to **Submit picks**, and it now opens a confirmation instead of writing |
| `expect(saveButton).toBeDisabled()` after saving | A submitted week has no action bar at all — the button to disable no longer exists |
| `getByText("4 of 4 picks")` x3 | Copy binding for a state the browser can now show behaviourally (the control's enablement). `pickProgressLabel` is still rendered and still pinned by `apps/web/src/components/league/pickem-picks.test.ts`; D5's report claimed the e2e journey asserted that string literally, and after this commit it no longer does |
| `getByText("unsaved")` count 0 | There is no draft and no unsaved state — the sheet is local until the one write |
| `expect(openRow.getByRole("button", ...)).toBeEnabled()` | Inverted, not dropped: the same row is now asserted **disabled**, which is the rule that replaced it |
| `expect(refused...).toBe(ERROR_CODE.PICK_LOCKED)` | Still a real refusal, still pinned in `apps/api/test/pickem-picks.test.ts`, but no longer the *first* one this probe trips: `already_submitted` is checked ahead of every per-game rule (`services/pickem/picks.ts:387`) |
| `getByText("4 of 4 picks · this week is locked.")` and `("2 of 2 picks · ...")` | That copy is gone with the locked-week action bar |
| `commishRow.locator("td").nth(2..4)` x6 | The `Diff` column is gone, so `nth(4)` addresses nothing — and index-addressing a cell is the binding SIMP-14 was told to remove. Replaced by testids |
| `pushTieResolution: "half_point"` in the cap league's settings | The key no longer exists in `PickemSettingsSchema`; Zod was silently stripping it |
| The cap league's later clock-position re-reads | See section 4 |

---

## 4. The cap-2 league: kept, with a different reason

**Kept, and moved earlier.** Its old reason evaporated; a new one did not.

It used to be read at two clock positions, to prove that the *slate filter* kept
every game a member could still reach and dropped the one that kicked off without
a pick on it. Under ADR-0018 that reading is gone: the league is submitted, and a
submitted week renders the member's own picks at every clock position. There is
no filter left to observe changing, so both re-reads (formerly at `:451-454` and
`:536-541`) were deleted rather than adapted — they would have asserted the same
DOM twice for a reason that no longer exists.

What survives is the thing the equal-cap league **structurally cannot** reach,
and which no cheaper layer can show in a browser:

1. the sheet asks for `min(picksPerWeek, unlocked pickable)` — four rows on
   screen, complete at two — so a Submit that gated on rows-on-screen would
   never enable; and
2. a submitted week is a strict *subset* of its slate.

So the league is now created and driven **through the UI** in its own test, before
any kickoff, rather than seeded by a direct `PUT`. That also puts the cap's
member-visible edge on the record: once two are selected, a third game's controls
are disabled, so the member cannot assemble a set the API would refuse as
`too_many_picks`.

### Test 4 of the old file, reworked

The old *"with fewer picks than games, the slate keeps only what the member can
still reach"* rested on a premise the collapse deleted — its comment said "the
member can give one up and switch", which is now false in every league. Its
surviving content (all four open games are on the sheet even though only two can
be spent) is folded into the new cap-league test, where the member really is
still assembling. The late-submitter case it gestured at — a member whose
required set shrinks because a game kicked off before they submitted — is pinned
in `apps/api/test/pickem-picks.test.ts` and deliberately not brought into the
browser.

### The inverse-picks setup, restated honestly

The old comment justified inverse picks by the two members' **differentials**
being separated. There is no differential. The setup is kept, and changed, for a
reason that is true: each member now takes the winner of two games and the loser
of the other two, so they finish **level at 2 points with opposite margins**
(-7 and +7). That is precisely the pair the deleted `Diff` column used to
separate, which makes it the pair that proves ADR-0018 decision 4 — they share
rank `T-1`, with identical record and points and no column behind them. Opposite
sides also keep each member's picks distinguishable from the other's, which the
kickoff-gated visibility assertions depend on.

Expected settled state, derived from the fixture (`sim/scenarios/mixed-week.ts`):

| Member | Picks | Record | Points | Rank |
|---|---|---|---|---|
| Commissioner | BUF correct, DEN correct, PHI wrong, SEA wrong | 2-2-0 | 2 | T-1 |
| Joiner | MIA wrong, KC wrong, DAL correct, SF correct | 2-2-0 | 2 | T-1 |

Points from `packages/scoring/src/pickem.ts:90` (`CORRECT_POINTS = 1`); shared
ranking from `packages/scoring/src/standings.ts:81-92`.

---

## 5. The one production change

`apps/web/src/components/league/pickem-standings-table.tsx` gains three
`data-testid`s (`standings-rank`, `standings-record`, `standings-points`) on the
value cells, with a comment stating why they exist. No behaviour, no styling, no
markup structure changes.

This is the engineering rules' own prescription: *"Where a value genuinely must
be located positionally, give it a stable `data-testid` and bind to that — a
testid is a deliberate, greppable contract with the test, which is exactly what
an index into a `<td>` list is not."* A table cell has no accessible name, and
the assertion needed here is per-cell (rank, record, points on a named row), so
the alternatives were an index into `td` (the binding this ticket removes) or an
accessible-name hack on presentational cells.

---

## 6. Risks and places to check hardest

Ordered by how much a reviewer should doubt them.

1. **Nothing here has been executed.** Re-read section 0. Every item below is
   reasoning from source, not observation.
2. **`AlertDialogTrigger` disability.** `expect(submitControl).toBeDisabled()`
   assumes the `disabled` on the render element survives Base UI's prop merge.
   Traced: `DialogTrigger` destructures its *own* `disabled` (default `false`)
   and `useButton`/`useFocusableWhenDisabled` would set `disabled: false`, but
   `useRenderElement`'s `evaluateRenderProp` merges as
   `mergeProps(props, render.props)` — the render element's props last, so
   `disabled={true}` wins (`@base-ui/react@1.6.0`,
   `internals/useRenderElement.mjs`, `dialog/trigger/DialogTrigger.mjs`,
   `utils/useFocusableWhenDisabled.mjs`). If that reading is wrong the assertion
   **fails loudly** rather than passing falsely.
3. **The trigger and the dialog action share the name "Submit picks."** While the
   dialog is open, `getByRole("button", { name: "Submit picks" })` matches two
   elements and any strict-mode operation on it would throw. The helper only
   resolves it while the dialog is closed, and the post-submit `toHaveCount(0)`
   is count-based (no strict-mode violation) and retries until both the dialog
   action and the action bar are gone. This is the single most delicate piece of
   sequencing in the file.
4. **`getByText("Correct")` vs `"Incorrect"`.** `getByText` with a string is
   case-insensitive substring matching, so `"Correct"` matches `"Incorrect"`.
   Every such assertion passes `{ exact: true }`. Under the old inverse-picks
   split each member held only one of the two grades and the collision was
   invisible; with the 2-2 split it would have made the counts read 4 instead of
   2. Worth a reviewer's eye — a missed `exact` elsewhere is silent.
5. **In-progress score copy.** `lockedRow.getByText("MIA 0 - BUF 0")` (en dash in
   the spec) assumes the simulator holds an in-progress game at 0-0 — it did
   before this change; the assertion is carried over verbatim — and that the dash
   is the one `labelledScore` emits (`lib/game.ts:88`, U+2013). Both are
   unchanged from the passing version of this spec.
6. **`getByRole("columnheader")).toHaveCount(4)`** is a count, not a name — the
   nearest honest expression of "there is no fifth column". If a future board
   legitimately adds a non-separating column this fails and should be read as a
   prompt, not a regression.
7. **`e2e/` is not covered by `pnpm typecheck` or by type-aware lint.** This
   deliverable's main file therefore has no standing type gate; section 1 records
   the manual `tsc` run that stands in for one. Worth a small tooling ticket.
8. **Wall-clock cost.** The journey gains one league driven through the UI (the
   cap-2 league) and loses two API round-trips and two page loads; net cost is
   roughly one extra page load and four clicks.
