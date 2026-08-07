# Epic: Non-Functional Quality (QLTY)

Nothing here changes what the app does. Each task removes a tax the codebase is
currently charging on future work — an unjustified rule, a test that vetoes
redesign, a helper nothing calls.

Sequenced **after epic 12** on purpose: the simplification deletes a large share
of the brittle surface (the whole edit/re-price/substitute UI and the helpers
that support it), so decoupling those tests first would be work spent on code
about to be removed.

Ref: `.claude/rules/engineering.md` — §preamble (every rule states its why) and
§Quality (assert the outcome, never the process).

- [x] **QLTY-1** — Audit every rule in `.claude/rules/engineering.md` against the preamble's own bar: state the failure each prevents in a sentence, or delete it. Known candidates, none pre-judged — "Loose coupling", "A file that accretes unrelated responsibilities gets split", and "Prefer the latest stable versions" currently assert without justifying, and the `enum` ban states the prohibition but not the reason. Deleting a rule that turns out to be load-bearing is the risk to weigh, so the pass records *why* for keeps as well as cuts. _(deps: none)_
- [x] **QLTY-2** — Decouple the E2E suite from copy. The DOM-position half of this is already done: SIMP-14 rebound the standings assertions from `locator("td").nth(2..4)` to deliberate `data-testid`s, and no positional selector survives anywhere in `e2e/`. What remains is prose — `e2e/pickem-journey.sim.spec.ts` still names exact copy in roughly 67 places against 4 testids, so a rewording alone fails the merge gate for no product reason. Rebind to roles and accessible names, adding a testid only where a value must genuinely be located positionally. **Do this before the facelift, not after** — the facelift is the event this suite would otherwise block. _(deps: SIMP-14)_
- [x] **QLTY-3** — Prune the web component tests down to domain rules. `pickem-game-row.test.ts` is gone — the epic deleted it outright, so there is nothing left to prune there. The surviving surface is `pickem-picks.test.ts`, `pickem-standings-table.test.ts` and `pickem-week-detail.test.ts`, which are largely presentation policy — what a row shows, whether a control is offered, how a count is worded — which the owner changes at will and no test should freeze. Keep what encodes a rule (who may pick, what a member holds); drop what encodes a layout. The `lib/` unit tests are a separate question: `game.test.ts` and `standings.test.ts` sit on the line the rule draws between a domain answer and a layout answer, so decide each rather than sweeping the directory. _(deps: SIMP-15)_
- [x] **QLTY-4** — Right-size the E2E suite against "journeys, not branches": confirm every browser-level assertion is either a genuine cross-stack journey or a rule with no cheaper home, and push the rest down to `packages/scoring` or the API integration tests. The pickem journey — 586 lines after the epic, having grown rather than shrunk — is the one to weigh — it is the merge gate, so both over- and under-coverage are expensive. _(deps: QLTY-2)_

- [x] **QLTY-5** — A concrete, written stance on documentation and commenting, then a sweep to match it. `.claude/rules/engineering.md` §Quality currently governs two narrow points — comments explain why, and they cite durable IDs rather than a plan's internal numbering (the second added during LG-10, after `(Decision N)` and `(item N)` refs had accumulated across five files). Everything else is unstated and therefore inconsistent: exported functions mix `/** */` and `//` with no rule about which (`leagueHasStarted` vs `canActOnLeague`, one file apart); some modules carry header comments and some don't; there is no stated bar for when a decision earns an ADR versus a code comment versus a `docs/` page versus nothing; and no stance on comment density, which is what actually varies most between agent-authored files. Decide each, write it into the rules file with the failure each prevents (per the preamble's own bar), and sweep the two known stragglers — `(item 4/5 consolidation)` in `apps/web/src/components/league/members-section.tsx` and `apps/web/src/api/members.ts`. Ref: `.claude/rules/engineering.md` §preamble, §Quality. _(deps: none)_

## Technical plan

- QLTY-1..4: `docs/plans/qlty.md` (delivered — PR #32; closeout recorded there).
- QLTY-5: `docs/plans/qlty-5.md` (delivered — PR #35; review, evidence, and closeout recorded there).
