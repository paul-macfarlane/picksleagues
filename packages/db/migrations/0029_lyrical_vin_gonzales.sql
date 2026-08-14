ALTER TABLE "nfl_game_stat_context" ADD COLUMN "override_payload" jsonb;--> statement-breakpoint
ALTER TABLE "nfl_game_stat_context" ADD COLUMN "overridden_by" text;--> statement-breakpoint
ALTER TABLE "nfl_game_stat_context" ADD COLUMN "overridden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" ADD COLUMN "override_wins" integer;--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" ADD COLUMN "override_losses" integer;--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" ADD COLUMN "override_ties" integer;--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" ADD COLUMN "override_home_wins" integer;--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" ADD COLUMN "override_home_losses" integer;--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" ADD COLUMN "override_home_ties" integer;--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" ADD COLUMN "override_road_wins" integer;--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" ADD COLUMN "override_road_losses" integer;--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" ADD COLUMN "override_road_ties" integer;--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" ADD COLUMN "override_streak" integer;--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" ADD COLUMN "override_points_for" integer;--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" ADD COLUMN "override_points_against" integer;--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" ADD COLUMN "overridden_by" text;--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" ADD COLUMN "overridden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nfl_game_stat_context" ADD CONSTRAINT "nfl_game_stat_context_overridden_by_users_id_fk" FOREIGN KEY ("overridden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" ADD CONSTRAINT "nfl_team_season_stats_overridden_by_users_id_fk" FOREIGN KEY ("overridden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;