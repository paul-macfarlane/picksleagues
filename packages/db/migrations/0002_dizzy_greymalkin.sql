CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_id" uuid NOT NULL,
	"provider_game_id" text NOT NULL,
	"home_team_abbr" text NOT NULL,
	"home_team_name" text NOT NULL,
	"away_team_abbr" text NOT NULL,
	"away_team_name" text NOT NULL,
	"kickoff_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"home_score" integer,
	"away_score" integer,
	"override_home_score" integer,
	"override_away_score" integer,
	"override_status" text,
	"override_kickoff_at" timestamp with time zone,
	"override_spread" double precision,
	"overridden_by" text,
	"overridden_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "games_provider_game_id_unique" UNIQUE("provider_game_id")
);
--> statement-breakpoint
CREATE TABLE "odds_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"spread" double precision NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sport" text NOT NULL,
	"year" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sport_seasons_sport_year_unique" UNIQUE("sport","year")
);
--> statement-breakpoint
CREATE TABLE "weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"week_type" text NOT NULL,
	"week_number" integer NOT NULL,
	"label" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "weeks_season_type_number_unique" UNIQUE("season_id","week_type","week_number")
);
--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_week_id_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_overridden_by_users_id_fk" FOREIGN KEY ("overridden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odds_snapshots" ADD CONSTRAINT "odds_snapshots_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weeks" ADD CONSTRAINT "weeks_season_id_sport_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."sport_seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "games_week_id_idx" ON "games" USING btree ("week_id");--> statement-breakpoint
CREATE INDEX "games_status_kickoff_idx" ON "games" USING btree ("status","kickoff_at");--> statement-breakpoint
CREATE INDEX "odds_snapshots_game_captured_idx" ON "odds_snapshots" USING btree ("game_id","captured_at");--> statement-breakpoint
CREATE INDEX "weeks_season_id_idx" ON "weeks" USING btree ("season_id");