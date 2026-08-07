import { and, count, countDistinct, eq, ne } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { isUniqueViolation, survivorPicks, survivorState } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  LEAGUE_ACTION,
  LEAGUE_MODE,
  LEAGUE_SETTINGS_SCHEMAS,
  LEAGUE_STATUS,
  PICK_TYPE,
  WEEK_TYPE,
  nflSeasonOrdinal,
  type LeaguePickSummary,
  type LeagueStatus,
  type SubmitSurvivorPickRequest,
  type SurvivorMemberPick,
  type SurvivorSettings,
  type SurvivorWeekPicksResponse,
} from "@picksleagues/schemas";
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
 * Survivor pick entry (spec §Game Mode 2 — Core Rules) and the kickoff-gated
 * read path (spec §Pick Visibility).
 *
 * A week is **one pick, changeable until its game kicks off** — an upsert, not
 * an append, and deliberately not Pick'em's one-atomic-immutable-submission
 * semantic (ADR-0018 is Pick'em-only). ADR-0025 records the design.
 *
 * Four invariants carry this module, and the three that can move underneath a
 * member are re-validated inside the write transaction rather than trusted from
 * the pre-flight read (arch §Locking Model): the member must not be eliminated,
 * neither the new pick's game nor the one it replaces may have kicked off, the
 * team must still be unconsumed, and in ATS leagues the spread written must be
 * the spread current at that instant.
 */

export const SURVIVOR_REFUSAL = {
  LEAGUE_NOT_FOUND: "league_not_found",
  WRONG_LEAGUE_MODE: "wrong_league_mode",
  LEAGUE_CONCLUDED: "league_concluded",
  WEEK_OUT_OF_RANGE: "week_out_of_range",
  GAME_NOT_IN_WEEK: "game_not_in_week",
  GAME_NOT_PICKABLE: "game_not_pickable",
  TEAM_NOT_IN_GAME: "team_not_in_game",
  TEAM_CONSUMED: "team_consumed",
  MEMBER_ELIMINATED: "member_eliminated",
  PICK_LOCKED: "pick_locked",
  SPREAD_STALE: "spread_stale",
  SPREAD_UNAVAILABLE: "spread_unavailable",
  // Only the settings-editor read (commissioner-gated, see below) can produce
  // this — every other refusal in this file comes from the member-only
  // `loadContext` gate, which has no role axis.
  NOT_COMMISSIONER: "not_commissioner",
} as const;

export type SurvivorRefusal = (typeof SURVIVOR_REFUSAL)[keyof typeof SURVIVOR_REFUSAL];

/**
 * The refusals reachable from resolving and authorizing a league-week — all a
 * read can produce. Split from the full set so the read route doesn't have to
 * declare the write-only conflicts it can never emit. (The handler maps stay
 * keyed by the full set on purpose, so adding a reason is a compile error.)
 */
export type SurvivorReadRefusal = Extract<
  SurvivorRefusal,
  "league_not_found" | "wrong_league_mode" | "week_out_of_range"
>;

/**
 * The refusal set for the read only the settings editor consumes (the pick
 * summary). It has a role axis the member-only `loadContext` gate doesn't — the
 * editor is commissioner-only — so the set names `not_commissioner` alongside
 * the two `loadContext` produces, and never `week_out_of_range`, since the read
 * is not scoped to a week. Mirrors `PickemSettingsEditorRefusal`.
 */
export type SurvivorSettingsEditorRefusal = Extract<
  SurvivorRefusal,
  "league_not_found" | "wrong_league_mode" | "not_commissioner"
>;

export type SurvivorResult<T, R extends SurvivorRefusal = SurvivorRefusal> =
  { ok: true; value: T } | { ok: false; reason: R };

/**
 * The role axis (`not_commissioner`) belongs to the settings-editor read alone
 * — the write path authorizes through `loadContext`'s membership-only gate and
 * can never produce it. Naming the exclusion explicitly (rather than leaving
 * the write on the full `SurvivorRefusal` default) keeps the write route's
 * declared OpenAPI response statuses accurate. Mirrors `PickemWriteRefusal`.
 */
export type SurvivorWriteRefusal = Exclude<SurvivorRefusal, "not_commissioner">;

interface SurvivorContext {
  leagueSeasonId: string;
  seasonId: string;
  membershipId: string;
  settings: SurvivorSettings;
  status: LeagueStatus;
}

/**
 * Resolves and authorizes the league both paths need. A non-member gets
 * `league_not_found`, indistinguishable from a league that doesn't exist —
 * private leagues stay hidden (matching `getLeague`).
 */
async function loadContext(
  db: Db,
  leagueId: string,
  userId: string,
): Promise<SurvivorResult<SurvivorContext, "league_not_found" | "wrong_league_mode">> {
  const current = await getLeagueWithCurrentSeason(db, leagueId);
  if (!current) return { ok: false, reason: SURVIVOR_REFUSAL.LEAGUE_NOT_FOUND };

  const membership = await getMembership(db, leagueId, userId);
  if (!membership) return { ok: false, reason: SURVIVOR_REFUSAL.LEAGUE_NOT_FOUND };

  if (current.league.mode !== LEAGUE_MODE.SURVIVOR) {
    return { ok: false, reason: SURVIVOR_REFUSAL.WRONG_LEAGUE_MODE };
  }

  // Parsed rather than trusted so schema defaults materialize on rows written
  // before a field existed (engineering rules §Data: settings JSONB evolves
  // additively).
  const settings = LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.SURVIVOR].parse(current.season.settings);

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
 * Whether the requested week is one this league plays. Survivor is
 * **regular-season only** (spec §Game Mode 2 — Core Rules), so the week type is
 * checked in its own right rather than left to the ordinal comparison: the
 * stored range can only ever name regular weeks, but stating the mode's rule
 * where it applies keeps it true if a stored range is ever widened.
 */
async function isWeekInRange(
  db: Db,
  seasonId: string,
  weekId: string,
  settings: SurvivorSettings,
): Promise<boolean> {
  const week = await getWeek(db, weekId);
  if (!week || week.seasonId !== seasonId) return false;
  if (week.weekType !== WEEK_TYPE.REGULAR) return false;

  const ordinal = nflSeasonOrdinal({ type: WEEK_TYPE.REGULAR, number: week.weekNumber });
  return (
    ordinal >= nflSeasonOrdinal(settings.startWeek) && ordinal <= nflSeasonOrdinal(settings.endWeek)
  );
}

/**
 * The ATS spread-acceptance rule (spec §ATS spread acceptance), the same
 * handshake Pick'em runs: the line moves between page load and save, so a
 * submission states the spread it accepted and is refused when it has moved.
 *
 * The two refusals are deliberately distinct because the member's next move
 * differs: no line has been captured yet (wait for the odds sync — there is
 * nothing to re-accept), versus the line moved under a save in flight (refetch
 * and accept the new number). Straight-up leagues have no spread dependency at
 * all, so nothing is checked.
 */
function checkSpreadAccepted(
  settings: SurvivorSettings,
  game: ResolvedSlateGame,
  submitted: number | null,
): SurvivorWriteRefusal | null {
  if (settings.pickType !== PICK_TYPE.AGAINST_THE_SPREAD) return null;
  if (game.spread === null) return SURVIVOR_REFUSAL.SPREAD_UNAVAILABLE;
  if (submitted !== game.spread) return SURVIVOR_REFUSAL.SPREAD_STALE;
  return null;
}

/** The member ids settlement has eliminated. A member with no row is alive. */
async function eliminatedMemberIds(db: Db, leagueSeasonId: string): Promise<Set<string>> {
  const rows = await db
    .select({
      leagueMemberId: survivorState.leagueMemberId,
      eliminatedWeekId: survivorState.eliminatedWeekId,
    })
    .from(survivorState)
    .where(eq(survivorState.leagueSeasonId, leagueSeasonId));
  return new Set(
    rows.filter((row) => row.eliminatedWeekId !== null).map((row) => row.leagueMemberId),
  );
}

export async function getSurvivorWeekPicks(
  db: Db,
  clock: Clock,
  leagueId: string,
  weekId: string,
  userId: string,
): Promise<SurvivorResult<SurvivorWeekPicksResponse, SurvivorReadRefusal>> {
  const context = await loadContext(db, leagueId, userId);
  if (!context.ok) return context;
  const { leagueSeasonId, seasonId, membershipId, settings } = context.value;

  if (!(await isWeekInRange(db, seasonId, weekId, settings))) {
    return { ok: false, reason: SURVIVOR_REFUSAL.WEEK_OUT_OF_RANGE };
  }

  // Shared with the league page's roster so the two surfaces can't disagree
  // about member order, which is user-visible in both.
  const members = await loadMembers(db, leagueId);

  const picks = await db
    .select()
    .from(survivorPicks)
    .where(and(eq(survivorPicks.leagueSeasonId, leagueSeasonId), eq(survivorPicks.weekId, weekId)));

  const lockedByGame = await resolveLockStates(
    db,
    clock,
    picks.map((pick) => pick.gameId),
  );
  const eliminated = await eliminatedMemberIds(db, leagueSeasonId);
  const picksByMember = new Map(picks.map((pick) => [pick.leagueMemberId, pick]));

  const serialized: SurvivorMemberPick[] = members.map(({ member, user }) => {
    const own = picksByMember.get(member.id) ?? null;
    const isViewer = member.userId === userId;
    // The visibility rule itself (spec §Pick Visibility): another member's pick
    // is serialized only once its game has kicked off. Filtered here, never
    // shipped-and-hidden by the client — `hasPicked` is what the league sees
    // until then.
    const visible = own !== null && (isViewer || lockedByGame.get(own.gameId) === true);

    return {
      leagueMemberId: member.id,
      userId: user.id,
      username: user.username,
      displayName: user.display_name,
      image: resolveUserImage(user),
      isViewer,
      hasPicked: own !== null,
      pick:
        visible && own
          ? {
              id: own.id,
              weekId: own.weekId,
              gameId: own.gameId,
              teamId: own.teamId,
              spreadAtPick: own.spreadAtPick,
            }
          : null,
      eliminated: eliminated.has(member.id),
    };
  });

  // The viewer's own ledger only — which teams another member has burned is
  // exactly what the visibility rule above withholds. The requested week is
  // excluded because this week's pick is the one they may still change, and
  // listing it would disable the team they currently hold.
  const consumed = await db
    .selectDistinct({ teamId: survivorPicks.teamId })
    .from(survivorPicks)
    .where(
      and(
        eq(survivorPicks.leagueSeasonId, leagueSeasonId),
        eq(survivorPicks.leagueMemberId, membershipId),
        eq(survivorPicks.released, false),
        ne(survivorPicks.weekId, weekId),
      ),
    );

  return {
    ok: true,
    value: { members: serialized, consumedTeamIds: consumed.map((row) => row.teamId) },
  };
}

/**
 * How many picks — and how many distinct members holding at least one — sit on
 * the league's current season instance. This is the settings editor's pre-save
 * warning input (spec §Commissioner Powers), so its scope must match
 * `resetPicksInvalidatedBySettings` exactly (same `leagueSeasonId`, same "every
 * pick on the instance" predicate, `released` rows included since the reset
 * deletes those too): a count that disagreed with what a save would actually
 * delete would just be a more convincing lie.
 *
 * Gated on `LEAGUE_ACTION.EDIT_SETTINGS`, not plain membership — an ordinary
 * member has no use for this number and showing it would leak how many picks
 * other members have submitted before their games kick off (spec §Pick
 * Visibility).
 */
export async function getSurvivorPickSummary(
  db: Db,
  leagueId: string,
  userId: string,
): Promise<SurvivorResult<LeaguePickSummary, SurvivorSettingsEditorRefusal>> {
  const gate = await authorizeLeagueAction(db, leagueId, userId, LEAGUE_ACTION.EDIT_SETTINGS);
  if (!gate.ok) return gate;

  const current = await getLeagueWithCurrentSeason(db, leagueId);
  if (!current) return { ok: false, reason: SURVIVOR_REFUSAL.LEAGUE_NOT_FOUND };
  if (current.league.mode !== LEAGUE_MODE.SURVIVOR) {
    return { ok: false, reason: SURVIVOR_REFUSAL.WRONG_LEAGUE_MODE };
  }

  const [row] = await db
    .select({
      pickCount: count(),
      memberCount: countDistinct(survivorPicks.leagueMemberId),
    })
    .from(survivorPicks)
    .where(eq(survivorPicks.leagueSeasonId, current.season.id));

  return {
    ok: true,
    value: { pickCount: row?.pickCount ?? 0, memberCount: row?.memberCount ?? 0 },
  };
}

/**
 * The member's pick for one week — created or replaced (spec §Game Mode 2: a
 * pick "can be made or changed until the picked game's kickoff"). Returns the
 * week as the read endpoint would serve it.
 */
export async function submitSurvivorPick(
  db: Db,
  clock: Clock,
  leagueId: string,
  weekId: string,
  userId: string,
  submission: SubmitSurvivorPickRequest,
): Promise<SurvivorResult<SurvivorWeekPicksResponse, SurvivorWriteRefusal>> {
  const preflight = await loadContext(db, leagueId, userId);
  if (!preflight.ok) return preflight;
  const { leagueSeasonId, seasonId, membershipId, settings, status } = preflight.value;

  if (status === LEAGUE_STATUS.CONCLUDED) {
    return { ok: false, reason: SURVIVOR_REFUSAL.LEAGUE_CONCLUDED };
  }

  if (!(await isWeekInRange(db, seasonId, weekId, settings))) {
    return { ok: false, reason: SURVIVOR_REFUSAL.WEEK_OUT_OF_RANGE };
  }

  const refusal = await db.transaction(async (tx): Promise<SurvivorWriteRefusal | null> => {
    // Serializes this member's own concurrent writes, so the team-consumption
    // check below can't be passed twice against the same pre-write state.
    await lockLeagueMemberRow(tx, membershipId);

    const [state] = await tx
      .select()
      .from(survivorState)
      .where(
        and(
          eq(survivorState.leagueSeasonId, leagueSeasonId),
          eq(survivorState.leagueMemberId, membershipId),
        ),
      );
    // No row means alive: the ledger is settlement's output alone, and nothing
    // mints a row at join time (arch D10). Judged on *settled* state on
    // purpose — between a member busting and their week settling, this still
    // reads alive and the pick is accepted. That lag is what keeps the
    // everyone-out revival rule honest: refusing there would bar a member the
    // rule may be about to bring back. A pick landed in the window simply
    // grades to nothing.
    if (state?.eliminatedWeekId) return SURVIVOR_REFUSAL.MEMBER_ELIMINATED;

    // Re-read the slate inside the transaction: kickoffs and spreads are the
    // two things that can have moved between the pre-flight read and here, and
    // both are load-bearing (arch §Locking Model — every pick mutation
    // re-validates `kickoff_at > clock.now()` inside its transaction).
    const slate = await loadResolvedWeekGames(tx, clock, weekId);
    const game = slate.find((candidate) => candidate.id === submission.gameId);
    if (!game) return SURVIVOR_REFUSAL.GAME_NOT_IN_WEEK;
    // A cancelled game pushes and returns the team, so a fresh pick on one
    // would be a free week (spec §Game Mode 2 — Cancelled game: the push is
    // what a member is left holding, never something they may newly choose).
    if (!game.pickable) return SURVIVOR_REFUSAL.GAME_NOT_PICKABLE;
    if (game.locked) return SURVIVOR_REFUSAL.PICK_LOCKED;

    if (submission.teamId !== game.homeTeam.id && submission.teamId !== game.awayTeam.id) {
      return SURVIVOR_REFUSAL.TEAM_NOT_IN_GAME;
    }

    const spreadRefusal = checkSpreadAccepted(settings, game, submission.spread);
    if (spreadRefusal) return spreadRefusal;

    const [existing] = await tx
      .select()
      .from(survivorPicks)
      .where(
        and(
          eq(survivorPicks.leagueSeasonId, leagueSeasonId),
          eq(survivorPicks.leagueMemberId, membershipId),
          eq(survivorPicks.weekId, weekId),
        ),
      );
    if (existing) {
      // A member cannot re-pick out of a game that has started, even into one
      // that hasn't — the pick they hold is already public and already playing.
      const lockedByGame = await resolveLockStates(tx, clock, [existing.gameId]);
      if (lockedByGame.get(existing.gameId) === true) return SURVIVOR_REFUSAL.PICK_LOCKED;
    }

    const [consumed] = await tx
      .select({ id: survivorPicks.id })
      .from(survivorPicks)
      .where(
        and(
          eq(survivorPicks.leagueSeasonId, leagueSeasonId),
          eq(survivorPicks.leagueMemberId, membershipId),
          eq(survivorPicks.teamId, submission.teamId),
          eq(survivorPicks.released, false),
          // Any week but this one: replacing this week's own pick with the same
          // team is not reuse (spec §Game Mode 2 — Team reuse).
          ne(survivorPicks.weekId, weekId),
        ),
      )
      .limit(1);
    if (consumed) return SURVIVOR_REFUSAL.TEAM_CONSUMED;

    const now = clock.now();
    try {
      await tx
        .insert(survivorPicks)
        .values({
          leagueSeasonId,
          leagueMemberId: membershipId,
          weekId,
          gameId: submission.gameId,
          teamId: submission.teamId,
          // SU leagues have no spread dependency (spec §ATS spread acceptance)
          // — never store a number settlement would then be tempted to use.
          spreadAtPick:
            settings.pickType === PICK_TYPE.AGAINST_THE_SPREAD ? submission.spread : null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            survivorPicks.leagueSeasonId,
            survivorPicks.leagueMemberId,
            survivorPicks.weekId,
          ],
          set: {
            gameId: submission.gameId,
            teamId: submission.teamId,
            spreadAtPick:
              settings.pickType === PICK_TYPE.AGAINST_THE_SPREAD ? submission.spread : null,
            // A freshly chosen pick is never a released one: `released` records
            // that settlement handed a team back, and this row no longer holds
            // the team it was set for.
            released: false,
            updatedAt: now,
          },
        });
    } catch (error) {
      // Second line of defense behind the check above, which races: two
      // concurrent writes can both read a team as unconsumed, and the ledger is
      // a database constraint precisely so one of them loses. A typed refusal,
      // not the logged 500 the raw driver error would become.
      if (isUniqueViolation(error, "survivor_picks_member_team_unique")) {
        return SURVIVOR_REFUSAL.TEAM_CONSUMED;
      }
      throw error;
    }

    return null;
  });

  if (refusal) return { ok: false, reason: refusal };

  return getSurvivorWeekPicks(db, clock, leagueId, weekId, userId);
}
