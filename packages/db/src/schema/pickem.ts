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
     * The week the pick was made in. Denormalized from the game so the two
     * questions asked of it constantly — a member's picks for a week, and how
     * many they hold against the week's cap — are answered without joining
     * through `games`; it is also half of the per-week uniqueness constraint
     * below.
     *
     * It no longer diverges from the game's own `week_id` in any way the
     * product acts on: week moves are out of scope (ADR-0019), and a real one
     * is expressed as an admin `cancelled` override on the game.
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
    /**
     * A member picks a given game at most once **per week** — the database
     * backstop the write path's duplicate check is checked against.
     *
     * Scoped to the week deliberately (ADR-0017, kept by ADR-0018). Spanning
     * every week would enforce a rule Pick'em's spec does not have: its Core
     * Rules say only that each week a member picks from *that week's* slate,
     * and the once-per rule in the spec belongs to Survivor, where it is a
     * *team* ledger ("a member may pick each NFL team at most once per
     * league").
     *
     * ADR-0017's original motivation — a member whose pick's game moved to a
     * later week being unable to pick it there — is superseded: week moves are
     * out of scope (ADR-0019), so that situation is unreachable. The shape
     * stays anyway, because narrowing it back would be a migration bought with
     * nothing.
     */
    unique("pickem_picks_member_game_week_unique").on(
      table.leagueMemberId,
      table.gameId,
      table.weekId,
    ),
    // Serves the per-week read path (own picks, others' picks) and the
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
 * `pick_results`/`standings`. The shape here is Pick'em's: points and one
 * ranked row per member per scope. Survivor's board is
 * a survivor ledger (`survivor_state`) and March Madness wants one row **per
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
    /**
     * The member's settled record over the row's period — display only, never
     * an ordering input (points alone rank the board, ADR-0018). Counted from
     * `pickem_pick_results.outcome` on every rebuild like everything else here,
     * so the board stays fully recomputable from (picks, results, settings):
     * no incremental counter path may write these.
     *
     * `default(0)` exists for the expand/contract window, not for callers — the
     * migration workflow races the Vercel deploy (ADR-0003), so the previous
     * deploy's insert must still satisfy the constraint. Settlement always
     * writes all three explicitly, and the next settle overwrites any
     * default-filled row wholesale.
     */
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    pushes: integer("pushes").notNull().default(0),
    /** Members level on points share a rank, so this is not unique. */
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
