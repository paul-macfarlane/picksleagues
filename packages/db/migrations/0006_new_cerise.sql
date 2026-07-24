CREATE TABLE "league_seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"settings" jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "league_seasons_league_season_unique" UNIQUE("league_id","season_id")
);
--> statement-breakpoint
ALTER TABLE "league_seasons" ADD CONSTRAINT "league_seasons_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_seasons" ADD CONSTRAINT "league_seasons_season_id_sport_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."sport_seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "league_seasons_league_id_idx" ON "league_seasons" USING btree ("league_id");--> statement-breakpoint
-- ADR-0009 backfill: every existing league becomes exactly one instance,
-- carrying its per-season state (settings/status/season anchor + timestamps)
-- off `leagues`×`league_settings`. Must run before those sources are dropped.
INSERT INTO "league_seasons" ("id", "league_id", "season_id", "settings", "status", "created_at", "updated_at")
SELECT gen_random_uuid(), l."id", l."season_id", ls."settings", l."status", l."created_at", l."updated_at"
FROM "leagues" l JOIN "league_settings" ls ON ls."league_id" = l."id";--> statement-breakpoint
ALTER TABLE "league_settings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "league_settings" CASCADE;--> statement-breakpoint
ALTER TABLE "leagues" DROP CONSTRAINT "leagues_season_id_sport_seasons_id_fk";
--> statement-breakpoint
DROP INDEX "leagues_visibility_status_idx";--> statement-breakpoint
CREATE INDEX "leagues_visibility_idx" ON "leagues" USING btree ("visibility");--> statement-breakpoint
ALTER TABLE "leagues" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "leagues" DROP COLUMN "season_id";