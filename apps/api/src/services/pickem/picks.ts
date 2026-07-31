import { and, count, countDistinct, eq, inArray } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { isUniqueViolation, pickemPickResults, pickemPicks } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  LEAGUE_ACTION,
  LEAGUE_MODE,
  LEAGUE_SETTINGS_SCHEMAS,
  LEAGUE_STATUS,
  PICK_TYPE,
  nflSeasonOrdinal,
  type PickemMemberPicks,
  type PickemPickSubmission,
  type PickemPickSummary,
  type PickemRepickRequest,
  type LeagueStatus,
  type PickemSettings,
  type PickemWeekPicksResponse,
} from "@picksleagues/schemas";
import { getLeagueWithCurrentSeason } from "../leagues/current-season";
import { authorizeLeagueAction, getMembership } from "../leagues/authz";
// Deep import by design: `serialize` is module-public so sibling domains can
// cross-import it without going through the leagues barrel (see leagues/index.ts).
import { loadMembers } from "../leagues/serialize";
import { lockLeagueMemberRow } from "../leagues/locks";
import {
  getWeek,
  loadMovedGameSummaries,
  loadResolvedWeekGames,
  resolveLockStates,
  type ResolvedSlateGame,
} from "../slate";
import { settleLeagueSeasonWeeks } from "./settlement";
import { logError } from "../../lib/logger";

/**
 * Pick'em pick entry (spec §Game Mode 1 — Core Rules, Locking, ATS spread
 * acceptance) and the kickoff-gated read path (spec §Pick Visibility).
 *
 * Two invariants carry this module and are re-validated inside the write
 * transaction rather than trusted from the pre-flight read (arch §Locking
 * Model): a pick may only be written while its game is unstarted, and in ATS
 * leagues the spread written must be the spread current at that instant.
 */

export const PICKEM_REFUSAL = {
  LEAGUE_NOT_FOUND: "league_not_found",
  WRONG_LEAGUE_MODE: "wrong_league_mode",
  LEAGUE_CONCLUDED: "league_concluded",
  WEEK_OUT_OF_RANGE: "week_out_of_range",
  GAME_NOT_IN_WEEK: "game_not_in_week",
  GAME_NOT_PICKABLE: "game_not_pickable",
  DUPLICATE_PICK: "duplicate_pick",
  TOO_MANY_PICKS: "too_many_picks",
  PICK_LOCKED: "pick_locked",
  SPREAD_STALE: "spread_stale",
  SPREAD_UNAVAILABLE: "spread_unavailable",
  PICK_NOT_FOUND: "pick_not_found",
  PICK_NOT_REPLACEABLE: "pick_not_replaceable",
  // Only the pick-summary read (commissioner-gated, see below) can produce
  // this — every other refusal in this file comes from the member-only
  // `loadContext` gate, which has no role axis.
  NOT_COMMISSIONER: "not_commissioner",
} as const;

export type PickemRefusal = (typeof PICKEM_REFUSAL)[keyof typeof PICKEM_REFUSAL];

/**
 * The refusals reachable from resolving and authorizing a league-week — all a
 * read can produce. Split from the full set so the read route doesn't have to
 * declare the write-only conflicts it can never emit. (The handler maps stay
 * keyed by the full set on purpose, so adding a reason is a compile error.)
 */
export type PickemReadRefusal = Extract<
  PickemRefusal,
  "league_not_found" | "wrong_league_mode" | "week_out_of_range"
>;

export type PickemResult<T, R extends PickemRefusal = PickemRefusal> =
  { ok: true; value: T } | { ok: false; reason: R };

// The role axis (`not_commissioner`) belongs to the pick-summary read alone —
// every write path here authorizes through `loadContext`'s membership-only
// gate and can never produce it. Naming the exclusion explicitly (rather than
// leaving the writes on the full `PickemRefusal` default) keeps each write
// route's declared OpenAPI response statuses accurate.
export type PickemWriteRefusal = Exclude<PickemRefusal, "not_commissioner">;

