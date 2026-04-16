CREATE TYPE "public"."event_status" AS ENUM('not_started', 'in_progress', 'final');--> statement-breakpoint
CREATE TYPE "public"."season_type" AS ENUM('regular', 'postseason');--> statement-breakpoint
CREATE TABLE "external_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"event_id" uuid NOT NULL,
	"odds_ref" text,
	"status_ref" text,
	"home_score_ref" text,
	"away_score_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "external_events_source_ext_uniq" UNIQUE("data_source_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "external_phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"phase_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "external_phases_source_ext_uniq" UNIQUE("data_source_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "external_seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"season_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "external_seasons_source_ext_uniq" UNIQUE("data_source_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "external_sportsbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"sportsbook_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "external_sportsbooks_source_ext_uniq" UNIQUE("data_source_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "external_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "external_teams_source_ext_uniq" UNIQUE("data_source_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "data_sources_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phase_id" uuid NOT NULL,
	"home_team_id" uuid NOT NULL,
	"away_team_id" uuid NOT NULL,
	"start_time" timestamp NOT NULL,
	"status" "event_status" DEFAULT 'not_started' NOT NULL,
	"home_score" integer,
	"away_score" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "odds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"sportsbook_id" uuid NOT NULL,
	"home_spread" double precision,
	"away_spread" double precision,
	"home_moneyline" integer,
	"away_moneyline" integer,
	"over_under" double precision,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "odds_event_sportsbook_uniq" UNIQUE("event_id","sportsbook_id")
);
--> statement-breakpoint
CREATE TABLE "phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"season_type" "season_type" NOT NULL,
	"week_number" integer NOT NULL,
	"label" text NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"pick_lock_time" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "phases_season_type_week_uniq" UNIQUE("season_id","season_type","week_number")
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sports_league_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "seasons_league_year_uniq" UNIQUE("sports_league_id","year")
);
--> statement-breakpoint
CREATE TABLE "sports_leagues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"abbreviation" text NOT NULL,
	"sport" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sports_leagues_abbreviation_unique" UNIQUE("abbreviation")
);
--> statement-breakpoint
CREATE TABLE "sportsbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sportsbooks_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sports_league_id" uuid NOT NULL,
	"name" text NOT NULL,
	"location" text NOT NULL,
	"abbreviation" text NOT NULL,
	"logo_url" text,
	"logo_dark_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_events" ADD CONSTRAINT "external_events_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_events" ADD CONSTRAINT "external_events_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_phases" ADD CONSTRAINT "external_phases_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_phases" ADD CONSTRAINT "external_phases_phase_id_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."phases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_seasons" ADD CONSTRAINT "external_seasons_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_seasons" ADD CONSTRAINT "external_seasons_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_sportsbooks" ADD CONSTRAINT "external_sportsbooks_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_sportsbooks" ADD CONSTRAINT "external_sportsbooks_sportsbook_id_sportsbooks_id_fk" FOREIGN KEY ("sportsbook_id") REFERENCES "public"."sportsbooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_teams" ADD CONSTRAINT "external_teams_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_teams" ADD CONSTRAINT "external_teams_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_phase_id_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."phases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odds" ADD CONSTRAINT "odds_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odds" ADD CONSTRAINT "odds_sportsbook_id_sportsbooks_id_fk" FOREIGN KEY ("sportsbook_id") REFERENCES "public"."sportsbooks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phases" ADD CONSTRAINT "phases_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_sports_league_id_sports_leagues_id_fk" FOREIGN KEY ("sports_league_id") REFERENCES "public"."sports_leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_sports_league_id_sports_leagues_id_fk" FOREIGN KEY ("sports_league_id") REFERENCES "public"."sports_leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_events_event_id_idx" ON "external_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "external_phases_phase_id_idx" ON "external_phases" USING btree ("phase_id");--> statement-breakpoint
CREATE INDEX "external_seasons_season_id_idx" ON "external_seasons" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "external_sportsbooks_sportsbook_id_idx" ON "external_sportsbooks" USING btree ("sportsbook_id");--> statement-breakpoint
CREATE INDEX "external_teams_team_id_idx" ON "external_teams" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "events_phase_id_idx" ON "events" USING btree ("phase_id");--> statement-breakpoint
CREATE INDEX "events_home_team_id_idx" ON "events" USING btree ("home_team_id");--> statement-breakpoint
CREATE INDEX "events_away_team_id_idx" ON "events" USING btree ("away_team_id");--> statement-breakpoint
CREATE INDEX "odds_event_id_idx" ON "odds" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "phases_season_id_idx" ON "phases" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "seasons_sports_league_id_idx" ON "seasons" USING btree ("sports_league_id");--> statement-breakpoint
CREATE INDEX "teams_sports_league_id_idx" ON "teams" USING btree ("sports_league_id");