import {
  doublePrecision,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { PickSide } from "@picksleagues/schemas";
import { leagueMembers, leagueSeasons } from "./leagues";
import { games, weeks } from "./sports";

/**
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
    side: text("side").$type<PickSide>().notNull(),
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
