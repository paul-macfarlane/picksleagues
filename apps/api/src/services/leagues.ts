import { and, asc, count, eq, gte, inArray, sql } from "drizzle-orm";
import { DatabaseError } from "pg";
import type { Db } from "@picksleagues/db";
import {
  games,
  leagueMembers,
  leagues,
  leagueSettings,
  sportSeasons,
  users,
  weeks,
} from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  JOIN_BLOCKED_REASON,
  LEAGUE_MODE,
  LEAGUE_SETTINGS_SCHEMAS,
  LEAGUE_STATUS,
  LEAGUE_VISIBILITY,
  MAX_ACTIVE_COMMISSIONER_LEAGUES,
  MAX_LEAGUE_SIZE,
  MEMBER_ROLE,
  SPORT,
  type CreateLeagueRequest,
  type JoinBlockedReason,
  type LeagueMember,
  type LeagueResponse,
  type LeagueSettings,
  type LeagueSummary,
  type LeagueVisibility,
  type NflWeekRef,
  type Sport,
} from "@picksleagues/schemas";

type LeagueRow = typeof leagues.$inferSelect;

/** The sport whose seasons a mode's leagues bind to. */
function sportForMode(mode: CreateLeagueRequest["mode"]): Sport {
  return mode === LEAGUE_MODE.MARCH_MADNESS ? SPORT.NCAAMB : SPORT.NFL;
}

/**
 * Clock-derived league start (arch §Locking Model): the join cutoff and every
 * pre/post-start commissioner window compare against this single boundary.
 * NFL modes: earliest kickoff in the settings start week. March Madness:
 * earliest kickoff outside week 1 — the First Four (not picked, spec
 * §Bracket Structure) is modeled as the tournament's first week; revisit when
 * epic 07 fixes the NCAAMB week model (MM leagues can't exist before then —
 * creation requires an ingested NCAAMB season).
 *
 * Null (no games ingested for that week yet) means the league has not
 * started. Kickoffs resolve `override_kickoff_at ?? kickoff_at` (arch D15):
 * lock-derivation must follow a corrected kickoff, same as the serializers.
 */
export async function leagueStartAt(
  db: Db,
  league: Pick<LeagueRow, "mode" | "seasonId">,
  settings: LeagueSettings,
): Promise<Date | null> {
  // Raw SQL fragments skip drizzle's column decoders (the driver hands back a
  // string), so the aggregate maps its own value back to a Date.
  const earliestKickoff =
    sql`min(coalesce(${games.overrideKickoffAt}, ${games.kickoffAt}))`.mapWith(
      (value): Date | null => (value === null ? null : new Date(value as string)),
    );

  if (league.mode === LEAGUE_MODE.MARCH_MADNESS) {
    const [row] = await db
      .select({ startsAt: earliestKickoff })
      .from(games)
      .innerJoin(weeks, eq(games.weekId, weeks.id))
      .where(and(eq(weeks.seasonId, league.seasonId), gte(weeks.weekNumber, 2)));
    return row?.startsAt ?? null;
  }

  const startWeek = (settings as { startWeek: NflWeekRef }).startWeek;
  const [row] = await db
    .select({ startsAt: earliestKickoff })
    .from(games)
    .innerJoin(weeks, eq(games.weekId, weeks.id))
    .where(
      and(
        eq(weeks.seasonId, league.seasonId),
        eq(weeks.weekType, startWeek.type),
        eq(weeks.weekNumber, startWeek.number),
      ),
    );
  return row?.startsAt ?? null;
}

/** Pre-start = no derivable start yet, or the start is still in the future. */
export function isPreStart(startsAt: Date | null, clock: Clock): boolean {
  return startsAt === null || clock.now().getTime() < startsAt.getTime();
}

