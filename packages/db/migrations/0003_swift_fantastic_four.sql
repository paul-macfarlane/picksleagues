CREATE TABLE "job_health" (
	"job_name" text PRIMARY KEY NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_alerted_at" timestamp with time zone
);
