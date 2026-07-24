ALTER TABLE "games" ALTER COLUMN "home_team_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ALTER COLUMN "away_team_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "games" DROP COLUMN "home_team_abbr";--> statement-breakpoint
ALTER TABLE "games" DROP COLUMN "home_team_name";--> statement-breakpoint
ALTER TABLE "games" DROP COLUMN "away_team_abbr";--> statement-breakpoint
ALTER TABLE "games" DROP COLUMN "away_team_name";