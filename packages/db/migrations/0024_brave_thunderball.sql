-- Drops a column 0023 created one migration earlier, rather than editing 0023
-- in place: ADR-0026 (Survivor is straight-up only) landed between the two, and
-- rewriting an already-applied migration would leave every database that ran
-- 0023 silently drifted from the schema Drizzle believes it has.
ALTER TABLE "survivor_picks" DROP COLUMN "spread_at_pick";--> statement-breakpoint
-- The same decision in the settings blob. `pickType` is already stored on real
-- Survivor rows and is no longer in `SurvivorSettingsSchema`, so leaving it
-- would be exactly the stored-settings/schema divergence the engineering rules
-- forbid. Scoped to Survivor leagues: Pick'em keeps its own Pick Type.
UPDATE "league_seasons" SET "settings" = "settings" - 'pickType' FROM "leagues" WHERE "leagues"."id" = "league_seasons"."league_id" AND "leagues"."mode" = 'survivor';
