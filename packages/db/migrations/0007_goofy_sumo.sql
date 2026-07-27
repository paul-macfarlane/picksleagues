CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sport" text NOT NULL,
	"provider_team_id" text,
	"abbreviation" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "teams_sport_provider_team_id_unique" UNIQUE("sport","provider_team_id"),
	CONSTRAINT "teams_sport_abbreviation_unique" UNIQUE("sport","abbreviation")
);
--> statement-breakpoint
-- ADR-0010 backfill: derive one teams row per distinct (sport, abbreviation)
-- pair out of the games table's four text columns, unioning the home and away
-- sides. Sport comes from each game's week -> sport_seasons join (never
-- hardcoded — existing data happens to be all-NFL, but the query doesn't
-- assume that). Timestamps borrow the earliest game row a team appeared on
-- (no row of its own has a creation time) rather than SQL now() (engineering
-- rules: no now() in domain logic) — deterministic given a fixed data set.
INSERT INTO "teams" ("id", "sport", "abbreviation", "name", "created_at", "updated_at")
SELECT gen_random_uuid(), grouped.sport, grouped.abbr, grouped.name, grouped.first_created_at, grouped.first_created_at
FROM (
	SELECT
		s."sport" AS sport,
		sides.abbr AS abbr,
		(array_agg(sides.name ORDER BY sides.created_at))[1] AS name,
		MIN(sides.created_at) AS first_created_at
	FROM (
		SELECT week_id, home_team_abbr AS abbr, home_team_name AS name, created_at FROM "games"
		UNION ALL
		SELECT week_id, away_team_abbr AS abbr, away_team_name AS name, created_at FROM "games"
	) sides
	JOIN "weeks" w ON w."id" = sides.week_id
	JOIN "sport_seasons" s ON s."id" = w."season_id"
	GROUP BY s."sport", sides.abbr
) grouped
ON CONFLICT ("sport", "abbreviation") DO NOTHING;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "home_team_id" uuid;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "away_team_id" uuid;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Fill the new FKs by joining each game's (sport, abbreviation) to the teams
-- row the backfill above just created.
UPDATE "games" g
SET "home_team_id" = t."id"
FROM "weeks" w, "sport_seasons" s, "teams" t
WHERE w."id" = g."week_id"
	AND s."id" = w."season_id"
	AND t."sport" = s."sport"
	AND t."abbreviation" = g."home_team_abbr";--> statement-breakpoint
UPDATE "games" g
SET "away_team_id" = t."id"
FROM "weeks" w, "sport_seasons" s, "teams" t
WHERE w."id" = g."week_id"
	AND s."id" = w."season_id"
	AND t."sport" = s."sport"
	AND t."abbreviation" = g."away_team_abbr";