interface PickemContext {
  leagueSeasonId: string;
  membershipId: string;
  settings: PickemSettings;
  status: LeagueStatus;
}

/**
 * Resolves and authorizes everything both the read and write paths need. A
 * non-member gets `league_not_found`, indistinguishable from a league that
 * doesn't exist — private leagues stay hidden (matching `getLeague`).
 */
async function loadContext(
  db: Db,
  leagueId: string,
  weekId: string,
  userId: string,
): Promise<PickemResult<PickemContext, PickemReadRefusal>> {
  const current = await getLeagueWithCurrentSeason(db, leagueId);
  if (!current) return { ok: false, reason: PICKEM_REFUSAL.LEAGUE_NOT_FOUND };

  const membership = await getMembership(db, leagueId, userId);
  if (!membership) return { ok: false, reason: PICKEM_REFUSAL.LEAGUE_NOT_FOUND };

  if (current.league.mode !== LEAGUE_MODE.PICKEM) {
    return { ok: false, reason: PICKEM_REFUSAL.WRONG_LEAGUE_MODE };
  }

  // Parsed rather than trusted so schema defaults materialize on rows written
  // before a field existed (engineering rules §Data: settings JSONB evolves
  // additively).
  const settings = LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.PICKEM].parse(current.season.settings);

  const week = await getWeek(db, weekId);
  if (!week || week.seasonId !== current.season.seasonId) {
    return { ok: false, reason: PICKEM_REFUSAL.WEEK_OUT_OF_RANGE };
  }

  const weekOrdinal = nflSeasonOrdinal({ type: week.weekType, number: week.weekNumber });
  if (
    weekOrdinal < nflSeasonOrdinal(settings.startWeek) ||
    weekOrdinal > nflSeasonOrdinal(settings.endWeek)
  ) {
    return { ok: false, reason: PICKEM_REFUSAL.WEEK_OUT_OF_RANGE };
  }

  return {
    ok: true,
    value: {
      leagueSeasonId: current.season.id,
      membershipId: membership.id,
      settings,
      status: current.season.status,
    },
  };
}

/**
 * Spec §Fewer games than Picks Per Week: a short slate caps everyone at the
 * games actually available. Cancelled and moved games are not available, so
 * they don't raise the cap.
 */
function picksAllowedFor(picksPerWeek: number, slate: readonly ResolvedSlateGame[]): number {
  return Math.min(picksPerWeek, slate.filter((game) => game.pickable).length);
}

/**
 * The ATS spread-acceptance rule (spec §ATS spread acceptance), in one place —
 * both write paths enforce it and a change to the semantics must reach both.
 *
 * The two refusals are deliberately distinct because the member's next move
 * differs: no line has been captured yet (wait for the odds sync — there is
 * nothing to re-accept), versus the line moved under a submission in flight
 * (refetch and accept the new number). Straight-up leagues have no spread
 * dependency at all, so nothing is checked.
 */
function checkSpreadAccepted(
  settings: PickemSettings,
  game: ResolvedSlateGame,
  submitted: number | null,
): PickemWriteRefusal | null {
  if (settings.pickType !== PICK_TYPE.AGAINST_THE_SPREAD) return null;
  if (game.spread === null) return PICKEM_REFUSAL.SPREAD_UNAVAILABLE;
  if (submitted !== game.spread) return PICKEM_REFUSAL.SPREAD_STALE;
  return null;
}

