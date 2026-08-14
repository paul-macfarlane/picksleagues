ALTER TABLE "teams" ADD COLUMN "override_name" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "override_abbreviation" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "override_location" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "override_logo_light_url" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "override_logo_dark_url" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "overridden_by" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "overridden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_overridden_by_users_id_fk" FOREIGN KEY ("overridden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;