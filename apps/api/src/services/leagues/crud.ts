import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { leagueMembers, leagues, leagueSettings, sportSeasons } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  LEAGUE_ACTION,
  LEAGUE_MODE,
  LEAGUE_SETTINGS_SCHEMAS,
  LEAGUE_STATUS,
  MAX_ACTIVE_COMMISSIONER_LEAGUES,
  MEMBER_ROLE,
  SPORT,
  leagueActionIsPreStartOnly,
  type CreateLeagueRequest,
  type LeagueAction,
  type LeagueResponse,
  type LeagueSummary,
  type LeagueVisibility,
  type Sport,
} from "@picksleagues/schemas";
import { isPreStart, leagueStartAt } from "./start";
import { lockUserRow } from "./locks";
import { authorizeLeagueAction, countActiveCommissionerships } from "./authz";
import { loadMembers, serializeLeague } from "./serialize";

/** The sport whose seasons a mode's leagues bind to. */
function sportForMode(mode: CreateLeagueRequest["mode"]): Sport {
  return mode === LEAGUE_MODE.MARCH_MADNESS ? SPORT.NCAAMB : SPORT.NFL;
}

export type CreateLeagueResult =
  | { ok: true; league: LeagueResponse }
  | { ok: false; reason: "no_active_season" | "cap_exceeded" | "start_week_passed" };

class CapExceededError extends Error {}

export async function createLeague(
  db: Db,
  clock: Clock,
  userId: string,
  input: CreateLeagueRequest,
): Promise<CreateLeagueResult> {
  // Latest ingested season for the mode's sport — leagues bind to a season at
  // creation so cutoffs/windows know which games to derive from.
  const [season] = await db
    .select()
    .from(sportSeasons)
    .where(eq(sportSeasons.sport, sportForMode(input.mode)))
    .orderBy(sql`${sportSeasons.year} desc`)
    .limit(1);
  if (!season) {
    return { ok: false, reason: "no_active_season" };
  }

  // Second line of defense behind the route's discriminated union; also
  // applies schema defaults if the service is ever called directly.
  const settings = LEAGUE_SETTINGS_SCHEMAS[input.mode].parse(input.settings);

  // Spec §Creation: a league exists in a PRE-start state. A start week whose
  // kickoff already passed would be born started — joins closed, settings
  // locked, undeletable, unleavable — so refuse it up front. This is the
  // normal offseason shape (latest season fully played), not an edge case.
  const startsAtPreCheck = await leagueStartAt(
    db,
    { mode: input.mode, seasonId: season.id },
    settings,
  );
  if (!isPreStart(startsAtPreCheck, clock)) {
    return { ok: false, reason: "start_week_passed" };
  }

  const now = clock.now();

  try {
    const league = await db.transaction(async (tx) => {
      // Serializes the per-user cap count against concurrent creates/promotes.
      await lockUserRow(tx, userId);

      const [created] = await tx
        .insert(leagues)
        .values({
          name: input.name,
          mode: input.mode,
          visibility: input.visibility,
          status: LEAGUE_STATUS.ACTIVE,
          seasonId: season.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) {
        throw new Error("League insert returned no row.");
      }

      await tx.insert(leagueSettings).values({
        leagueId: created.id,
        settings,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(leagueMembers).values({
        leagueId: created.id,
        userId,
        role: MEMBER_ROLE.COMMISSIONER,
        createdAt: now,
        updatedAt: now,
      });

      // Cap check AFTER inserting so the count includes this league and the
      // transaction is the enforcement boundary (arch §Domain Model notes):
      // exceeding the cap rolls the whole creation back.
      const activeCommissionerships = await countActiveCommissionerships(tx, userId);
      if (activeCommissionerships > MAX_ACTIVE_COMMISSIONER_LEAGUES) {
        throw new CapExceededError();
      }

      return created;
    });

    const startsAt = await leagueStartAt(db, league, settings);
    const members = await loadMembers(db, league.id);
    return {
      ok: true,
      league: serializeLeague(league, season.year, settings, startsAt, members, userId),
    };
  } catch (error) {
    if (error instanceof CapExceededError) {
      return { ok: false, reason: "cap_exceeded" };
    }
    throw error;
  }
}

export type UpdateLeagueResult =
  | { ok: true; league: LeagueResponse }
  | {
      ok: false;
      reason: "league_not_found" | "not_commissioner" | "league_started" | "start_week_passed";
    }
  | { ok: false; reason: "invalid_settings"; message: string };

/**
 * Commissioner edits (spec §Commissioner Powers): name is cosmetic and
 * changeable anytime; visibility and mode settings lock at league start —
 * the pre-start check runs inside the same transaction as the write so a
 * kickoff passing mid-request can't slip an edit through.
 */
export async function updateLeague(
  db: Db,
  clock: Clock,
  leagueId: string,
  userId: string,
  input: { name?: string; visibility?: LeagueVisibility; settings?: unknown },
): Promise<UpdateLeagueResult> {
  const refusal = await db.transaction(async (tx): Promise<UpdateLeagueResult | null> => {
    // One PATCH can carry several field-level actions; all share the
    // commissioner role axis, but only some carry the pre-start window —
    // the matrix decides which (name is the lone anytime edit).
    const requestedActions: LeagueAction[] = [
      ...(input.name !== undefined ? [LEAGUE_ACTION.EDIT_NAME] : []),
      ...(input.visibility !== undefined ? [LEAGUE_ACTION.EDIT_VISIBILITY] : []),
      ...(input.settings !== undefined ? [LEAGUE_ACTION.EDIT_SETTINGS] : []),
    ];
    const gate = await authorizeLeagueAction(
      tx,
      leagueId,
      userId,
      // The request schema guarantees at least one field.
      requestedActions[0] ?? LEAGUE_ACTION.EDIT_NAME,
    );
    if (!gate.ok) return gate;

    const [row] = await tx
      .select({ league: leagues, settings: leagueSettings.settings })
      .from(leagues)
      .innerJoin(leagueSettings, eq(leagueSettings.leagueId, leagues.id))
      .where(eq(leagues.id, leagueId));
    if (!row) return { ok: false, reason: "league_not_found" };

    if (requestedActions.some(leagueActionIsPreStartOnly)) {
      const startsAt = await leagueStartAt(tx, row.league, row.settings);
      if (!isPreStart(startsAt, clock)) {
        return { ok: false, reason: "league_started" };
      }
    }

    const now = clock.now();
    if (input.settings !== undefined) {
      const parsed = LEAGUE_SETTINGS_SCHEMAS[row.league.mode].safeParse(input.settings);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "invalid_settings",
          message: parsed.error.issues[0]?.message ?? "Invalid settings.",
        };
      }
      // The gate above checked the OLD start week; the new settings must not
      // move the start into the past either — that would instantly start (and
      // permanently freeze) the league, same trap as creating one post-start.
      const newStartsAt = await leagueStartAt(tx, row.league, parsed.data);
      if (!isPreStart(newStartsAt, clock)) {
        return { ok: false, reason: "start_week_passed" };
      }
      await tx
        .update(leagueSettings)
        .set({ settings: parsed.data, updatedAt: now })
        .where(eq(leagueSettings.leagueId, leagueId));
    }

    if (input.name !== undefined || input.visibility !== undefined) {
      await tx
        .update(leagues)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
          updatedAt: now,
        })
        .where(eq(leagues.id, leagueId));
    }

    return null;
  });
  if (refusal) return refusal;

  const league = await getLeague(db, leagueId, userId);
  if (!league) throw new Error("Updated league unreadable immediately after update.");
  return { ok: true, league };
}

