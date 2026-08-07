CREATE TABLE "survivor_picks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_season_id" uuid NOT NULL,
	"league_member_id" uuid NOT NULL,
	"week_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"spread_at_pick" double precision,
	"released" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "survivor_picks_member_week_unique" UNIQUE("league_season_id","league_member_id","week_id")
);
--> statement-breakpoint
CREATE TABLE "survivor_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_season_id" uuid NOT NULL,
	"league_member_id" uuid NOT NULL,
	"lives_remaining" integer DEFAULT 1 NOT NULL,
	"eliminated_week_id" uuid,
	"revived_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "survivor_state_season_member_unique" UNIQUE("league_season_id","league_member_id")
);
--> statement-breakpoint
ALTER TABLE "survivor_picks" ADD CONSTRAINT "survivor_picks_league_season_id_league_seasons_id_fk" FOREIGN KEY ("league_season_id") REFERENCES "public"."league_seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survivor_picks" ADD CONSTRAINT "survivor_picks_league_member_id_league_members_id_fk" FOREIGN KEY ("league_member_id") REFERENCES "public"."league_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survivor_picks" ADD CONSTRAINT "survivor_picks_week_id_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."weeks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survivor_picks" ADD CONSTRAINT "survivor_picks_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survivor_picks" ADD CONSTRAINT "survivor_picks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survivor_state" ADD CONSTRAINT "survivor_state_league_season_id_league_seasons_id_fk" FOREIGN KEY ("league_season_id") REFERENCES "public"."league_seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survivor_state" ADD CONSTRAINT "survivor_state_league_member_id_league_members_id_fk" FOREIGN KEY ("league_member_id") REFERENCES "public"."league_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survivor_state" ADD CONSTRAINT "survivor_state_eliminated_week_id_weeks_id_fk" FOREIGN KEY ("eliminated_week_id") REFERENCES "public"."weeks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "survivor_picks_member_team_unique" ON "survivor_picks" USING btree ("league_season_id","league_member_id","team_id") WHERE not "survivor_picks"."released";--> statement-breakpoint
CREATE INDEX "survivor_picks_season_week_idx" ON "survivor_picks" USING btree ("league_season_id","week_id");--> statement-breakpoint
CREATE INDEX "survivor_picks_member_week_idx" ON "survivor_picks" USING btree ("league_member_id","week_id");--> statement-breakpoint
CREATE INDEX "survivor_picks_game_idx" ON "survivor_picks" USING btree ("game_id");