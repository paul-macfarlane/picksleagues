ALTER TABLE "events" ADD COLUMN "locked_at" timestamp;--> statement-breakpoint
ALTER TABLE "odds" ADD COLUMN "locked_at" timestamp;--> statement-breakpoint
ALTER TABLE "phases" ADD COLUMN "locked_at" timestamp;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "locked_at" timestamp;