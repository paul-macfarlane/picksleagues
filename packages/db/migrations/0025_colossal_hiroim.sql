CREATE TABLE "survivor_pick_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"survivor_pick_id" uuid NOT NULL,
	"league_season_id" uuid NOT NULL,
	"league_member_id" uuid NOT NULL,
	"week_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"settled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "survivor_pick_results_pick_unique" UNIQUE("survivor_pick_id")
);
--> statement-breakpoint
ALTER TABLE "survivor_pick_results" ADD CONSTRAINT "survivor_pick_results_survivor_pick_id_survivor_picks_id_fk" FOREIGN KEY ("survivor_pick_id") REFERENCES "public"."survivor_picks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survivor_pick_results" ADD CONSTRAINT "survivor_pick_results_league_season_id_league_seasons_id_fk" FOREIGN KEY ("league_season_id") REFERENCES "public"."league_seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survivor_pick_results" ADD CONSTRAINT "survivor_pick_results_league_member_id_league_members_id_fk" FOREIGN KEY ("league_member_id") REFERENCES "public"."league_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survivor_pick_results" ADD CONSTRAINT "survivor_pick_results_week_id_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."weeks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "survivor_pick_results_season_week_idx" ON "survivor_pick_results" USING btree ("league_season_id","week_id");