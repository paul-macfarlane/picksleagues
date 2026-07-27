import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { pickemPicks } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  LEAGUE_MODE,
  LEAGUE_SETTINGS_SCHEMAS,
  LEAGUE_STATUS,
  PICK_TYPE,
  nflSeasonOrdinal,
  type PickemMemberPicks,
  type PickemPickSubmission,
  type LeagueStatus,
  type PickemSettings,
  type PickemWeekPicksResponse,
} from "@picksleagues/schemas";
import { getLeagueWithCurrentSeason } from "../leagues/current-season";
import { getMembership } from "../leagues/authz";
// Deep import by design: `serialize` is module-public so sibling domains can
// cross-import it without going through the leagues barrel (see leagues/index.ts).
import { loadMembers } from "../leagues/serialize";
import { lockLeagueMemberRow } from "../leagues/locks";
import { getWeek, loadResolvedWeekGames, resolveLockStates, type ResolvedSlateGame } from "./slate";

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

  const picks = await db
    .select()
    .from(pickemPicks)
    .where(and(eq(pickemPicks.leagueSeasonId, leagueSeasonId), eq(pickemPicks.weekId, weekId)));

  const lockedByGame = await resolveLockStates(
    db,
    clock,
    picks.map((pick) => pick.gameId),
  );

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
        updatedAt: pick.updatedAt.toISOString(),
      })),
      hiddenPickCount: own.length - visible.length,
    };
  });

  return { ok: true, value: { weekId, picksAllowed, members: serialized } };
}

export async function submitPickemPicks(
  db: Db,
  clock: Clock,
  leagueId: string,
  weekId: string,
  userId: string,
  submissions: readonly PickemPickSubmission[],
): Promise<PickemResult<PickemWeekPicksResponse>> {
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

  const refusal = await db.transaction(async (tx): Promise<PickemRefusal | null> => {
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

      if (settings.pickType === PICK_TYPE.AGAINST_THE_SPREAD) {
        // Two different situations that would otherwise share a code, and the
        // member's next move differs: no line has been captured yet (wait for
        // the odds sync — nothing to re-accept), versus the line moved under a
        // submission in flight (refetch and accept the new numbers).
        if (game.spread === null) return PICKEM_REFUSAL.SPREAD_UNAVAILABLE;
        if (submission.spread !== game.spread) return PICKEM_REFUSAL.SPREAD_STALE;
      }
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
    }

    return null;
  });

  if (refusal) return { ok: false, reason: refusal };

  return getPickemWeekPicks(db, clock, leagueId, weekId, userId);
}
