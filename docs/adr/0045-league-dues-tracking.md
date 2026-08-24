# 0045. League dues: a per-season column and a presence ledger, tracking only

- **Status:** Accepted
- **Date:** 2026-08-23
- **Related:** mvp-spec.md §Leagues, §Commissioner Powers; architecture.md §Domain Model, D9, ADR-0009; `backlog/20-league-dues.md` (DUES-1)

## Context

Leagues that play for money track who has paid outside the app. The owner
scoped a tracking-only feature (2026-08-23): one flat whole-dollar amount per
league, commissioner-marked paid/unpaid, visible to every member, with no
payment rails, no payouts, no enforcement, and no reminders. Dues are optional
— most leagues won't set them — and the feature is post-MVP, so where its
state lives needed deciding against two locked structures: the per-mode
settings JSONB on `league_seasons` (ADR-0009), and the per-season instance
model itself.

Three placements were considered for the amount: a key inside each mode's
settings schema, a new mode-agnostic settings envelope, or a plain column on
`league_seasons`. The settings JSONB fails twice over: its shape is per-mode
(dues would be restated in three schemas, violating the second-mode naming
test in reverse), and settings lock at league start under `EDIT_SETTINGS`,
while dues are informational and must stay editable all season — money is
collected in week 3 too.

## Decision

- **`league_seasons.dues_amount`** — nullable integer, whole US dollars;
  null = the league doesn't track dues and no dues surface renders. Per
  instance, like everything per-year, so renewal copies it forward with the
  settings and each season is asked about independently.
- **`league_dues_payments`** — the ledger. A row means paid; `created_at`
  (Clock-supplied, arch D13) is the marked-at instant; there is no flag column
  to drift from row presence. Keyed `(league_season_id, user_id)` unique:
  by *user* so a leave-and-rejoin keeps the mark, by *instance* so renewal
  starts the next season's ledger empty by construction rather than by a
  cleanup job.
- **`MANAGE_DUES`** joins the `LEAGUE_ACTION` matrix: commissioner-only, no
  window. Marking a member paid while `dues_amount` is null is refused
  (`dues_not_enabled`, 409) — the mark would be invisible everywhere.
- **Clearing the amount keeps the ledger — but takes it off the wire.**
  Off-and-on again restores who had paid (forgetting real-money facts on a
  settings toggle is the worse failure), yet while dues are off every
  `duesPaidAt` serializes null: retained marks are held back in serialization,
  never left for the client to filter (evaluator finding, 2026-08-23 — the
  response is the visibility boundary for dues as for picks).
- **Wire shape rides the league read**: `duesAmount` on `LeagueResponse`,
  `duesPaidAt` on `LeagueMember`. Every member already receives both, which
  *is* the visibility rule — no separate endpoint, no commissioner-scoped
  field.

## Consequences

- Dues never touch scoring, settlement, locks, or pick paths — an unpaid
  member is refused nothing. The whole feature can be deleted by dropping a
  column, a table, and one route file.
- A rejoining member's paid mark survives, and an ex-member's mark stays in
  the ledger invisibly (serialization joins current members). If membership
  churn mid-season ever matters to the money, the ledger has the history.
- Whole dollars can't express $12.50 dues; accepted (owner, 2026-08-23) —
  widening to cents would be a column change plus a display pass, triggered by
  a real league needing it.
- The dues mutations take `lockLeagueRow` so a concurrent renewal can't strand
  a write on a just-superseded instance — the same serialization every
  membership mutation already uses.
