import { and, count, countDistinct, eq, inArray } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { games, isUniqueViolation, pickemPickResults, pickemPicks } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  GAME_STATUS,
  LEAGUE_ACTION,
  LEAGUE_MODE,
  LEAGUE_SETTINGS_SCHEMAS,
  LEAGUE_STATUS,
  PICK_TYPE,
  isWeekInSeasonRange,
  nflSeasonOrdinal,
  requiredPickemPickCount,
  type PickemMemberPicks,
  type PickemPickSubmission,
  type PickemPickSummary,
  type LeagueStatus,
  type PickemSettings,
  type PickemWeekPicksResponse,
} from "@picksleagues/schemas";
import { resolveGameOverrides } from "../games";
import { isWeekInsidePickWindow } from "../league-weeks";
import { getLeagueWithCurrentSeason } from "../leagues/current-season";
import { authorizeLeagueAction, getMembership } from "../leagues/authz";
// Deep import by design: `serialize` is module-public so sibling domains can
// cross-import it without going through the leagues barrel (see leagues/index.ts).
import { loadMembers } from "../leagues/serialize";
import { lockLeagueMemberRow } from "../leagues/locks";
import { resolveUserImage } from "../users";
import {
  getWeek,
  loadResolvedWeekGames,
  resolveLockStates,
  type ResolvedSlateGame,
} from "../slate";

/**
 * Pick'em pick entry (spec §Game Mode 1 — Core Rules, Locking, ATS spread
 * acceptance) and the kickoff-gated read path (spec §Pick Visibility).
 *
 * A week is **one atomic, immutable submission** (ADR-0018): the member sends
 * the full required set once, and no pick in that week can afterwards be
 * changed, replaced, or removed. There is no second write path.
 *
 * Three invariants carry this module and are re-validated inside the write
 * transaction rather than trusted from the pre-flight read (arch §Locking
 * Model): the member must not already hold picks for the week, a pick may only
 * be written while its game is unstarted, and in ATS leagues the spread written
 * must be the spread current at that instant.
 */

export const PICKEM_REFUSAL = {
  LEAGUE_NOT_FOUND: "league_not_found",
  WRONG_LEAGUE_MODE: "wrong_league_mode",
  LEAGUE_CONCLUDED: "league_concluded",
  WEEK_OUT_OF_RANGE: "week_out_of_range",
  GAME_NOT_IN_WEEK: "game_not_in_week",
  GAME_NOT_PICKABLE: "game_not_pickable",
  DUPLICATE_PICK: "duplicate_pick",
  // The two size refusals are mirrors of each other; ALREADY_SUBMITTED is the
  // different one — a set of any size from a member whose week is closed.
  TOO_MANY_PICKS: "too_many_picks",
  PICK_SET_INCOMPLETE: "pick_set_incomplete",
  ALREADY_SUBMITTED: "already_submitted",
  PICK_LOCKED: "pick_locked",
  WEEK_NOT_OPEN: "week_not_open",
  SPREAD_STALE: "spread_stale",
  SPREAD_UNAVAILABLE: "spread_unavailable",
  // Only the settings-editor reads (commissioner-gated, see below) can produce
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

/**
 * The role axis (`not_commissioner`) belongs to the settings-editor reads
 * alone — every write path here authorizes through `loadContext`'s
 * membership-only gate and can never produce it. Naming the exclusion
 * explicitly (rather than leaving the writes on the full `PickemRefusal`
 * default) keeps each write route's declared OpenAPI response statuses
 * accurate.
 */
export type PickemWriteRefusal = Exclude<PickemRefusal, "not_commissioner">;

interface PickemContext {
  leagueSeasonId: string;
  seasonId: string;
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
      seasonId: current.season.seasonId,
      membershipId: membership.id,
      settings,
      status: current.season.status,
    },
  };
}

/**
 * Whether every game in the member's current-week submission is terminal — the
 * condition that opens the next week (spec §Game Mode 1 — Pick window;
 * ADR-0036). Derived from the games' effective states rather than from result
 * rows, so the window opens when the last of the member's games ends instead of
 * when the settlement job next runs. A member with no submission has nothing to
 * resolve and waits for the week to turn over. Final-without-scores is the
 * provider fault an admin score override corrects; until then it is unresolved.
 */
