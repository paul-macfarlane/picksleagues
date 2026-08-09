-- Custom SQL migration file, put your code below! --
-- ADR-0023: the mode ships as Survivor, not Elimination. `leagues.mode` is a
-- plain `text` column (no enum type to alter), so existing rows reading
-- "elimination" are rewritten to "survivor" here rather than left to stop
-- parsing against LEAGUE_MODE.
UPDATE "leagues" SET "mode" = 'survivor' WHERE "mode" = 'elimination';
