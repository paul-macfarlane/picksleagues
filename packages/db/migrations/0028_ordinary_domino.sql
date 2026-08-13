CREATE TABLE "game_stat_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "game_stat_context_game_id_unique" UNIQUE("game_id")
);
--> statement-breakpoint
CREATE TABLE "team_season_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"season_year" integer NOT NULL,
	"wins" integer NOT NULL,
	"losses" integer NOT NULL,
	"ties" integer NOT NULL,
	"home_wins" integer NOT NULL,
	"home_losses" integer NOT NULL,
	"home_ties" integer NOT NULL,
	"road_wins" integer NOT NULL,
	"road_losses" integer NOT NULL,
	"road_ties" integer NOT NULL,
	"streak" integer NOT NULL,
	"points_for" integer NOT NULL,
	"points_against" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "team_season_stats_team_season_unique" UNIQUE("team_id","season_year")
);
--> statement-breakpoint
ALTER TABLE "game_stat_context" ADD CONSTRAINT "game_stat_context_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_season_stats" ADD CONSTRAINT "team_season_stats_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;