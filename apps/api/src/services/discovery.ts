import { and, asc, count, desc, eq, ilike, inArray, notExists } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { leagueMembers, leagues } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  DISCOVERY_PAGE_SIZE,
  LEAGUE_MODE,
  LEAGUE_SETTINGS_SCHEMAS,
  LEAGUE_STATUS,
  LEAGUE_VISIBILITY,
  type DiscoveryLeague,
  type DiscoveryPickemSettings,
  type DiscoveryResponse,
  type LeagueMode,
} from "@picksleagues/schemas";
import { currentLeagueSeason, isPreStart, leagueStartAt } from "./leagues";

/** Escapes ILIKE's own wildcards so a user's `%`/`_` matches literally, not as a pattern. */
function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

/**
 * The settings summary a card shows pre-join (FB-35). Parsed through
 * `LEAGUE_SETTINGS_SCHEMAS` rather than read off the stored blob so a league
 * written before a field existed materializes its default instead of
 * serializing `undefined`.
 */
function pickemSettingsSummary(
  mode: LeagueMode,
  settings: unknown,
): DiscoveryPickemSettings | null {
  if (mode !== LEAGUE_MODE.PICKEM) return null;
  const parsed = LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.PICKEM].parse(settings);
  return { pickType: parsed.pickType, picksPerWeek: parsed.picksPerWeek };
}

export interface DiscoveryQuery {
  query?: string;
  mode?: LeagueMode;
  page: number;
}

/**
 * spec §Public Discovery, as amended by ADR-0037: public, active leagues that
 * haven't passed their join cutoff, aren't already full, and the caller isn't
 * already a member of — name-filterable, mode-filterable, ordered by remaining
 * space, and served a page at a time.
 *
 * **Filtering, ordering, and paging all happen after the candidate rows are
 * read**, and that is deliberate rather than overlooked. Two of the three
 * filters can't be pushed into SQL without restating domain logic that has one
 * home: joinability turns on `leagueStartAt`, a per-mode derivation over the
 * league's own start week (override-aware, arch D15), and a SQL restatement of
 * it is exactly the second copy that drifts. So the page is cut from the fully
 * filtered set — short pages are impossible, `total` is honest — at the cost of
 * reading every candidate on every request.
 *
 * That cost is bounded by the audience this product has (a friends-scale app,
 * dozens of public leagues at most — the same bound FB-2's audit was written
 * against). If public leagues ever reach the thousands, the fix is to push the
 * start derivation into the query as a lateral join, not to slice the SQL and
 * let the app-level filters punch holes in the pages.
 */
export async function discoverLeagues(
  db: Db,
  clock: Clock,
  userId: string,
  input: DiscoveryQuery,
): Promise<DiscoveryResponse> {
  const current = currentLeagueSeason(db);
  const conditions = [
    eq(leagues.visibility, LEAGUE_VISIBILITY.PUBLIC),
    // Status is per-season now (ADR-0009) — filter the current instance's.
    eq(current.status, LEAGUE_STATUS.ACTIVE),
    // Excludes leagues the caller already belongs to — joining is pointless
    // and the join endpoints would 409 anyway.
    notExists(
      db
        .select()
        .from(leagueMembers)
        .where(and(eq(leagueMembers.leagueId, leagues.id), eq(leagueMembers.userId, userId))),
    ),
  ];
  if (input.query) {
    conditions.push(ilike(leagues.name, `%${escapeLikePattern(input.query)}%`));
  }
  if (input.mode) {
    conditions.push(eq(leagues.mode, input.mode));
  }

  const emptyPage: DiscoveryResponse = {
    leagues: [],
    page: 1,
    pageSize: DISCOVERY_PAGE_SIZE,
    total: 0,
    totalPages: 0,
  };

  const rows = await db
    .select({
      league: leagues,
      settings: current.settings,
      seasonId: current.seasonId,
      seasonYear: current.seasonYear,
    })
    .from(leagues)
    .innerJoin(current, and(eq(current.leagueId, leagues.id), eq(current.rank, 1)))
    .where(and(...conditions))
    // Id last so the order is total. Two leagues created in the same
    // transaction share a `created_at`, and an order with ties has no defined
    // row sequence — under paging that is a league appearing on two pages, or
    // on none, depending on what the planner felt like.
    .orderBy(desc(leagues.createdAt), asc(leagues.id));
  if (rows.length === 0) return emptyPage;

  const counts = await db
    .select({ leagueId: leagueMembers.leagueId, value: count() })
    .from(leagueMembers)
    .where(
      inArray(
        leagueMembers.leagueId,
        rows.map((r) => r.league.id),
      ),
    )
    .groupBy(leagueMembers.leagueId);
  const countByLeague = new Map(counts.map((c) => [c.leagueId, c.value]));

  // One start-derivation query per candidate league: see the bound above, and
  // correctness (override-aware, per-mode) beats a hand-rolled batch join —
  // same tradeoff as listMyLeagues.
  const withStarts = await Promise.all(
    rows.map(async (row) => ({
      row,
      memberCount: countByLeague.get(row.league.id) ?? 0,
      startsAt: await leagueStartAt(
        db,
        { mode: row.league.mode, seasonId: row.seasonId },
        row.settings,
      ),
    })),
  );

  const joinable = withStarts.filter(
    ({ row, memberCount, startsAt }) =>
      isPreStart(startsAt, clock) && memberCount < row.league.maxMembers,
  );

  // Fullest-first among leagues that still have room (ADR-0037): a league two
  // members short of playing is the one worth filling, and every league sitting
  // half-empty is the outcome a newest-first list produces. That means *fewest*
  // spots remaining first — the owner's ask said "available space descending"
  // and gave the reason as filling nearly-full leagues, which is the ascending
  // order; the reason is what this implements.
  //
  // `sort` is stable and the rows arrive in the SQL's total order, so creation
  // order survives as the tiebreak without a second comparator — which it must,
  // or a league would change pages between two requests that saw the same data.
  const spaceLeft = (entry: (typeof joinable)[number]) =>
    entry.row.league.maxMembers - entry.memberCount;
  const ordered = [...joinable].sort((a, b) => spaceLeft(a) - spaceLeft(b));

  const total = ordered.length;
  const totalPages = Math.ceil(total / DISCOVERY_PAGE_SIZE);
  if (total === 0) return emptyPage;
  // Clamped rather than served empty: a page number can outlive the list it was
  // valid for (a league fills, the caller joins one), and a pager that answers
  // "nothing here" for a list that plainly has entries reads as a bug.
  const page = Math.min(Math.max(input.page, 1), totalPages);
  const start = (page - 1) * DISCOVERY_PAGE_SIZE;

  const serialized: DiscoveryLeague[] = ordered
    .slice(start, start + DISCOVERY_PAGE_SIZE)
    .map(({ row, memberCount, startsAt }) => ({
      id: row.league.id,
      name: row.league.name,
      mode: row.league.mode,
      memberCount,
      maxMembers: row.league.maxMembers,
      seasonYear: row.seasonYear,
      startsAt: startsAt ? startsAt.toISOString() : null,
      pickemSettings: pickemSettingsSummary(row.league.mode, row.settings),
    }));

  return { leagues: serialized, page, pageSize: DISCOVERY_PAGE_SIZE, total, totalPages };
}
