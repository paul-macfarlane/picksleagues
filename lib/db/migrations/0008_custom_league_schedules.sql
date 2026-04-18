-- PL-058: replace the `season_format` enum with explicit (seasonType, weekNumber)
-- start/end tuples so leagues can span any custom range. See BUSINESS_SPEC §3.1.

ALTER TABLE "leagues" ADD COLUMN "start_season_type" "season_type";
--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "start_week_number" integer;
--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "end_season_type" "season_type";
--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "end_week_number" integer;
--> statement-breakpoint

-- Backfill existing rows based on season_format. Postseason weekNumber 5 is
-- the Super Bowl (ESPN week 4 = Pro Bowl, filtered out at sync).
UPDATE "leagues"
SET
  "start_season_type" = CASE "season_format"
    WHEN 'postseason' THEN 'postseason'::season_type
    ELSE 'regular'::season_type
  END,
  "start_week_number" = 1,
  "end_season_type" = CASE "season_format"
    WHEN 'regular_season' THEN 'regular'::season_type
    ELSE 'postseason'::season_type
  END,
  "end_week_number" = CASE "season_format"
    WHEN 'regular_season' THEN 18
    ELSE 5
  END;
--> statement-breakpoint

ALTER TABLE "leagues" ALTER COLUMN "start_season_type" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "leagues" ALTER COLUMN "start_week_number" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "leagues" ALTER COLUMN "end_season_type" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "leagues" ALTER COLUMN "end_week_number" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "leagues" DROP COLUMN "season_format";
--> statement-breakpoint
DROP TYPE "public"."season_format";
