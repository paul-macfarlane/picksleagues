CREATE TABLE "pickem_picks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_season_id" uuid NOT NULL,
	"league_member_id" uuid NOT NULL,
	"week_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"side" text NOT NULL,
	"spread_at_pick" double precision,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pickem_picks_member_game_unique" UNIQUE("league_member_id","game_id")
);
--> statement-breakpoint
ALTER TABLE "pickem_picks" ADD CONSTRAINT "pickem_picks_league_season_id_league_seasons_id_fk" FOREIGN KEY ("league_season_id") REFERENCES "public"."league_seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickem_picks" ADD CONSTRAINT "pickem_picks_league_member_id_league_members_id_fk" FOREIGN KEY ("league_member_id") REFERENCES "public"."league_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickem_picks" ADD CONSTRAINT "pickem_picks_week_id_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."weeks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickem_picks" ADD CONSTRAINT "pickem_picks_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pickem_picks_season_week_idx" ON "pickem_picks" USING btree ("league_season_id","week_id");--> statement-breakpoint
CREATE INDEX "pickem_picks_member_week_idx" ON "pickem_picks" USING btree ("league_member_id","week_id");--> statement-breakpoint
CREATE INDEX "pickem_picks_game_idx" ON "pickem_picks" USING btree ("game_id");