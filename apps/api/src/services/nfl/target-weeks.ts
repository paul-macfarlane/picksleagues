import { and, asc, eq, gt, lte } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { weeks } from "@picksleagues/db";
import type { WeekType } from "@picksleagues/schemas";

export type TargetWeek = { id: string; weekType: WeekType; weekNumber: number; startsAt: Date };

/**
 * Resolves the weeks a pick-window sync targets from OUR `weeks` table (never
 * the provider). Shared by sync-odds and sync-stats, which must price and
 * contextualize the same window — a second copy would let the two drift onto
 * different weeks and leave games priced but statless, or vice versa.
 *
 * An explicit (type, number) targets that week **alone** — naming a week is the
 * narrow manual/simulator path, and widening it would make a backfill of one
 * week quietly rewrite another. Otherwise the anchor is the week currently in
 * progress (`startsAt <= now < endsAt`), else the next upcoming week (pre-season
 * runs) — and the week following the anchor comes with it, because ESPN's
 * window rolls over on Wednesday while members can pick the coming weekend from
 * the moment the previous one ends (SIMP-16; see `syncNflOdds`).
 *
 * The window-based paths need no type filter — regular and postseason windows
 * never overlap, so `startsAt <= now < endsAt` picks out exactly one week. The
 * follower is found by start time for the same reason: the week after regular
 * 18 is postseason 1, and a type filter would leave the Wild Card slate
 * unpriced through the last regular week.
 */
export async function resolveTargetWeeks(
  db: Db,
  seasonId: string,
  now: Date,
  weekNumber: number | undefined,
  weekType: WeekType,
): Promise<TargetWeek[]> {
  const selection = {
    id: weeks.id,
    weekType: weeks.weekType,
    weekNumber: weeks.weekNumber,
    startsAt: weeks.startsAt,
  };

  if (weekNumber !== undefined) {
    const [week] = await db
      .select(selection)
      .from(weeks)
      .where(
        and(
          eq(weeks.seasonId, seasonId),
          eq(weeks.weekType, weekType),
          eq(weeks.weekNumber, weekNumber),
        ),
      );
    return week ? [week] : [];
  }

  const [current] = await db
    .select(selection)
    .from(weeks)
    .where(and(eq(weeks.seasonId, seasonId), lte(weeks.startsAt, now), gt(weeks.endsAt, now)))
    // Windows shouldn't overlap across week types, but don't let that provider
    // claim be load-bearing: pick the earliest-starting match deterministically.
    .orderBy(asc(weeks.startsAt))
    .limit(1);

  let anchor: TargetWeek | undefined = current;
  if (!anchor) {
    [anchor] = await db
      .select(selection)
      .from(weeks)
      .where(and(eq(weeks.seasonId, seasonId), gt(weeks.startsAt, now)))
      .orderBy(asc(weeks.startsAt))
      .limit(1);
  }
  if (!anchor) return [];

  const [following] = await db
    .select(selection)
    .from(weeks)
    .where(and(eq(weeks.seasonId, seasonId), gt(weeks.startsAt, anchor.startsAt)))
    .orderBy(asc(weeks.startsAt))
    .limit(1);

  return following ? [anchor, following] : [anchor];
}
