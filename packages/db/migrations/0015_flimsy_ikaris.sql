CREATE TABLE "pick_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pickem_pick_id" uuid NOT NULL,
	"league_season_id" uuid NOT NULL,
	"league_member_id" uuid NOT NULL,
	"week_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"points" double precision NOT NULL,
	"differential" double precision NOT NULL,
	"settled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pick_results_pickem_pick_unique" UNIQUE("pickem_pick_id")
);
--> statement-breakpoint
CREATE TABLE "standings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_season_id" uuid NOT NULL,
	"league_member_id" uuid NOT NULL,
	"week_id" uuid,
	"points" double precision NOT NULL,
	"differential" double precision NOT NULL,
	"rank" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "standings_season_member_week_unique" UNIQUE NULLS NOT DISTINCT("league_season_id","league_member_id","week_id")
);
--> statement-breakpoint
ALTER TABLE "pick_results" ADD CONSTRAINT "pick_results_pickem_pick_id_pickem_picks_id_fk" FOREIGN KEY ("pickem_pick_id") REFERENCES "public"."pickem_picks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_results" ADD CONSTRAINT "pick_results_league_season_id_league_seasons_id_fk" FOREIGN KEY ("league_season_id") REFERENCES "public"."league_seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_results" ADD CONSTRAINT "pick_results_league_member_id_league_members_id_fk" FOREIGN KEY ("league_member_id") REFERENCES "public"."league_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_results" ADD CONSTRAINT "pick_results_week_id_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."weeks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standings" ADD CONSTRAINT "standings_league_season_id_league_seasons_id_fk" FOREIGN KEY ("league_season_id") REFERENCES "public"."league_seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standings" ADD CONSTRAINT "standings_league_member_id_league_members_id_fk" FOREIGN KEY ("league_member_id") REFERENCES "public"."league_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standings" ADD CONSTRAINT "standings_week_id_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."weeks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pick_results_season_week_idx" ON "pick_results" USING btree ("league_season_id","week_id");--> statement-breakpoint
CREATE INDEX "standings_season_week_rank_idx" ON "standings" USING btree ("league_season_id","week_id","rank");