async function hasCurrentWeekResolvedForMember(
  db: Db,
  leagueSeasonId: string,
  membershipId: string,
  currentWeekId: string,
): Promise<boolean> {
  // (leagueMemberId, weekId) is already unique to one instance — the season
  // scope is redundant but kept so this reads like Survivor's twin query.
  const picks = await db
    .select({ gameId: pickemPicks.gameId })
    .from(pickemPicks)
    .where(
      and(
        eq(pickemPicks.leagueSeasonId, leagueSeasonId),
        eq(pickemPicks.leagueMemberId, membershipId),
        eq(pickemPicks.weekId, currentWeekId),
      ),
    );
  if (picks.length === 0) return false;

  const gameRows = await db
    .select()
    .from(games)
    .where(
      inArray(
        games.id,
        picks.map((pick) => pick.gameId),
      ),
    );
  if (gameRows.length !== picks.length) return false;

  return gameRows.every((row) => {
    const game = resolveGameOverrides(row);
    if (game.status === GAME_STATUS.CANCELLED) return true;
    return game.status === GAME_STATUS.FINAL && game.homeScore !== null && game.awayScore !== null;
  });
}

/** Pick'em's binding of the shared window gate to its range clip and unlock. */
function isWeekInPickWindow(
  db: Db,
  clock: Clock,
  context: Pick<PickemContext, "leagueSeasonId" | "seasonId" | "membershipId" | "settings">,
  weekId: string,
): Promise<boolean> {
  return isWeekInsidePickWindow(db, clock, {
    seasonId: context.seasonId,
    targetWeekId: weekId,
    playsWeek: (week) => isWeekInSeasonRange(week, context.settings),
    hasCurrentWeekResolvedForMember: (currentWeekId) =>
      hasCurrentWeekResolvedForMember(
        db,
        context.leagueSeasonId,
        context.membershipId,
        currentWeekId,
      ),
  });
}

/**
 * Spec §Fewer games than Picks Per Week: a short slate caps everyone at the
 * games actually available. A cancelled game is not available, so it doesn't
 * raise the cap.
 *
 * This is the week's *cap*, which the read path serves as `picksAllowed`. The
 * size a submission must actually be is `requiredPickemPickCount`, which also
 * excludes games that have already kicked off, and — in ATS leagues — games
 * carrying no line for `checkSpreadAccepted` to accept (ADR-0018 decision 2).
 */
function picksAllowedFor(picksPerWeek: number, slate: readonly ResolvedSlateGame[]): number {
  return Math.min(picksPerWeek, slate.filter((game) => game.pickable).length);
}

/**
 * A duplicate-pick unique violation, under either name the constraint may carry
 * while migration 0018 rolls out.
 *
 * Both on purpose: migrations race the deploy (ADR-0003), so a request can land
 * on this code while the old, week-unscoped constraint is still in place. Under
 * that one the cross-week pick ADR-0017 legalises still raises — and serving a
 * typed refusal for one deploy window beats the logged 500 an unmatched
 * constraint name would produce. The old name can go once 0018 is applied
 * everywhere.
 */
function isDuplicatePickViolation(error: unknown): boolean {
  return (
    isUniqueViolation(error, "pickem_picks_member_game_week_unique") ||
    isUniqueViolation(error, "pickem_picks_member_game_unique")
  );
}

/**
 * The ATS spread-acceptance rule (spec §ATS spread acceptance). Immutability
 * removed the *second* submission, not the first one's handshake: the line
 * still moves between page load and submit, so a submission still states the
 * spreads it accepted and is still refused when they have moved.
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
  // No column on `pickem_picks` for this (PKM-9) — the source is read off the
  // game row the slate already resolved, frozen alongside the last-priced
  // spread.
  const spreadSourceByGameId = new Map(slate.map((game) => [game.id, game.spreadSource]));

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
      image: resolveUserImage(user),
      isViewer,
      picks: visible.map((pick) => ({
        id: pick.id,
        gameId: pick.gameId,
        side: pick.side,
        spread: pick.spreadAtPick,
        // Gated on the pick's own spread, not just the game's source: a
        // straight-up pick has no number to attribute, and crediting a book
        // beside a null spread would name a price nobody was graded against.
        spreadSource:
          pick.spreadAtPick === null ? null : (spreadSourceByGameId.get(pick.gameId) ?? null),
        // No extra visibility surface: a result exists only for a game that has
        // reached a terminal status, which is strictly later than the kickoff
        // the filter above already gates another member's picks on.
        outcome: pick.outcome,
        updatedAt: pick.updatedAt.toISOString(),
      })),
      hiddenPickCount: own.length - visible.length,
    };
  });

  const pickWindowOpen = await isWeekInPickWindow(db, clock, context.value, weekId);

  return { ok: true, value: { weekId, picksAllowed, members: serialized, pickWindowOpen } };
}

/**
 * The refusal set for the read only the settings editor consumes (the pick
 * summary). It has a role axis the member-only `loadContext` gate doesn't —
 * the editor is commissioner-only — so the set names `not_commissioner`
 * alongside the two `loadContext` produces, and never `week_out_of_range`,
 * since the read isn't scoped to a week.
 */
