import type { Db } from "@picksleagues/db";
import {
  accounts,
  games,
  leagueInvites,
  leagueMembers,
  leagueSeasons,
  leagues,
  oddsSnapshots,
  sessions,
  sportSeasons,
  teams,
  users,
  weeks,
} from "@picksleagues/db";

/**
 * Truncates every app table in FK order. All integration files share one
 * Postgres (vitest runs them with fileParallelism: false), so each file must
 * clear EVERY table it could be polluted by — not just the ones it writes.
 * League rows in particular block `sport_seasons` deletion (RESTRICT FK,
 * ADR-0008), which is why a single shared reset beats per-file lists that
 * drift out of sync.
 */
export async function resetDb(db: Db): Promise<void> {
  await db.delete(leagueInvites);
  await db.delete(leagueMembers);
  await db.delete(leagueSeasons);
  await db.delete(leagues);
  await db.delete(oddsSnapshots);
  await db.delete(games);
  await db.delete(weeks);
  await db.delete(sportSeasons);
  await db.delete(teams);
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(users);
}
