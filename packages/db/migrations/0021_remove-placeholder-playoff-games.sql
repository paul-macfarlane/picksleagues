-- ADR-0021: an event whose competitors are undetermined is not yet a game in
-- our domain, and the ESPN adapter no longer returns one. This removes the rows
-- earlier syncs already created for unseeded playoff rounds. ESPN encodes a
-- placeholder as a negative team id with the abbreviation "TBD"; the predicate
-- below is the SQL reading of the adapter's, not a literal translation of it —
-- the adapter parses the id as a number, this matches a leading "-" — so a
-- future change to one does not automatically cover the other. It is scoped to
-- NFL and case-insensitive on the abbreviation.
--
-- The guard exists so a member's pick is never destroyed silently. games.id is
-- referenced by pickem_picks with ON DELETE RESTRICT, so the constraint would
-- stop the delete anyway — this turns that bare constraint error into a message
-- naming the situation, and stops the deploy where a human can decide.
DO $$
DECLARE
  affected_picks integer;
BEGIN
  -- DISTINCT because a game whose *both* competitors are placeholders — the
  -- normal case — matches the teams join twice, and a message that doubles the
  -- number of affected picks misleads exactly the human this guard stops.
  SELECT count(DISTINCT p."id") INTO affected_picks
  FROM "pickem_picks" p
  JOIN "games" g ON g."id" = p."game_id"
  JOIN "teams" t ON t."id" IN (g."home_team_id", g."away_team_id")
  WHERE t."sport" = 'nfl'
    AND (t."provider_team_id" LIKE '-%' OR upper(t."abbreviation") = 'TBD');

  IF affected_picks > 0 THEN
    RAISE EXCEPTION
      'ADR-0021 cleanup: % pickem_picks row(s) reference a placeholder playoff game. Resolve those picks before migrating.',
      affected_picks;
  END IF;
END $$;--> statement-breakpoint
DELETE FROM "games" g
USING "teams" t
WHERE t."id" IN (g."home_team_id", g."away_team_id")
  AND t."sport" = 'nfl'
  AND (t."provider_team_id" LIKE '-%' OR upper(t."abbreviation") = 'TBD');--> statement-breakpoint
DELETE FROM "teams" t
WHERE t."sport" = 'nfl'
  AND (t."provider_team_id" LIKE '-%' OR upper(t."abbreviation") = 'TBD');