export type DeleteLeagueResult =
  { ok: true } | { ok: false; reason: "league_not_found" | "not_commissioner" | "league_started" };

/** Pre-start only (spec §Commissioner Powers); FK cascades sweep settings/members/invites. */
export async function deleteLeague(
  db: Db,
  clock: Clock,
  leagueId: string,
  userId: string,
): Promise<DeleteLeagueResult> {
  return db.transaction(async (tx) => {
    const gate = await authorizeLeagueAction(tx, leagueId, userId, LEAGUE_ACTION.DELETE_LEAGUE);
    if (!gate.ok) return gate;

    const [row] = await tx
      .select({ league: leagues, settings: leagueSettings.settings })
      .from(leagues)
      .innerJoin(leagueSettings, eq(leagueSettings.leagueId, leagues.id))
      .where(eq(leagues.id, leagueId));
    if (!row) return { ok: false, reason: "league_not_found" as const };

    if (leagueActionIsPreStartOnly(LEAGUE_ACTION.DELETE_LEAGUE)) {
      const startsAt = await leagueStartAt(tx, row.league, row.settings);
      if (!isPreStart(startsAt, clock)) {
        return { ok: false, reason: "league_started" as const };
      }
    }

    await tx.delete(leagues).where(eq(leagues.id, leagueId));
    return { ok: true as const };
  });
}

/**
 * League + settings + members, only for members — non-members get null and
 * the route 404s, so private leagues are indistinguishable from absent ones.
 */
export async function getLeague(
  db: Db,
  leagueId: string,
  userId: string,
): Promise<LeagueResponse | null> {
  const [row] = await db
    .select({
      league: leagues,
      settings: leagueSettings.settings,
      seasonYear: sportSeasons.year,
      myRole: leagueMembers.role,
    })
    .from(leagues)
    .innerJoin(leagueSettings, eq(leagueSettings.leagueId, leagues.id))
    .innerJoin(sportSeasons, eq(leagues.seasonId, sportSeasons.id))
    .innerJoin(
      leagueMembers,
      and(eq(leagueMembers.leagueId, leagues.id), eq(leagueMembers.userId, userId)),
    )
    .where(eq(leagues.id, leagueId));
  if (!row) return null;

  const startsAt = await leagueStartAt(db, row.league, row.settings);
  const members = await loadMembers(db, leagueId);
  return serializeLeague(row.league, row.seasonYear, row.settings, startsAt, members, userId);
}

export async function listMyLeagues(db: Db, userId: string): Promise<LeagueSummary[]> {
  const rows = await db
    .select({
      league: leagues,
      settings: leagueSettings.settings,
      myRole: leagueMembers.role,
    })
    .from(leagueMembers)
    .innerJoin(leagues, eq(leagueMembers.leagueId, leagues.id))
    .innerJoin(leagueSettings, eq(leagueSettings.leagueId, leagues.id))
    .where(eq(leagueMembers.userId, userId))
    .orderBy(asc(leagues.createdAt));
  if (rows.length === 0) return [];

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

  // One start-derivation query per league: fine at this scale (a user's
  // dashboard holds a handful of leagues), and correctness (override-aware,
  // per-mode) beats a hand-rolled batch join.
  return Promise.all(
    rows.map(async (row) => {
      const startsAt = await leagueStartAt(db, row.league, row.settings);
      return {
        id: row.league.id,
        name: row.league.name,
        mode: row.league.mode,
        visibility: row.league.visibility,
        status: row.league.status,
        memberCount: countByLeague.get(row.league.id) ?? 0,
        myRole: row.myRole,
        startsAt: startsAt ? startsAt.toISOString() : null,
      };
    }),
  );
}