export async function getPickemWeekPicks(
  db: Db,
  clock: Clock,
  leagueId: string,
  weekId: string,
  userId: string,
): Promise<PickemResult<PickemWeekPicksResponse, PickemReadRefusal>> {
  const context = await loadContext(db, leagueId, weekId, userId);
  if (!context.ok) return context;
  const { leagueSeasonId, settings } = context.value;

  const slate = await loadResolvedWeekGames(db, clock, weekId);
  const picksAllowed = picksAllowedFor(settings.picksPerWeek, slate);

  // Shared with the league page's roster so the two surfaces can't disagree
  // about member order, which is user-visible in both.
  const members = await loadMembers(db, leagueId);

  // Left join, because the absence of a result row IS the "not settled yet"
  // state (arch D10 — results are a pure derivation, written only once a game
  // reaches a terminal status). An inner join would silently drop every pick on
  // a game still to be played.
  const pickRows = await db
    .select({ pick: pickemPicks, outcome: pickemPickResults.outcome })
    .from(pickemPicks)
    .leftJoin(pickemPickResults, eq(pickemPickResults.pickemPickId, pickemPicks.id))
    .where(and(eq(pickemPicks.leagueSeasonId, leagueSeasonId), eq(pickemPicks.weekId, weekId)));
  const picks = pickRows.map((row) => ({ ...row.pick, outcome: row.outcome }));

  const pickedGameIds = picks.map((pick) => pick.gameId);
  const lockedByGame = await resolveLockStates(db, clock, pickedGameIds);
  // Only the picks whose game has left this week come back — everything else
  // renders from the slate the client already has.
  const movedGames = await loadMovedGameSummaries(db, pickedGameIds, weekId);

  const picksByMember = new Map<string, typeof picks>();
  for (const pick of picks) {
    const bucket = picksByMember.get(pick.leagueMemberId);
    if (bucket) bucket.push(pick);
    else picksByMember.set(pick.leagueMemberId, [pick]);
  }

  const serialized: PickemMemberPicks[] = members.map(({ member, user }) => {
    const own = picksByMember.get(member.id) ?? [];
    const isViewer = member.userId === userId;
    // The visibility rule itself (spec §Pick Visibility): another member's pick
    // is serialized only once its game has kicked off. Filtered here, never
    // shipped-and-hidden by the client.
    const visible = isViewer ? own : own.filter((pick) => lockedByGame.get(pick.gameId) === true);

    return {
      leagueMemberId: member.id,
      userId: user.id,
      username: user.username,
      displayName: user.display_name,
      image: user.image,
      isViewer,
      picks: visible.map((pick) => ({
        id: pick.id,
        gameId: pick.gameId,
        side: pick.side,
        spread: pick.spreadAtPick,
        // No extra visibility surface: a result exists only for a game that has
        // reached a terminal status, which is strictly later than the kickoff
        // the filter above already gates another member's picks on.
        outcome: pick.outcome,
        movedGame: movedGames.get(pick.gameId) ?? null,
        updatedAt: pick.updatedAt.toISOString(),
      })),
      hiddenPickCount: own.length - visible.length,
    };
  });

  return { ok: true, value: { weekId, picksAllowed, members: serialized } };
}

// The pick-summary read has a role axis the member-only `loadContext` gate
// doesn't (it's only ever consumed by the settings editor, which is
// commissioner-only), so its refusal set names `not_commissioner` alongside
// the two `loadContext` produces — never `week_out_of_range`, since this
// isn't scoped to a week.
export type PickemPickSummaryRefusal = Extract<
  PickemRefusal,
  "league_not_found" | "wrong_league_mode" | "not_commissioner"
>;

/**
 * How many picks — and how many distinct members holding at least one — sit
 * on the league's current season instance. This is the settings editor's
 * pre-save warning input (spec §Commissioner Powers), so its scope must
 * match `resetPicksInvalidatedBySettings` exactly (same `leagueSeasonId`,
 * same "every pick on the instance" predicate): a count that disagreed with
 * what a save would actually delete would just be a more convincing lie.
 *
 * Gated on `LEAGUE_ACTION.EDIT_SETTINGS`, not plain membership — an ordinary
 * member has no use for this number and showing it would leak how many
 * picks other members have submitted before their games kick off (spec §Pick
 * Visibility).
 */
