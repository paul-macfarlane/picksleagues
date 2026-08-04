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

- [ ] **QLTY-1** — Audit every rule in `.claude/rules/engineering.md` against the preamble's own bar: state the failure each prevents in a sentence, or delete it. Known candidates, none pre-judged — "Loose coupling", "A file that accretes unrelated responsibilities gets split", and "Prefer the latest stable versions" currently assert without justifying, and the `enum` ban states the prohibition but not the reason. Deleting a rule that turns out to be load-bearing is the risk to weigh, so the pass records *why* for keeps as well as cuts. _(deps: none)_
- [ ] **QLTY-2** — Decouple the E2E suite from copy and DOM position. `e2e/pickem-journey.sim.spec.ts` asserts standings by column index (`locator("td").nth(2..4)`) and matches exact prose in ~20 places; a rewording or a table re-layout fails the merge gate for no product reason. Rebind to roles, accessible names, and deliberate `data-testid`s. **Do this before the facelift, not after** — the facelift is the event this suite would otherwise block. _(deps: SIMP-14)_
- [ ] **QLTY-3** — Prune the web component tests down to domain rules. Post-simplification survivors of `pickem-picks.test.ts` / `pickem-game-row.test.ts` are largely presentation policy — what a row shows, whether a save bar is offered, how a count is worded — which the owner changes at will and no test should freeze. Keep what encodes a rule (who may pick, what a member holds); drop what encodes a layout. _(deps: SIMP-15)_
- [ ] **QLTY-4** — Right-size the E2E suite against "journeys, not branches": confirm every browser-level assertion is either a genuine cross-stack journey or a rule with no cheaper home, and push the rest down to `packages/scoring` or the API integration tests. The 543-line pickem journey is the one to weigh — it is the merge gate, so both over- and under-coverage are expensive. _(deps: QLTY-2)_
