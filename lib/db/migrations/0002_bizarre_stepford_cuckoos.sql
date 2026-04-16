CREATE TABLE "simulator_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" integer DEFAULT 1 NOT NULL,
	"season_year" integer NOT NULL,
	"sim_now" timestamp NOT NULL,
	"initialized" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "simulator_state_singleton_unique" UNIQUE("singleton")
);