export type CreateLeagueResult =
  { ok: true; league: LeagueResponse } | { ok: false; reason: "no_active_season" | "cap_exceeded" };

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
  const now = clock.now();

  try {
    const league = await db.transaction(async (tx) => {
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

/**
 * Counts the caller's commissioner roles across active leagues — the
 * spec §Limits cap. Shared by create (above) and promote (LG-6), both of
 * which run it inside their mutating transaction.
 */
export async function countActiveCommissionerships(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(leagueMembers)
    .innerJoin(leagues, eq(leagueMembers.leagueId, leagues.id))
    .where(
      and(
        eq(leagueMembers.userId, userId),
        eq(leagueMembers.role, MEMBER_ROLE.COMMISSIONER),
        eq(leagues.status, LEAGUE_STATUS.ACTIVE),
      ),
    );
  return row?.value ?? 0;
}

/**
 * Aborts a join transaction with the exact refusal — thrown (not returned) so
 * any writes already made inside the tx (e.g. an invite use-count increment)
 * roll back with the refused join.
 */
export class JoinRefusedError extends Error {
  readonly reason: JoinBlockedReason;

  constructor(reason: JoinBlockedReason) {
    super(`join refused: ${reason}`);
    this.reason = reason;
  }
}

/**
 * Membership-rule core shared by invite joins and public joins (spec
 * §Membership), run INSIDE the caller's transaction:
 * 1. already a member → refuse (the unique constraint is the race backstop);
 * 2. league concluded → refuse;
 * 3. clock-derived join cutoff — the league has started (arch §Locking
 *    Model: same boundary as pre-start windows) → refuse;
 * 4. insert, then re-count: over 100 members → refuse (rolls back the
 *    insert, so the check-then-act is collapsed into the tx).
 */
export async function joinLeagueInTx(
  tx: Db,
  clock: Clock,
  league: Pick<LeagueRow, "id" | "mode" | "seasonId" | "status">,
  settings: LeagueSettings,
  userId: string,
): Promise<void> {
  if (await getMembership(tx, league.id, userId)) {
    throw new JoinRefusedError(JOIN_BLOCKED_REASON.ALREADY_MEMBER);
  }
  if (league.status !== LEAGUE_STATUS.ACTIVE) {
    throw new JoinRefusedError(JOIN_BLOCKED_REASON.LEAGUE_CONCLUDED);
  }
  const startsAt = await leagueStartAt(tx, league, settings);
  if (!isPreStart(startsAt, clock)) {
    throw new JoinRefusedError(JOIN_BLOCKED_REASON.JOIN_CLOSED);
  }

  const now = clock.now();
  try {
    await tx.insert(leagueMembers).values({
      leagueId: league.id,
      userId,
      role: MEMBER_ROLE.MEMBER,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (isUniqueViolation(error, "league_members_league_user_unique")) {
      throw new JoinRefusedError(JOIN_BLOCKED_REASON.ALREADY_MEMBER);
    }
    throw error;
  }

  if ((await countMembers(tx, league.id)) > MAX_LEAGUE_SIZE) {
    throw new JoinRefusedError(JOIN_BLOCKED_REASON.LEAGUE_FULL);
  }
}

/** drizzle wraps the pg DatabaseError as the DrizzleQueryError's `.cause`. */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  return (
    cause instanceof DatabaseError && cause.code === "23505" && cause.constraint === constraint
  );
}

export type JoinResult =
  | { ok: true; league: LeagueResponse }
  | { ok: false; reason: JoinBlockedReason | "league_not_found" };

/**
 * Direct join for discoverable leagues (spec §Visibility: public leagues are
 * joinable without a code). Private leagues 404 — joining them requires an
 * invite, and their existence stays hidden.
 */
export async function joinPublicLeague(
  db: Db,
  clock: Clock,
  leagueId: string,
  userId: string,
): Promise<JoinResult> {
  const [row] = await db
    .select({ league: leagues, settings: leagueSettings.settings })
    .from(leagues)
    .innerJoin(leagueSettings, eq(leagueSettings.leagueId, leagues.id))
    .where(and(eq(leagues.id, leagueId), eq(leagues.visibility, LEAGUE_VISIBILITY.PUBLIC)));
  if (!row) return { ok: false, reason: "league_not_found" };

  try {
    await db.transaction(async (tx) => {
      await joinLeagueInTx(tx, clock, row.league, row.settings, userId);
    });
  } catch (error) {
    if (error instanceof JoinRefusedError) {
      return { ok: false, reason: error.reason };
    }
    throw error;
  }

  const league = await getLeague(db, leagueId, userId);
  if (!league) throw new Error("Joined league unreadable immediately after join.");
  return { ok: true, league };
}

export type UpdateLeagueResult =
  | { ok: true; league: LeagueResponse }
  | {
      ok: false;
      reason: "league_not_found" | "not_commissioner" | "league_started";
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
    const membership = await getMembership(tx, leagueId, userId);
    if (!membership) return { ok: false, reason: "league_not_found" };
    if (membership.role !== MEMBER_ROLE.COMMISSIONER) {
      return { ok: false, reason: "not_commissioner" };
    }

    const [row] = await tx
      .select({ league: leagues, settings: leagueSettings.settings })
      .from(leagues)
      .innerJoin(leagueSettings, eq(leagueSettings.leagueId, leagues.id))
      .where(eq(leagues.id, leagueId));
    if (!row) return { ok: false, reason: "league_not_found" };

    const wantsLockedEdit = input.visibility !== undefined || input.settings !== undefined;
    if (wantsLockedEdit) {
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
    const membership = await getMembership(tx, leagueId, userId);
    if (!membership) return { ok: false, reason: "league_not_found" as const };
    if (membership.role !== MEMBER_ROLE.COMMISSIONER) {
      return { ok: false, reason: "not_commissioner" as const };
    }

    const [row] = await tx
      .select({ league: leagues, settings: leagueSettings.settings })
      .from(leagues)
      .innerJoin(leagueSettings, eq(leagueSettings.leagueId, leagues.id))
      .where(eq(leagues.id, leagueId));
    if (!row) return { ok: false, reason: "league_not_found" as const };

    const startsAt = await leagueStartAt(tx, row.league, row.settings);
    if (!isPreStart(startsAt, clock)) {
      return { ok: false, reason: "league_started" as const };
    }

    await tx.delete(leagues).where(eq(leagues.id, leagueId));
    return { ok: true as const };
  });
}

/** The caller's membership row in a league, or null — the shared authz probe. */
export async function getMembership(
  db: Db,
  leagueId: string,
  userId: string,
): Promise<typeof leagueMembers.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(leagueMembers)
    .where(and(eq(leagueMembers.leagueId, leagueId), eq(leagueMembers.userId, userId)));
  return row ?? null;
}

export async function countMembers(db: Db, leagueId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(leagueMembers)
    .where(eq(leagueMembers.leagueId, leagueId));
  return row?.value ?? 0;
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

async function loadMembers(
  db: Db,
  leagueId: string,
): Promise<Array<{ member: typeof leagueMembers.$inferSelect; user: typeof users.$inferSelect }>> {
  return db
    .select({ member: leagueMembers, user: users })
    .from(leagueMembers)
    .innerJoin(users, eq(leagueMembers.userId, users.id))
    .where(eq(leagueMembers.leagueId, leagueId))
    .orderBy(asc(leagueMembers.createdAt));
}

function serializeMember(row: {
  member: typeof leagueMembers.$inferSelect;
  user: typeof users.$inferSelect;
}): LeagueMember {
  return {
    id: row.member.id,
    userId: row.user.id,
    username: row.user.username,
    displayName: row.user.display_name,
    image: row.user.image,
    role: row.member.role,
    joinedAt: row.member.createdAt.toISOString(),
  };
}

function serializeLeague(
  league: LeagueRow,
  seasonYear: number,
  settings: LeagueSettings,
  startsAt: Date | null,
  members: Array<{ member: typeof leagueMembers.$inferSelect; user: typeof users.$inferSelect }>,
  viewerId: string,
): LeagueResponse {
  // The viewer is always among `members` (getLeague joins on their own
  // membership; createLeague just inserted it) — the fallback is for types.
  const myRole = members.find((m) => m.user.id === viewerId)?.member.role ?? MEMBER_ROLE.MEMBER;
  return {
    id: league.id,
    name: league.name,
    mode: league.mode,
    visibility: league.visibility,
    status: league.status,
    seasonYear,
    settings,
    startsAt: startsAt ? startsAt.toISOString() : null,
    myRole,
    members: members.map(serializeMember),
  };
}
