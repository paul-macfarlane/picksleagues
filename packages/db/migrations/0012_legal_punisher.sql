CREATE TABLE "sim_fixture_games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_id" uuid NOT NULL,
	"provider_game_id" text NOT NULL,
	"week_type" text NOT NULL,
	"week_number" integer NOT NULL,
	"home_team_abbr" text NOT NULL,
	"home_team_name" text NOT NULL,
	"home_team_provider_id" text NOT NULL,
	"away_team_abbr" text NOT NULL,
	"away_team_name" text NOT NULL,
	"away_team_provider_id" text NOT NULL,
	"kickoff_at" timestamp with time zone NOT NULL,
	"spread" double precision,
	"final_status" text NOT NULL,
	"final_home_score" integer,
	"final_away_score" integer,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sim_fixture_games_scenario_provider_game_unique" UNIQUE("scenario_id","provider_game_id")
);
--> statement-breakpoint
CREATE TABLE "sim_fixture_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_id" uuid NOT NULL,
	"provider_team_id" text NOT NULL,
	"abbreviation" text NOT NULL,
	"name" text NOT NULL,
	"location" text NOT NULL,
	"logo_light_url" text,
	"logo_dark_url" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sim_fixture_teams_scenario_provider_team_unique" UNIQUE("scenario_id","provider_team_id")
);
--> statement-breakpoint
CREATE TABLE "sim_fixture_weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_id" uuid NOT NULL,
	"week_type" text NOT NULL,
	"week_number" integer NOT NULL,
	"label" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sim_fixture_weeks_scenario_type_number_unique" UNIQUE("scenario_id","week_type","week_number")
);
--> statement-breakpoint
CREATE TABLE "sim_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"sport" text NOT NULL,
	"season_year" integer NOT NULL,
	"source" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sim_scenarios_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "app_state" ADD COLUMN "sim_active_scenario_id" uuid;--> statement-breakpoint
ALTER TABLE "sim_fixture_games" ADD CONSTRAINT "sim_fixture_games_scenario_id_sim_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."sim_scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_fixture_teams" ADD CONSTRAINT "sim_fixture_teams_scenario_id_sim_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."sim_scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_fixture_weeks" ADD CONSTRAINT "sim_fixture_weeks_scenario_id_sim_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."sim_scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sim_fixture_games_scenario_week_idx" ON "sim_fixture_games" USING btree ("scenario_id","week_type","week_number");--> statement-breakpoint
CREATE INDEX "sim_fixture_teams_scenario_id_idx" ON "sim_fixture_teams" USING btree ("scenario_id");--> statement-breakpoint
CREATE INDEX "sim_fixture_weeks_scenario_id_idx" ON "sim_fixture_weeks" USING btree ("scenario_id");--> statement-breakpoint
CREATE INDEX "sim_scenarios_sport_season_idx" ON "sim_scenarios" USING btree ("sport","season_year");--> statement-breakpoint
ALTER TABLE "app_state" ADD CONSTRAINT "app_state_sim_active_scenario_id_sim_scenarios_id_fk" FOREIGN KEY ("sim_active_scenario_id") REFERENCES "public"."sim_scenarios"("id") ON DELETE set null ON UPDATE no action;