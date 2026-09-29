ALTER TABLE "sim_fixture_games" ADD COLUMN "neutral_site" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sim_fixture_games" ADD COLUMN "venue" jsonb;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "neutral_site" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "venue" jsonb;