export async function getPickemPickSummary(
  db: Db,
  leagueId: string,
  userId: string,
): Promise<PickemResult<PickemPickSummary, PickemPickSummaryRefusal>> {
  const gate = await authorizeLeagueAction(db, leagueId, userId, LEAGUE_ACTION.EDIT_SETTINGS);
  if (!gate.ok) return gate;

  const current = await getLeagueWithCurrentSeason(db, leagueId);
  if (!current) return { ok: false, reason: PICKEM_REFUSAL.LEAGUE_NOT_FOUND };
  if (current.league.mode !== LEAGUE_MODE.PICKEM) {
    return { ok: false, reason: PICKEM_REFUSAL.WRONG_LEAGUE_MODE };
  }

  const [row] = await db
    .select({
      pickCount: count(),
      memberCount: countDistinct(pickemPicks.leagueMemberId),
    })
    .from(pickemPicks)
    .where(eq(pickemPicks.leagueSeasonId, current.season.id));

  return {
    ok: true,
    value: { pickCount: row?.pickCount ?? 0, memberCount: row?.memberCount ?? 0 },
  };
}

export async function submitPickemPicks(
  db: Db,
  clock: Clock,
  leagueId: string,
  weekId: string,
  userId: string,
  submissions: readonly PickemPickSubmission[],
): Promise<PickemResult<PickemWeekPicksResponse, PickemWriteRefusal>> {
  const preflight = await loadContext(db, leagueId, weekId, userId);
  if (!preflight.ok) return preflight;
  const { leagueSeasonId, membershipId, settings, status } = preflight.value;

  if (status === LEAGUE_STATUS.CONCLUDED) {
    return { ok: false, reason: PICKEM_REFUSAL.LEAGUE_CONCLUDED };
  }

  const seen = new Set<string>();
  for (const submission of submissions) {
    if (seen.has(submission.gameId)) {
      return { ok: false, reason: PICKEM_REFUSAL.DUPLICATE_PICK };
    }
    seen.add(submission.gameId);
  }

  const refusal = await db.transaction(async (tx): Promise<PickemWriteRefusal | null> => {
    // Serializes this member's own concurrent submissions so the cap check
    // below can't be passed twice against the same pre-write state.
    await lockLeagueMemberRow(tx, membershipId);

    // Re-read the slate inside the transaction: kickoffs and spreads are the
    // two things that can have moved between the pre-flight read and here, and
    // both are load-bearing (arch §Locking Model — every pick mutation
    // re-validates `kickoff_at > clock.now()` inside its transaction).
    const slate = await loadResolvedWeekGames(tx, clock, weekId);
    const byGameId = new Map(slate.map((game) => [game.id, game]));
    const picksAllowed = picksAllowedFor(settings.picksPerWeek, slate);

    for (const submission of submissions) {
      const game = byGameId.get(submission.gameId);
      if (!game) return PICKEM_REFUSAL.GAME_NOT_IN_WEEK;
      if (game.locked) return PICKEM_REFUSAL.PICK_LOCKED;
      // A cancelled or moved game settles as a push, so a fresh pick on one
      // would be free points (spec §Cancellations — the push is what a member
      // is left holding, never something they may newly choose).
      if (!game.pickable) return PICKEM_REFUSAL.GAME_NOT_PICKABLE;

      const spreadRefusal = checkSpreadAccepted(settings, game, submission.spread);
      if (spreadRefusal) return spreadRefusal;
    }

    const existing = await tx
      .select({ id: pickemPicks.id, gameId: pickemPicks.gameId })
      .from(pickemPicks)
      .where(and(eq(pickemPicks.leagueMemberId, membershipId), eq(pickemPicks.weekId, weekId)));

    /**
     * The submission governs the member's *replaceable* picks only — those on a
     * game still in this week's slate, still unstarted, and still playable.
     * Everything else is retained, because the member is entitled to what it
     * will settle as and no edit of theirs asked to give it up:
     * - a **locked** pick is immutable (spec §Locking);
     * - a pick whose game **left this week** (a provider week move repoints
     *   `games.week_id` while the pick keeps its own) is not addressable from
     *   this slate at all;
     * - a pick on a **cancelled or moved** game resolves as a push that the
     *   spec says stands (§Cancellations: "If no unstarted games remain, the
     *   push stands"). Keying retention on `locked` alone would destroy it
     *   whenever the cancellation landed before the scheduled kickoff — the
     *   same spec situation as a post-kickoff cancellation, but the opposite
     *   outcome, decided by a timestamp that means nothing for a game that will
     *   never be played.
     *
     * So absence from `byGameId`, a lock, or an unplayable status all mean
     * "retain" — never "drop".
     */
    const replaceable = existing.filter((pick) => {
      const game = byGameId.get(pick.gameId);
      return game !== undefined && !game.locked && game.pickable;
    });
    const retainedCount = existing.length - replaceable.length;

    // The cap bounds what this submission may *add*, not what the member ended
    // up holding: retained picks are not something they chose to keep, and a
    // slate that shrank (a cancellation) can put `retainedCount` over the cap on
    // its own. Framed this way an empty submission — which only ever deletes —
    // can never be refused.
    const remainingSlots = Math.max(0, picksAllowed - retainedCount);
    if (submissions.length > remainingSlots) {
      return PICKEM_REFUSAL.TOO_MANY_PICKS;
    }

    if (replaceable.length > 0) {
      await tx.delete(pickemPicks).where(
        inArray(
          pickemPicks.id,
          replaceable.map((pick) => pick.id),
        ),
      );
    }

    if (submissions.length > 0) {
      const now = clock.now();
      try {
        await tx.insert(pickemPicks).values(
          submissions.map((submission) => ({
            leagueSeasonId,
            leagueMemberId: membershipId,
            weekId,
            gameId: submission.gameId,
            side: submission.side,
            // SU leagues have no spread dependency (spec §ATS spread acceptance)
            // — never store a number scoring would then be tempted to use.
            spreadAtPick:
              settings.pickType === PICK_TYPE.AGAINST_THE_SPREAD ? submission.spread : null,
            createdAt: now,
            updatedAt: now,
          })),
        );
      } catch (error) {
        // `pickem_picks_member_game_unique` spans every week, but the checks
        // above only see this one — a game moved INTO this week that the member
        // already picked in its old week collides here. A typed refusal, not
        // the logged 500 the raw driver error would become.
        if (isUniqueViolation(error, "pickem_picks_member_game_unique")) {
          return PICKEM_REFUSAL.DUPLICATE_PICK;
        }
        throw error;
      }
    }

    return null;
  });

  if (refusal) return { ok: false, reason: refusal };

  // Deliberately no settlement call here, unlike `repickPickemPick`. This path
  // only ever deletes picks that are `replaceable` — in the slate, unlocked, and
  // pickable — and such a game is `scheduled`, which settlement records no
  // result for. There is therefore nothing stale to rebuild. (The one way that
  // could stop holding is the ADM-3 hole: an override moving a kickoff later,
  // then ingestion writing a final score off the provider kickoff, leaving a
  // scored game unlocked. The nightly sweep repairs it; adding a settlement
  // round trip to the app's hottest write path to cover it would not pay.)
  return getPickemWeekPicks(db, clock, leagueId, weekId, userId);
}

