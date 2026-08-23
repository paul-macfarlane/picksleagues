import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { leagueMembers, leagueSeasons, leagues } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  LEAGUE_ACTION,
  LEAGUE_MODE,
  LEAGUE_SETTINGS_SCHEMAS,
  LEAGUE_STATUS,
  MAX_ACTIVE_COMMISSIONER_LEAGUES,
  MEMBER_ROLE,
  OFFERED_LEAGUE_MODES,
  leagueActionIsPreStartOnly,
  type CreateLeagueRequest,
  type LeagueAction,
  type LeagueMode,
  type LeagueResponse,
  type LeagueSummary,
  type LeagueVisibility,
} from "@picksleagues/schemas";
import { logInfo } from "../../lib/logger";
import { loadSeasonWeeks, resolveCurrentWeekLabel } from "../league-weeks";
import { resolvePickemPickStatuses } from "../pickem/pick-status";
import { resolvePickemViewerStandings } from "../pickem/viewer-standing";
import { resolveSurvivorPickStatuses } from "../survivor/pick-status";
import { resolveSurvivorViewerStandings } from "../survivor/viewer-standing";
import { resetPicksInvalidatedBySettings } from "./settings-reset";
import { isPreStart, leagueStartAt } from "./start";
import { resolveLeagueSettings } from "./season-range";
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
  | {
      ok: false;
      reason: "mode_unavailable" | "no_active_season" | "cap_exceeded" | "start_week_passed";
    };

class CapExceededError extends Error {}

