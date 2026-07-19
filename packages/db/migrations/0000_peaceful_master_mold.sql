CREATE TABLE "app_state" (
	"id" text PRIMARY KEY NOT NULL,
	"sim_clock_offset_ms" bigint DEFAULT 0 NOT NULL
);
