import {
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { PickemPickSide, PickOutcome } from "@picksleagues/schemas";
import { leagueMembers, leagueSeasons } from "./leagues";
import { games, weeks } from "./sports";

/**
 * Pick'em's own storage — picks and the settlement output derived from them.
 *
 * Per-mode pick storage (arch D9): Pick'em gets its own table rather than a
 * polymorphic `picks` row, so the DB can encode the rules — one pick per
 * member per game is a unique constraint here, not an app-level check.
 *
 * No `locked` column by rule (arch D11): lock state derives from the game's
 * effective kickoff against the injected Clock on every read and every write.
 * All timestamps come from app code via the Clock (arch D13) — no
 * `.defaultNow()`.
 */

export const pickemPicks = pgTable(
  "pickem_picks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Picks key off the league's per-season instance (ADR-0009) — a renewed
    // league starts an empty pick ledger rather than inheriting last season's.
    leagueSeasonId: uuid("league_season_id")
      .notNull()
      .references(() => leagueSeasons.id, { onDelete: "cascade" }),
    leagueMemberId: uuid("league_member_id")
      .notNull()
      .references(() => leagueMembers.id, { onDelete: "cascade" }),
    /**
     * The week the pick was *made in*, denormalized from the game deliberately.
     * When a game moves to another week the game's own `week_id` follows it,
     * and the divergence from this column is what identifies the spec's "moved
     * to a different week → treated as a cancellation" case (ADR-0007 — no
     * pick-flag state is stored).
     *
     * The divergence is only data, not behavior: the settlement input loader
     * (PKM-4) is responsible for turning it into `status: moved` before calling
     * `settlePickemWeek`, which never sees a pick's week. See that function's
     * caller-obligation note.
     */
    weekId: uuid("week_id")
      .notNull()
      .references(() => weeks.id, { onDelete: "restrict" }),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "restrict" }),
    side: text("side").$type<PickemPickSide>().notNull(),
    /**
     * The home-relative spread accepted at pick time — the spread of record for
     * this pick (arch §Spread strategy). Null in straight-up leagues, where no
     * spread applies.
     */
    spreadAtPick: doublePrecision("spread_at_pick"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // A member picks a given game at most once (spec §Core Rules) — the
    // batch-upsert endpoint's replace semantics rely on this holding.
    unique("pickem_picks_member_game_unique").on(table.leagueMemberId, table.gameId),
    // Serves the per-week read/replace path (own picks, others' picks) and the
    // picks-per-week cap count.
    index("pickem_picks_season_week_idx").on(table.leagueSeasonId, table.weekId),
    index("pickem_picks_member_week_idx").on(table.leagueMemberId, table.weekId),
    // Serves settlement's "which picks does this game resolve" lookup when a
    // single game goes final.
    index("pickem_picks_game_idx").on(table.gameId),
  ],
);

/**
 * Settlement output (arch D10). Both tables are **pure derivations** of
 * (picks, results, settings): a full recompute must reproduce them exactly, and
 * the incremental path settlement takes on a game going final is an
 * optimization, never a source of state a rebuild couldn't rederive. Nothing
 * here may be written by any path that isn't recomputable.
 *
 * Per mode, not shared — ADR-0016 records the deviation from arch D9's shared
 * `pick_results`/`standings`. The shape here is Pick'em's: points, a margin
 * differential, and one ranked row per member per scope. Elimination's board is
 * a survivor ledger (`elimination_state`) and March Madness wants one row **per
 * bracket**, up to 10 per member — neither fits, and forcing them to would cost
 * the constraints that make this table's rules DB-enforced. The reuse the fork
 * preserves is `packages/scoring`'s mode-agnostic ranking, not the tables.
 */

export const pickemPickResults = pgTable(
  "pickem_pick_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * The pick this grades. Cascades: a deleted pick has no result, and the
     * batch pick endpoint replaces rows freely, so results must follow.
     */
    pickemPickId: uuid("pickem_pick_id")
      .notNull()
      .references(() => pickemPicks.id, { onDelete: "cascade" }),
    // Denormalized from the pick so a season/week rebuild can scope its delete
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
    points: doublePrecision("points").notNull(),
    /** Cumulative-margin tiebreaker input (spec §Tiebreakers); 0 on a push. */
    differential: doublePrecision("differential").notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // One result per pick — the constraint that makes re-settling idempotent
    // rather than additive.
    unique("pickem_pick_results_pick_unique").on(table.pickemPickId),
    index("pickem_pick_results_season_week_idx").on(table.leagueSeasonId, table.weekId),
  ],
);

export const pickemStandings = pgTable(
  "pickem_standings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueSeasonId: uuid("league_season_id")
      .notNull()
      .references(() => leagueSeasons.id, { onDelete: "cascade" }),
    leagueMemberId: uuid("league_member_id")
      .notNull()
      .references(() => leagueMembers.id, { onDelete: "cascade" }),
    /**
     * Null on the season-cumulative row, set on a weekly one — the spec's two
     * parallel leaderboards (§Standings) in one table, since they carry
     * identical columns and are always rebuilt together.
     */
    weekId: uuid("week_id").references(() => weeks.id, { onDelete: "restrict" }),
    points: doublePrecision("points").notNull(),
    differential: doublePrecision("differential").notNull(),
    /** Ties share a rank (spec §Tiebreakers), so this is not unique. */
    rank: integer("rank").notNull(),
    /** Serves the "last updated" stamp the spec requires on standings views. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // `nullsNotDistinct` is load-bearing: Postgres treats NULLs as distinct by
    // default, so without it a member could accumulate duplicate season rows
    // (weekId null) and the rebuild's upsert would never conflict.
    unique("pickem_standings_season_member_week_unique")
      .on(table.leagueSeasonId, table.leagueMemberId, table.weekId)
      .nullsNotDistinct(),
    index("pickem_standings_season_week_rank_idx").on(
      table.leagueSeasonId,
      table.weekId,
      table.rank,
    ),
  ],
);
