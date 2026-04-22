CREATE TYPE "public"."league_role" AS ENUM('commissioner', 'member');--> statement-breakpoint
CREATE TYPE "public"."pick_type" AS ENUM('straight_up', 'against_the_spread');--> statement-breakpoint
CREATE TYPE "public"."pick_result" AS ENUM('win', 'loss', 'push');--> statement-breakpoint
CREATE TYPE "public"."profile_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('not_started', 'in_progress', 'final');--> statement-breakpoint
CREATE TYPE "public"."season_type" AS ENUM('regular', 'postseason');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "direct_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"invitee_user_id" text NOT NULL,
	"inviter_user_id" text,
	"role" "league_role" NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "direct_invites_league_invitee_uniq" UNIQUE("league_id","invitee_user_id")
);
--> statement-breakpoint
CREATE TABLE "league_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "league_role" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "league_members_league_user_uniq" UNIQUE("league_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "league_standings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"season_id" uuid NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"pushes" integer DEFAULT 0 NOT NULL,
	"points" double precision DEFAULT 0 NOT NULL,
	"rank" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "league_standings_league_user_season_uniq" UNIQUE("league_id","user_id","season_id")
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sports_league_id" uuid NOT NULL,
	"name" text NOT NULL,
	"image_url" text,
	"start_season_type" "season_type" NOT NULL,
	"start_week_number" integer NOT NULL,
	"end_season_type" "season_type" NOT NULL,
	"end_week_number" integer NOT NULL,
	"size" integer NOT NULL,
	"picks_per_phase" integer NOT NULL,
	"pick_type" "pick_type" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "link_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"token" text NOT NULL,
	"inviter_user_id" text,
	"role" "league_role" NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "link_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "picks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"phase_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"spread_at_lock" double precision,
	"pick_result" "pick_result",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "picks_league_user_event_uniq" UNIQUE("league_id","user_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"username" text NOT NULL,
	"name" text NOT NULL,
	"avatar_url" text,
	"role" "profile_role" DEFAULT 'user' NOT NULL,
	"setup_complete" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "profile_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "profile_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "simulator_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" integer DEFAULT 1 NOT NULL,
	"season_year" integer NOT NULL,
	"sim_now" timestamp NOT NULL,
	"initialized" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "simulator_state_singleton_unique" UNIQUE("singleton")
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
	"period" smallint,
	"clock" text,
	"locked_at" timestamp,
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
	"locked_at" timestamp,
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
	"locked_at" timestamp,
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
	"locked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "direct_invites" ADD CONSTRAINT "direct_invites_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_invites" ADD CONSTRAINT "direct_invites_invitee_user_id_user_id_fk" FOREIGN KEY ("invitee_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_invites" ADD CONSTRAINT "direct_invites_inviter_user_id_user_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_standings" ADD CONSTRAINT "league_standings_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_standings" ADD CONSTRAINT "league_standings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_standings" ADD CONSTRAINT "league_standings_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_sports_league_id_sports_leagues_id_fk" FOREIGN KEY ("sports_league_id") REFERENCES "public"."sports_leagues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_invites" ADD CONSTRAINT "link_invites_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_invites" ADD CONSTRAINT "link_invites_inviter_user_id_user_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_phase_id_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."phases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
CREATE INDEX "direct_invites_invitee_user_id_idx" ON "direct_invites" USING btree ("invitee_user_id");--> statement-breakpoint
CREATE INDEX "direct_invites_league_id_idx" ON "direct_invites" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "league_members_user_id_idx" ON "league_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "league_members_league_id_idx" ON "league_members" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "league_standings_league_season_idx" ON "league_standings" USING btree ("league_id","season_id");--> statement-breakpoint
CREATE INDEX "leagues_sports_league_id_idx" ON "leagues" USING btree ("sports_league_id");--> statement-breakpoint
CREATE INDEX "link_invites_league_id_idx" ON "link_invites" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "picks_league_user_idx" ON "picks" USING btree ("league_id","user_id");--> statement-breakpoint
CREATE INDEX "picks_phase_id_idx" ON "picks" USING btree ("phase_id");--> statement-breakpoint
CREATE INDEX "picks_event_id_idx" ON "picks" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "events_phase_id_idx" ON "events" USING btree ("phase_id");--> statement-breakpoint
CREATE INDEX "events_home_team_id_idx" ON "events" USING btree ("home_team_id");--> statement-breakpoint
CREATE INDEX "events_away_team_id_idx" ON "events" USING btree ("away_team_id");--> statement-breakpoint
CREATE INDEX "odds_event_id_idx" ON "odds" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "phases_season_id_idx" ON "phases" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "seasons_sports_league_id_idx" ON "seasons" USING btree ("sports_league_id");--> statement-breakpoint
CREATE INDEX "teams_sports_league_id_idx" ON "teams" USING btree ("sports_league_id");