export type PickemSettingsEditorRefusal = Extract<
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
): Promise<PickemResult<PickemPickSummary, PickemSettingsEditorRefusal>> {
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

/**
 * The member's one submission for the week (ADR-0018 decision 1). Everything
 * about it is validated inside the transaction, against a slate re-read there:
 * a week the member has already submitted is closed for good, and the set must
 * be exactly what `requiredPickemPickCount` says is still pickable.
 *
 * There is no delete path here. The only way a member re-submits a week is a
 * commissioner settings change that invalidates picks
 * (`resetPicksInvalidatedBySettings`, ADR-0015 rule 3).
 */
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
    // Serializes this member's own concurrent submissions. More load-bearing
    // under submit-once than it was under editing: it is what makes "one
    // submission" true, since two requests racing on an empty week would
    // otherwise both read no existing picks and both insert a full set.
    await lockLeagueMemberRow(tx, membershipId);

    // Re-read the slate inside the transaction: kickoffs and spreads are the
    // two things that can have moved between the pre-flight read and here, and
    // both are load-bearing (arch §Locking Model — every pick mutation
    // re-validates `kickoff_at > clock.now()` inside its transaction).
    const slate = await loadResolvedWeekGames(tx, clock, weekId);
    const byGameId = new Map(slate.map((game) => [game.id, game]));

    const [existing] = await tx
      .select({ held: count() })
      .from(pickemPicks)
      .where(and(eq(pickemPicks.leagueMemberId, membershipId), eq(pickemPicks.weekId, weekId)));

    // Checked ahead of everything per-game so a member whose week is already
    // closed gets the honest reason, rather than a stale-spread or lock
    // complaint about a sheet that was never going to be accepted.
    if ((existing?.held ?? 0) > 0) return PICKEM_REFUSAL.ALREADY_SUBMITTED;

    // After the already-submitted refusal for the same honest-reason ordering,
    // and inside the transaction because the window is clock-derived like the
    // per-game locks below.
    if (!(await isWeekInPickWindow(tx, clock, preflight.value, weekId))) {
      return PICKEM_REFUSAL.WEEK_NOT_OPEN;
    }

    // A full set of what can *still* be picked (ADR-0018 decision 2): sizing
    // against `picksAllowed` instead would ask a member arriving after the
    // week's first kickoff — or into an ATS week with an unpriced game — for
    // picks this same loop would then refuse, which is a week they could never
    // submit at all. `pickType` is what tells it whether a missing line matters.
    const required = requiredPickemPickCount(settings.picksPerWeek, slate, settings.pickType);
    if (submissions.length > required) return PICKEM_REFUSAL.TOO_MANY_PICKS;
    if (submissions.length < required) return PICKEM_REFUSAL.PICK_SET_INCOMPLETE;

    for (const submission of submissions) {
      const game = byGameId.get(submission.gameId);
      if (!game) return PICKEM_REFUSAL.GAME_NOT_IN_WEEK;
      if (game.locked) return PICKEM_REFUSAL.PICK_LOCKED;
      // A cancelled game settles as a push, so a fresh pick on one would be
      // free points (spec §Cancellations — the push is what a member is left
      // holding, never something they may newly choose).
      if (!game.pickable) return PICKEM_REFUSAL.GAME_NOT_PICKABLE;

      const spreadRefusal = checkSpreadAccepted(settings, game, submission.spread);
      if (spreadRefusal) return spreadRefusal;
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
        // Backstop for a same-week duplicate the app checks and the member row
        // lock should already have prevented — a typed refusal, not the logged
        // 500 the raw driver error would become.
        if (isDuplicatePickViolation(error)) {
          return PICKEM_REFUSAL.DUPLICATE_PICK;
        }
        throw error;
      }
    }

    return null;
  });

  if (refusal) return { ok: false, reason: refusal };

  // Deliberately no settlement call: this path only ever inserts picks on games
  // it has just verified are unlocked and pickable, and settlement records no
  // result for a game in that state. There is nothing stale for it to rebuild.
  // (The one way that could stop holding is the ADM-3 hole: an override moving
  // a kickoff later, then ingestion writing a final score off the provider
  // kickoff, leaving a scored game unlocked. The nightly sweep repairs it;
  // adding a settlement round trip to the app's hottest write path to cover it
  // would not pay.)
  return getPickemWeekPicks(db, clock, leagueId, weekId, userId);
}