/**
 * Substitutes one pick for another after its game was cancelled or moved out of
 * the week (spec §Cancellations, Postponements & Re-picks).
 *
 * This is the one operation where ATS acceptance applies to the **replacement
 * pick only** — the member's other unstarted picks keep the spreads they were
 * made against. That is the exact inverse of `submitPickemPicks`, whose
 * invariant is that any change re-prices everything, which is why the two are
 * separate endpoints rather than one with a flag (ADR-0015).
 *
 * It is also the only way to give up a retained pick: the batch endpoint
 * deliberately can't, so without this the spec's "substitute any unstarted
 * game" would be unreachable and a member holding a cancelled game would be
 * capped for the week.
 */
export async function repickPickemPick(
  db: Db,
  clock: Clock,
  leagueId: string,
  weekId: string,
  userId: string,
  request: PickemRepickRequest,
): Promise<PickemResult<PickemWeekPicksResponse, PickemWriteRefusal>> {
  const preflight = await loadContext(db, leagueId, weekId, userId);
  if (!preflight.ok) return preflight;
  const { leagueSeasonId, membershipId, settings, status } = preflight.value;

  if (status === LEAGUE_STATUS.CONCLUDED) {
    return { ok: false, reason: PICKEM_REFUSAL.LEAGUE_CONCLUDED };
  }

  const refusal = await db.transaction(async (tx): Promise<PickemWriteRefusal | null> => {
    await lockLeagueMemberRow(tx, membershipId);

    const slate = await loadResolvedWeekGames(tx, clock, weekId);
    const byGameId = new Map(slate.map((game) => [game.id, game]));

    const existing = await tx
      .select()
      .from(pickemPicks)
      .where(and(eq(pickemPicks.leagueMemberId, membershipId), eq(pickemPicks.weekId, weekId)));

    const replaced = existing.find((pick) => pick.id === request.replacePickId);
    if (!replaced) return PICKEM_REFUSAL.PICK_NOT_FOUND;

    // A re-pick is earned only by a game that will never be played in this
    // week. A pick on a live game is changed through the batch endpoint, which
    // re-prices every unstarted pick — routing that change through here would
    // let a member freeze the rest of their spreads, which the spec forbids.
    const replacedGame = byGameId.get(replaced.gameId);
    const replacedIsUnplayable = replacedGame === undefined || !replacedGame.pickable;
    if (!replacedIsUnplayable) return PICKEM_REFUSAL.PICK_NOT_REPLACEABLE;

    const replacement = byGameId.get(request.gameId);
    if (!replacement) return PICKEM_REFUSAL.GAME_NOT_IN_WEEK;
    if (replacement.locked) return PICKEM_REFUSAL.PICK_LOCKED;
    if (!replacement.pickable) return PICKEM_REFUSAL.GAME_NOT_PICKABLE;

    // "Substituting any unstarted game from the same week" means one the member
    // doesn't already hold — otherwise the substitution would collapse two
    // picks into one and quietly cost them a slot.
    const alreadyPicked = existing.some(
      (pick) => pick.gameId === request.gameId && pick.id !== replaced.id,
    );
    if (alreadyPicked) return PICKEM_REFUSAL.DUPLICATE_PICK;

    const spreadRefusal = checkSpreadAccepted(settings, replacement, request.spread);
    if (spreadRefusal) return spreadRefusal;

    const now = clock.now();
    // Replace rather than add: the push is what the member holds if they don't
    // re-pick, so stacking a substitute on top would give them more scoring
    // chances than Picks Per Week allows.
    await tx.delete(pickemPicks).where(eq(pickemPicks.id, replaced.id));
    try {
      await tx.insert(pickemPicks).values({
        leagueSeasonId,
        leagueMemberId: membershipId,
        weekId,
        gameId: request.gameId,
        side: request.side,
        spreadAtPick: settings.pickType === PICK_TYPE.AGAINST_THE_SPREAD ? request.spread : null,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      // Same cross-week collision as the batch path: the duplicate check above
      // is scoped to this week, the constraint is not.
      if (isUniqueViolation(error, "pickem_picks_member_game_unique")) {
        return PICKEM_REFUSAL.DUPLICATE_PICK;
      }
      throw error;
    }

    return null;
  });

  if (refusal) return { ok: false, reason: refusal };

  /**
   * Re-settle, because this is the one write path that can give up an
   * **already-graded** pick. The pick it replaces has pushed — that is the
   * precondition for the whole operation — so a `pickem_pick_results` row for it
   * may already exist, and deleting the pick cascades that row away while
   * `pickem_standings` keeps counting the points it contributed. Without this,
   * the board credits a member for a pick they no longer hold until something
   * else happens to settle that season (arch D10: standings must be what a full
   * recompute would produce, at any time — not eventually).
   *
   * Outside the transaction and non-fatal, for the same reasons as the admin
   * override's recompute: settlement takes a per-league-season lock, and the
   * substitution is already committed, so a failure here must not roll it back
   * or report the member's pick change as failed. The nightly sweep repairs the
   * derivation; the log is how anyone learns it had to.
   */
  try {
    await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, [weekId]);
  } catch (error) {
    logError("pickem-repick.settlement-failed", { leagueId, weekId, leagueSeasonId, error });
  }

  return getPickemWeekPicks(db, clock, leagueId, weekId, userId);
}
