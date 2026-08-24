import { createDb } from "../../packages/db/src/client";
import { loadEnv } from "../../packages/core/src/env";
import { GAME_STATUS, SPORT, WEEK_TYPE } from "../../packages/schemas/src/index";
import { loadE2eEnv } from "./e2e-env";

// Same relative-import + env-loading rationale as ./session.ts — seed against
// the exact DATABASE_URL the E2E API server reads. Statements go through the
// raw pool (`db.$client`) like session.ts's cleanup: e2e/ declares no deps of
// its own, so drizzle-orm's query-builder operators can't be bare-imported
// from here.
loadE2eEnv();

const env = loadEnv(process.env);
const pool = createDb(env.DATABASE_URL).$client;

/**
 * A far-future season so the league is pre-start under the dev server's real
 * system clock (fixed dates, not "now" arithmetic — deterministic). League
 * creation binds to the LATEST season for the sport, so 2099 outranks any
 * genuinely synced season.
 */
export const E2E_SEASON_YEAR = 2099;
const KICKOFF = "2099-09-12T17:00:00.000Z";
const SEED_AT = "2099-01-01T00:00:00.000Z";

/**
 * Fresh 2099 NFL season with a week-1 game. Any prior 2099 season (and the
 * leagues bound to it — the season FK is RESTRICT) is swept first so reruns
 * against a used dev DB start clean.
 */
export async function seedFutureSeason(): Promise<{ seasonId: string }> {
  await cleanupFutureSeason();

  const season = await pool.query<{ id: string }>(
    `insert into sport_seasons (sport, year, created_at, updated_at)
     values ($1, $2, $3, $3) returning id`,
    [SPORT.NFL, E2E_SEASON_YEAR, SEED_AT],
  );
  const seasonId = season.rows[0]!.id;

  const week = await pool.query<{ id: string }>(
    `insert into weeks (season_id, week_type, week_number, label, starts_at, ends_at, created_at, updated_at)
     values ($1, $2, 1, 'Week 1', $3, $3, $4, $4) returning id`,
    [seasonId, WEEK_TYPE.REGULAR, KICKOFF, SEED_AT],
  );

  // Teams are normalized reference data (ADR-0010) — seed the two the game
  // references. Scoped to the 2099 sport-year abbreviations so a rerun's
  // cleanup (which deletes by abbreviation below) never collides with a real
  // synced team row.
  const homeTeam = await pool.query<{ id: string }>(
    `insert into teams (sport, abbreviation, name, created_at, updated_at)
     values ($1, 'E2H', 'E2E Home Team', $2, $2) returning id`,
    [SPORT.NFL, SEED_AT],
  );
  const awayTeam = await pool.query<{ id: string }>(
    `insert into teams (sport, abbreviation, name, created_at, updated_at)
     values ($1, 'E2A', 'E2E Away Team', $2, $2) returning id`,
    [SPORT.NFL, SEED_AT],
  );

  await pool.query(
    `insert into games (week_id, provider_game_id, home_team_id, away_team_id, kickoff_at, status, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $7)`,
    [
      week.rows[0]!.id,
      `e2e-${E2E_SEASON_YEAR}-wk1`,
      homeTeam.rows[0]!.id,
      awayTeam.rows[0]!.id,
      KICKOFF,
      GAME_STATUS.SCHEDULED,
      SEED_AT,
    ],
  );

  return { seasonId };
}

export async function cleanupFutureSeason(): Promise<void> {
  // Leagues no longer carry season_id (ADR-0009) — the season anchor lives on
  // league_seasons. Delete leagues that have an instance on the 2099 season
  // (the FK cascade removes the instances), then the now-unreferenced season
  // (which cascades away its weeks and games). Teams are RESTRICT-referenced
  // from games (ADR-0010), so they must be deleted last, after the cascade
  // above has cleared the games that reference them.
  await pool.query(
    `delete from leagues where id in (
       select ls.league_id from league_seasons ls
       join sport_seasons s on s.id = ls.season_id
       where s.year = $1
     )`,
    [E2E_SEASON_YEAR],
  );
  await pool.query(`delete from sport_seasons where year = $1`, [E2E_SEASON_YEAR]);
  await pool.query(`delete from teams where sport = $1 and abbreviation in ('E2H', 'E2A')`, [
    SPORT.NFL,
  ]);
}

/** The most recent invite code for a league — the UI only exposes copy-to-clipboard. */
export async function latestInviteCode(leagueId: string): Promise<string> {
  const result = await pool.query<{ code: string }>(
    `select code from league_invites where league_id = $1 order by created_at desc limit 1`,
    [leagueId],
  );
  const code = result.rows[0]?.code;
  if (!code) throw new Error(`no invite found for league ${leagueId}`);
  return code;
}
