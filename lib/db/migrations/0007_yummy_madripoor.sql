ALTER TABLE "league_standings" DROP CONSTRAINT "league_standings_season_id_seasons_id_fk";
--> statement-breakpoint
ALTER TABLE "league_standings" ADD CONSTRAINT "league_standings_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;