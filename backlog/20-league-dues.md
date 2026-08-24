# Epic: League Dues (DUES)

Commissioners of leagues that play for money currently track who has paid in a
group chat or a spreadsheet. This epic gives them a ledger inside the league:
an optional flat dues amount per season, a commissioner-maintained paid/unpaid
flag per member, and a member-visible "who's paid" list. Money never moves
through the app.

Decisions (owner, 2026-08-23):

- **Optional by construction.** Dues are off until a commissioner sets an
  amount; a league that never collects sees no dues surface anywhere.
- **Track only.** No payment processing and no stored payment links or
  handles — money changes hands outside the app.
- **Flat amount + paid flag.** One amount per league season; each member is
  paid or unpaid, with when it was marked. No per-member amounts, no partial
  payments.
- **Everyone sees who's paid.** The list is visible to all members — social
  pressure does the collecting.
- **Informational only.** Unpaid status never blocks picking or anything
  else, and there are no nag banners.
- **Commissioner marks.** Only commissioners write the ledger; no member
  self-reporting.
- **Not in scope:** payouts (the pot going out stays outside the app);
  reminders/notifications (no in-app alerting — ADR-0007's line holds).

Shape constraints the tasks inherit: dues attach to the **league-season
instance** (ADR-0009), so renewal (SF-3) starts the next season's ledger empty
and must decide whether the amount copies forward with settings; marked-at
instants come from the injected Clock like every timestamp (arch D13); dues
are mode-agnostic, so their surfaces take generic names (the second-mode test
passes — Survivor uses them unchanged). The feature is post-MVP and
`docs/mvp-spec.md` / `docs/architecture.md` are locked at v0.4, so DUES-1
records the addition (ADR + doc touch) rather than silently deviating.

- [x] **DUES-1** — Dues schema + API: optional flat amount on the
  league-season, per-member paid ledger (paid flag + marked-at), commissioner-only
  mutations, member-readable status. Includes the ADR recording where the
  config lives and the SF-3 renewal behavior, plus the v0.4 doc touch.
  _(deps: none)_
- [x] **DUES-2** — Commissioner surface: set/clear the dues amount in league
  settings; mark members paid/unpaid from the members list. _(deps: DUES-1)_
- [x] **DUES-3** — Member surface: the "who's paid" view in the league —
  amount, each member's status rendered via `UserIdentity`, nothing rendered
  when dues are off. _(deps: DUES-1)_
