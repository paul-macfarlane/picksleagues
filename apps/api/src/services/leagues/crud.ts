import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { leagueMembers, leagueSeasons, leagues } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  LEAGUE_ACTION,
  LEAGUE_SETTINGS_SCHEMAS,
  LEAGUE_STATUS,
  MAX_ACTIVE_COMMISSIONER_LEAGUES,
  MEMBER_ROLE,
  leagueActionIsPreStartOnly,
  type CreateLeagueRequest,
  type LeagueAction,
  type LeagueResponse,
  type LeagueSummary,
  type LeagueVisibility,
} from "@picksleagues/schemas";
import { isPreStart, leagueStartAt } from "./start";
import { lockLeagueRow, lockUserRow } from "./locks";
import {
  authorizeLeagueAction,
  countActiveCommissionerships,
  countMembers,
  getMembership,
} from "./authz";
import {
  currentLeagueSeason,
  getLeagueWithCurrentSeason,
  isRenewable,
  latestSeasonForSport,
  latestSeasonYearBySport,
  readAndSerializeLeague,
  sportForMode,
} from "./current-season";

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
  const season = await latestSeasonForSport(db, sportForMode(input.mode));
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
          maxMembers: input.maxMembers,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) {
        throw new Error("League insert returned no row.");
      }

      // The league's first season instance (ADR-0009) — carries the per-season
      // settings/status and the season anchor locks derive from.
      await tx.insert(leagueSeasons).values({
        leagueId: created.id,
        seasonId: season.id,
        settings,
        status: LEAGUE_STATUS.ACTIVE,
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

    // Same assembly `getLeague`/renewal serialize through, re-read post-commit
    // (accepted extra read — this path isn't hot, and the output is identical
    // to hand-assembling it from the just-inserted rows).
    const serialized = await readAndSerializeLeague(db, league.id, userId);
    if (!serialized) throw new Error("Created league unreadable immediately after creation.");
    return { ok: true, league: serialized };
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
  | { ok: false; reason: "invalid_settings"; message: string }
  | { ok: false; reason: "max_members_below_member_count" };

/**
 * Commissioner edits (spec §Commissioner Powers): name is cosmetic and
 * changeable anytime; visibility, mode settings, and maxMembers lock at
 * league start — the pre-start check runs inside the same transaction as the
 * write so a kickoff passing mid-request can't slip an edit through.
 */
export async function updateLeague(
  db: Db,
  clock: Clock,
  leagueId: string,
  userId: string,
  input: {
    name?: string;
    visibility?: LeagueVisibility;
    maxMembers?: number;
    settings?: unknown;
  },
): Promise<UpdateLeagueResult> {
  const refusal = await db.transaction(async (tx): Promise<UpdateLeagueResult | null> => {
    // Serializes this edit's member-count invariant (maxMembers can't drop
    // below the current roster) against concurrent joins on the same league
    // (locks.ts: every count-after-write invariant needs the league lock).
    await lockLeagueRow(tx, leagueId);

    // One PATCH can carry several field-level actions; all share the
    // commissioner role axis, but only some carry the pre-start window —
    // the matrix decides which (name is the lone anytime edit). maxMembers
    // rides EDIT_SETTINGS: same commissionerOnly + preStartOnly window as
    // mode settings.
    const requestedActions: LeagueAction[] = [
      ...(input.name !== undefined ? [LEAGUE_ACTION.EDIT_NAME] : []),
      ...(input.visibility !== undefined ? [LEAGUE_ACTION.EDIT_VISIBILITY] : []),
      ...(input.settings !== undefined || input.maxMembers !== undefined
        ? [LEAGUE_ACTION.EDIT_SETTINGS]
        : []),
    ];
    const gate = await authorizeLeagueAction(
      tx,
      leagueId,
      userId,
      // The request schema guarantees at least one field.
      requestedActions[0] ?? LEAGUE_ACTION.EDIT_NAME,
    );
    if (!gate.ok) return gate;

    // Read the current instance inside the same tx AFTER the lock so the
    // window/roster invariants below stay serialized against concurrent joins.
    const current = await getLeagueWithCurrentSeason(tx, leagueId);
    if (!current) return { ok: false, reason: "league_not_found" };
    const { league, season } = current;

    if (requestedActions.some(leagueActionIsPreStartOnly)) {
      const startsAt = await leagueStartAt(
        tx,
        { mode: league.mode, seasonId: season.seasonId },
        season.settings,
      );
      if (!isPreStart(startsAt, clock)) {
        return { ok: false, reason: "league_started" };
      }
    }

    if (input.maxMembers !== undefined) {
      // Lowering the cap below the current roster would strand existing
      // members outside their own league's limit — refuse rather than
      // silently accepting an unenforceable cap.
      const memberCount = await countMembers(tx, leagueId);
      if (input.maxMembers < memberCount) {
        return { ok: false, reason: "max_members_below_member_count" };
      }
    }

    const now = clock.now();
    if (input.settings !== undefined) {
      const parsed = LEAGUE_SETTINGS_SCHEMAS[league.mode].safeParse(input.settings);
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
      const newStartsAt = await leagueStartAt(
        tx,
        { mode: league.mode, seasonId: season.seasonId },
        parsed.data,
      );
      if (!isPreStart(newStartsAt, clock)) {
        return { ok: false, reason: "start_week_passed" };
      }
      // Settings live on the current instance now (ADR-0009).
      await tx
        .update(leagueSeasons)
        .set({ settings: parsed.data, updatedAt: now })
        .where(eq(leagueSeasons.id, season.id));
    }

    if (
      input.name !== undefined ||
      input.visibility !== undefined ||
      input.maxMembers !== undefined
    ) {
      await tx
        .update(leagues)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
          ...(input.maxMembers !== undefined ? { maxMembers: input.maxMembers } : {}),
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

    const current = await getLeagueWithCurrentSeason(tx, leagueId);
    if (!current) return { ok: false, reason: "league_not_found" as const };

    if (leagueActionIsPreStartOnly(LEAGUE_ACTION.DELETE_LEAGUE)) {
      const startsAt = await leagueStartAt(
        tx,
        { mode: current.league.mode, seasonId: current.season.seasonId },
        current.season.settings,
      );
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
  // Membership is the visibility gate — non-members get null (route 404s), so a
  // private league is indistinguishable from an absent one.
  if (!(await getMembership(db, leagueId, userId))) return null;

  return readAndSerializeLeague(db, leagueId, userId);
}

export async function listMyLeagues(db: Db, userId: string): Promise<LeagueSummary[]> {
  const current = currentLeagueSeason(db);
  const rows = await db
    .select({
      league: leagues,
      settings: current.settings,
      status: current.status,
      seasonId: current.seasonId,
      seasonYear: current.seasonYear,
      myRole: leagueMembers.role,
    })
    .from(leagueMembers)
    .innerJoin(leagues, eq(leagueMembers.leagueId, leagues.id))
    .innerJoin(current, and(eq(current.leagueId, leagues.id), eq(current.rank, 1)))
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

  // The per-sport latest ingested year, fetched once (not per league) — the
  // `renewable` signal compares each league's current-instance year against it.
  const latestBySport = await latestSeasonYearBySport(db);

  // One start-derivation query per league: fine at this scale (a user's
  // dashboard holds a handful of leagues), and correctness (override-aware,
  // per-mode) beats a hand-rolled batch join.
  return Promise.all(
    rows.map(async (row) => {
      const startsAt = await leagueStartAt(
        db,
        { mode: row.league.mode, seasonId: row.seasonId },
        row.settings,
      );
      return {
        id: row.league.id,
        name: row.league.name,
        mode: row.league.mode,
        visibility: row.league.visibility,
        status: row.status,
        memberCount: countByLeague.get(row.league.id) ?? 0,
        maxMembers: row.league.maxMembers,
        myRole: row.myRole,
        startsAt: startsAt ? startsAt.toISOString() : null,
        renewable: isRenewable(
          latestBySport.get(sportForMode(row.league.mode)) ?? null,
          row.seasonYear,
        ),
      };
    }),
  );
}
