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
import type { PickOutcome } from "@picksleagues/schemas";
import { leagueMembers, leagueSeasons } from "./leagues";
import { pickemPicks } from "./picks";
import { weeks } from "./sports";

/**
 * Settlement output (arch D10). Both tables are **pure derivations** of
 * (picks, results, settings): a full recompute must reproduce them exactly, and
 * the incremental path settlement takes on a game going final is an
 * optimization, never a source of state a rebuild couldn't rederive. Nothing
 * here may be written by any path that isn't recomputable.
 *
 * Shared across modes by design (arch D9) — but only `pick_results` is shared
 * as-is. `standings`' unique on (season, member, week) allows a member exactly
 * one row per scope, which March Madness contradicts: spec §Game Mode 3 wants
 * one row **per bracket**, up to 10 per member. MM-6 therefore has to re-key or
 * relax that constraint, and Elimination needs alive/eliminated and
 * week-eliminated columns it doesn't have yet. Neither is a reason to
 * speculatively widen the shape now (arch §Domain Model: keep a column only
 * when it's free) — it is a reason not to assume these tables are final.
 */

export const pickResults = pgTable(
  "pick_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * The pick this grades. Per-mode by arch D9 — ELM-4 makes this nullable and
     * adds its sibling column plus a one-of check, rather than picks becoming
     * polymorphic. Cascades: a deleted pick has no result, and the batch pick
     * endpoint replaces rows freely, so results must follow.
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
    unique("pick_results_pickem_pick_unique").on(table.pickemPickId),
    index("pick_results_season_week_idx").on(table.leagueSeasonId, table.weekId),
  ],
);

export const standings = pgTable(
  "standings",
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
    unique("standings_season_member_week_unique")
      .on(table.leagueSeasonId, table.leagueMemberId, table.weekId)
      .nullsNotDistinct(),
    index("standings_season_week_rank_idx").on(table.leagueSeasonId, table.weekId, table.rank),
  ],
);
