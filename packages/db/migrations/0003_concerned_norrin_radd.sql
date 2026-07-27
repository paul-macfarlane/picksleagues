CREATE TABLE "league_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_by" text,
	"expires_at" timestamp with time zone,
	"max_uses" integer,
	"use_count" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "league_invites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "league_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "league_members_league_user_unique" UNIQUE("league_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "league_settings" (
	"league_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"mode" text NOT NULL,
	"visibility" text NOT NULL,
	"status" text NOT NULL,
	"season_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "league_invites" ADD CONSTRAINT "league_invites_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_invites" ADD CONSTRAINT "league_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_settings" ADD CONSTRAINT "league_settings_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_season_id_sport_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."sport_seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "league_invites_league_id_idx" ON "league_invites" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "league_members_user_id_idx" ON "league_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "leagues_visibility_status_idx" ON "leagues" USING btree ("visibility","status");