export async function createLeague(
  db: Db,
  clock: Clock,
  userId: string,
  input: CreateLeagueRequest,
): Promise<CreateLeagueResult> {
  // Server-side gate, not just a hidden form option (LNCH-12): the contract
  // still accepts the value and the SPA is not the only thing that may speak it.
  if (!(OFFERED_LEAGUE_MODES as readonly LeagueMode[]).includes(input.mode)) {
    return { ok: false, reason: "mode_unavailable" };
  }

  // Latest ingested season for the mode's sport — leagues bind to a season at
  // creation so cutoffs/windows know which games to derive from.
  const season = await latestSeasonForSport(db, sportForMode(input.mode));
  if (!season) {
    return { ok: false, reason: "no_active_season" };
  }

  // Second line of defense behind the route's discriminated union; also
  // applies schema defaults if the service is ever called directly. Both NFL
  // modes' regular-season ranges resolve to concrete week refs here
  // (ADR-0024/0031, under ADR-0020's mid-week rule) — the stored settings are
  // the resolved fact, never the request.
  const resolved = await resolveLeagueSettings(db, clock, input.mode, season.id, input.settings);
  if (!resolved.ok) {
    throw new Error(
      `League settings failed validation after the route accepted them: ${resolved.message}`,
    );
  }
  const settings = resolved.settings;

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
  | { ok: false; reason: "max_members_below_member_count" }
  | { ok: false; reason: "picks_locked" };

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
      // Re-resolves against the clock as it stands now (ADR-0020's rule, kept
      // by ADR-0024/0031): no field on the wire names a range anymore, but the
      // clock can still move it — a stored start week that has emptied and
      // passed re-resolves forward under a byte-identical request. This is the
      // last moment it can happen, since settings lock at league start.
      const resolved = await resolveLeagueSettings(
        tx,
        clock,
        league.mode,
        season.seasonId,
        input.settings,
      );
      if (!resolved.ok) {
        return { ok: false, reason: "invalid_settings", message: resolved.message };
      }
      const nextSettings = resolved.settings;
      // The gate above checked the OLD start week; the new settings must not
      // move the start into the past either — that would instantly start (and
      // permanently freeze) the league, same trap as creating one post-start.
      const newStartsAt = await leagueStartAt(
        tx,
        { mode: league.mode, seasonId: season.seasonId },
        nextSettings,
      );
      if (!isPreStart(newStartsAt, clock)) {
        return { ok: false, reason: "start_week_passed" };
      }
      // A rule change can strand picks made under the old rules (a pick with no
      // spread in a now-ATS league is unsettleable), so clearing them commits
      // with the settings write and the two can never disagree — but only while
      // no pick has locked, since a locked pick is already revealed and possibly
      // settled.
      //
      // Under submit-once (ADR-0018) this reset carries a second job: it is the
      // ONLY path by which a member re-submits a week, because it deletes the
      // very picks `already_submitted` keys on. It is therefore also the only
      // remedy for a submission a member regrets — deliberately narrow, since it
      // is a commissioner action, pre-start-only, and refused once anything has
      // locked.
      //
      // Ordered BEFORE the settings write on purpose: every refusal in this
      // transaction *returns* rather than throws, and Drizzle commits whenever
      // the callback resolves normally. A refusal after a write would therefore
      // return 409 and still persist the change. Every `return { ok: false }`
      // here must stay ahead of every write.
      const pickReset = await resetPicksInvalidatedBySettings(
        tx,
        clock,
        league.mode,
        season.id,
        season.settings,
        nextSettings,
      );
      if (!pickReset.ok) return { ok: false, reason: pickReset.reason };

      // Settings live on the current instance now (ADR-0009).
      await tx
        .update(leagueSeasons)
        .set({ settings: nextSettings, updatedAt: now })
        .where(eq(leagueSeasons.id, season.id));

      if (pickReset.cleared > 0) {
        logInfo("league.settings-reset-picks", {
          leagueId,
          leagueSeasonId: season.id,
          clearedPicks: pickReset.cleared,
        });
      }
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

export async function listMyLeagues(
  db: Db,
  clock: Clock,
  userId: string,
): Promise<LeagueSummary[]> {
  const current = currentLeagueSeason(db);
  const rows = await db
    .select({
      league: leagues,
      leagueSeasonId: current.instanceId,
      settings: current.settings,
      status: current.status,
      seasonId: current.seasonId,
      seasonYear: current.seasonYear,
      myRole: leagueMembers.role,
      membershipId: leagueMembers.id,
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

  // Both modes' glances ride this payload rather than a per-card fetch: this is
  // the list the dashboard already renders from, and a request per card is the
  // N+1 a member in many leagues pays on every load. Resolved for all of them at
  // once for the same reason, and the two modes concurrently because neither
  // reads what the other writes. Settings are parsed rather than trusted so
  // schema defaults materialize on rows written before a field existed.
  const survivorInputs = rows.flatMap((row) =>
    row.league.mode === LEAGUE_MODE.SURVIVOR
      ? [
          {
            leagueSeasonId: row.leagueSeasonId,
            leagueId: row.league.id,
            seasonId: row.seasonId,
            membershipId: row.membershipId,
            settings: LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.SURVIVOR].parse(row.settings),
            status: row.status,
          },
        ]
      : [],
  );
  const pickemInputs = rows.flatMap((row) =>
    row.league.mode === LEAGUE_MODE.PICKEM
      ? [
          {
            leagueSeasonId: row.leagueSeasonId,
            leagueId: row.league.id,
            seasonId: row.seasonId,
            membershipId: row.membershipId,
            settings: LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.PICKEM].parse(row.settings),
            status: row.status,
          },
        ]
      : [],
  );
  // The viewer's standing rides the same payload as the glance and for the same
  // reason: the hub card's numerals must not cost a board fetch per league.
  const [survivorStatuses, pickemStatuses, survivorStandings, pickemStandings] = await Promise.all([
    resolveSurvivorPickStatuses(db, clock, survivorInputs),
    resolvePickemPickStatuses(db, clock, pickemInputs),
    resolveSurvivorViewerStandings(db, survivorInputs),
    resolvePickemViewerStandings(db, pickemInputs),
  ]);

  // Weeks for every season on the dashboard in one read — cards overwhelmingly
  // share a season, so this is one query rather than one per card (FB-28).
  const weeksBySeason = await loadSeasonWeeks(
    db,
    rows.map((row) => row.seasonId),
  );

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
        currentWeekLabel: resolveCurrentWeekLabel(
          weeksBySeason.get(row.seasonId) ?? [],
          { mode: row.league.mode, settings: row.settings },
          clock,
        ),
        renewable: isRenewable(
          latestBySport.get(sportForMode(row.league.mode)) ?? null,
          row.seasonYear,
        ),
        survivorPickStatus: survivorStatuses.get(row.leagueSeasonId) ?? null,
        pickemPickStatus: pickemStatuses.get(row.leagueSeasonId) ?? null,
        seasonYear: row.seasonYear,
        myPickemStanding: pickemStandings.get(row.leagueSeasonId) ?? null,
        mySurvivorStanding: survivorStandings.get(row.leagueSeasonId) ?? null,
      };
    }),
  );
}
