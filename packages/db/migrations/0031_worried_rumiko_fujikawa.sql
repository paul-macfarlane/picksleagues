CREATE TABLE "league_dues_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_season_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "league_dues_payments_season_user_unique" UNIQUE("league_season_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "league_seasons" ADD COLUMN "dues_amount" integer;--> statement-breakpoint
ALTER TABLE "league_dues_payments" ADD CONSTRAINT "league_dues_payments_league_season_id_league_seasons_id_fk" FOREIGN KEY ("league_season_id") REFERENCES "public"."league_seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_dues_payments" ADD CONSTRAINT "league_dues_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "league_dues_payments_league_season_id_idx" ON "league_dues_payments" USING btree ("league_season_id");--> statement-breakpoint
ALTER TABLE "league_seasons" ADD CONSTRAINT "league_seasons_dues_amount_range" CHECK ("league_seasons"."dues_amount" is null or "league_seasons"."dues_amount" between 1 and 10000);