ALTER TABLE "games" DROP CONSTRAINT "games_overridden_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "nfl_game_stat_context" DROP CONSTRAINT "nfl_game_stat_context_overridden_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" DROP CONSTRAINT "nfl_team_season_stats_overridden_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "teams" DROP CONSTRAINT "teams_overridden_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "games" DROP COLUMN "override_home_score";--> statement-breakpoint
ALTER TABLE "games" DROP COLUMN "override_away_score";--> statement-breakpoint
ALTER TABLE "games" DROP COLUMN "override_status";--> statement-breakpoint
ALTER TABLE "games" DROP COLUMN "override_kickoff_at";--> statement-breakpoint
ALTER TABLE "games" DROP COLUMN "override_spread";--> statement-breakpoint
ALTER TABLE "games" DROP COLUMN "override_period";--> statement-breakpoint
ALTER TABLE "games" DROP COLUMN "override_clock_seconds";--> statement-breakpoint
ALTER TABLE "games" DROP COLUMN "overridden_by";--> statement-breakpoint
ALTER TABLE "games" DROP COLUMN "overridden_at";--> statement-breakpoint
ALTER TABLE "nfl_game_stat_context" DROP COLUMN "override_payload";--> statement-breakpoint
ALTER TABLE "nfl_game_stat_context" DROP COLUMN "overridden_by";--> statement-breakpoint
ALTER TABLE "nfl_game_stat_context" DROP COLUMN "overridden_at";--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" DROP COLUMN "override_wins";--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" DROP COLUMN "override_losses";--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" DROP COLUMN "override_ties";--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" DROP COLUMN "override_home_wins";--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" DROP COLUMN "override_home_losses";--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" DROP COLUMN "override_home_ties";--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" DROP COLUMN "override_road_wins";--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" DROP COLUMN "override_road_losses";--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" DROP COLUMN "override_road_ties";--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" DROP COLUMN "override_streak";--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" DROP COLUMN "override_points_for";--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" DROP COLUMN "override_points_against";--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" DROP COLUMN "overridden_by";--> statement-breakpoint
ALTER TABLE "nfl_team_season_stats" DROP COLUMN "overridden_at";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN "override_name";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN "override_abbreviation";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN "override_location";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN "override_logo_light_url";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN "override_logo_dark_url";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN "overridden_by";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN "overridden_at";