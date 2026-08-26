import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { PickOutcome } from "@picksleagues/schemas";
import { leagueMembers, leagueSeasons } from "./leagues";
import { games, teams, weeks } from "./sports";

/**
 * Survivor's own storage (spec §Game Mode 2): the weekly pick ledger, the
 * graded outcomes, and the settlement-maintained member state. ADR-0025 records
 * the design.
 *
 * Per-mode tables (arch D9, ADR-0016) rather than a share of Pick'em's: the
 * rules the database has to encode here are a *team* ledger and a life count,
 * and neither has a home in a shape built around one row per member per game.
 *
 * No `locked` column (arch D11) and no `.defaultNow()` (arch D13): lock state
 * derives from a game's kickoff against the injected Clock on every
 * read and every write, and every timestamp below is supplied by app code from
 * `clock.now()` so the simulator moves them with everything else.
 */

export const survivorPicks = pgTable(
  "survivor_picks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Keyed to the league's per-season instance (ADR-0009) — the team ledger is
    // scoped to one season, so a renewed league starts every team available
    // again rather than inheriting last season's consumption.
    leagueSeasonId: uuid("league_season_id")
      .notNull()
      .references(() => leagueSeasons.id, { onDelete: "cascade" }),
    leagueMemberId: uuid("league_member_id")
      .notNull()
      .references(() => leagueMembers.id, { onDelete: "cascade" }),
    /**
     * Restrict, matching `pickem_picks.week_id`: a live pick must be able to
     * block deletion of its week, or the schedule sync's convergence sweep
     * would drop the week out from under it.
     */
    weekId: uuid("week_id")
      .notNull()
      .references(() => weeks.id, { onDelete: "restrict" }),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "restrict" }),
    /** The team the member is riding this week — one of the game's two sides. */
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    /**
     * The team was handed back: a cancelled game's pick pushes and does **not**
     * consume the team (spec §Game Mode 2 — Cancelled game), so the row must
     * stop occupying the ledger while still recording what was picked. Written
     * only by settlement, which is what keeps the ledger a pure derivation
     * (arch D10); the pick write path only ever clears it on a fresh pick.
     */
    released: boolean("released").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // One pick per member per week (spec §Game Mode 2 — Core Rules). Also the
    // pick endpoint's upsert target, which is what makes "changeable until
    // kickoff" a replace rather than a second row.
    unique("survivor_picks_member_week_unique").on(
      table.leagueSeasonId,
      table.leagueMemberId,
      table.weekId,
    ),
    /**
     * The team ledger — "a member may pick each NFL team at most once per
     * league" (spec §Game Mode 2 — Team reuse), enforced by the database rather
     * than by an app check alone, which races: two concurrent writes can both
     * read a team as unconsumed.
     *
     * Partial on purpose. A plain unique would also block the *legitimate*
     * re-pick of a team a cancellation returned, since the released row would
     * still occupy the slot — the one case the spec explicitly allows.
     */
    uniqueIndex("survivor_picks_member_team_unique")
      .on(table.leagueSeasonId, table.leagueMemberId, table.teamId)
      .where(sql`not ${table.released}`),
    // Serves the week read path (every member's pick for a week).
    index("survivor_picks_season_week_idx").on(table.leagueSeasonId, table.weekId),
    // Serves a member's own history: their consumed teams and their board row.
    index("survivor_picks_member_week_idx").on(table.leagueMemberId, table.weekId),
    // Serves settlement's "which picks does this game resolve" lookup when a
    // single game goes final.
    index("survivor_picks_game_idx").on(table.gameId),
  ],
);

/**
 * Settlement's graded outcomes, completing the per-mode triple (ADR-0016,
 * ADR-0025). A pure derivation of (picks, results, settings) like every other
 * settlement output (arch D10): a full recompute must reproduce it exactly.
 *
 * **No points column, deliberately.** Survivor grades survive-or-eliminate and
 * has no ranking to feed (ADR-0016), so a points column would be one this mode
 * never writes — the shape that ADR rejected. The outcome vocabulary is the
 * shared `PICK_OUTCOME`, since correct/incorrect/push mean the same thing here
 * as in Pick'em; what the mode does with a push is Survivor's own rule.
 */
export const survivorPickResults = pgTable(
  "survivor_pick_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * The pick this grades. Cascades: a deleted pick has no result, and the
     * pick endpoint's upsert rewrites rows freely, so results must follow.
     */
    survivorPickId: uuid("survivor_pick_id")
      .notNull()
      .references(() => survivorPicks.id, { onDelete: "cascade" }),
    // Denormalized from the pick so a season replay can scope its delete
    // without joining through picks that may already be gone.
    leagueSeasonId: uuid("league_season_id")
      .notNull()
      .references(() => leagueSeasons.id, { onDelete: "cascade" }),
    leagueMemberId: uuid("league_member_id")
      .notNull()
      .references(() => leagueMembers.id, { onDelete: "cascade" }),
    weekId: uuid("week_id")
      .notNull()
      .references(() => weeks.id, { onDelete: "restrict" }),
    outcome: text("outcome").$type<PickOutcome>().notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // One result per pick — the constraint that makes re-settling idempotent
    // rather than additive.
    unique("survivor_pick_results_pick_unique").on(table.survivorPickId),
    index("survivor_pick_results_season_week_idx").on(table.leagueSeasonId, table.weekId),
  ],
);

/**
 * Who is still alive, and why they aren't (spec §Game Mode 2 — Core Rules).
 *
 * **Written only by settlement**, and a pure derivation of (picks, results,
 * settings) like every other settlement output (arch D10): a full recompute
 * must reproduce it exactly.
 *
 * **The absence of a row means alive with one life.** No path mints a row at
 * join time — doing so would make this state something the join path has to
 * maintain, and a rebuild would no longer be able to reproduce it from picks
 * and results alone. Every reader must treat a missing row as an untouched
 * member, never as an error.
 */
export const survivorState = pgTable(
  "survivor_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueSeasonId: uuid("league_season_id")
      .notNull()
      .references(() => leagueSeasons.id, { onDelete: "cascade" }),
    leagueMemberId: uuid("league_member_id")
      .notNull()
      .references(() => leagueMembers.id, { onDelete: "cascade" }),
    /**
     * Always 1 in the MVP — every member has exactly one life (spec §Game Mode
     * 2 — Core Rules). The column exists now because multi-life Survivor is the
     * deferred variant `docs/architecture.md` §Domain Model already names, and
     * adding it later would mean rewriting settlement's ledger rather than
     * reading a number it already carries.
     */
    livesRemaining: integer("lives_remaining").notNull().default(1),
    /**
     * The week the member busted in, or null while they are still alive. This
     * is the elimination test everything else reads — a member is eliminated
     * exactly when settlement has written a week here.
     */
    eliminatedWeekId: uuid("eliminated_week_id").references(() => weeks.id, {
      onDelete: "restrict",
    }),
    /**
     * How many times the everyone-out revival rule has brought this member back
     * (spec §Game Mode 2 — Everyone eliminated in the same week). Recomputed
     * with the rest of the ledger; display and audit only.
     */
    revivedCount: integer("revived_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // One ledger row per member per season instance — the constraint that makes
    // settlement's upsert idempotent rather than additive.
    unique("survivor_state_season_member_unique").on(table.leagueSeasonId, table.leagueMemberId),
  ],
);
