ALTER TABLE "pickem_standings" ADD COLUMN "wins" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pickem_standings" ADD COLUMN "losses" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pickem_standings" ADD COLUMN "pushes" integer DEFAULT 0 NOT NULL;