import {
  getLockedEventIds,
  getScorableEvents,
  updateEvent,
} from "@/data/events";
import { getDataSourceByName } from "@/data/sports";
import { fetchEventScore } from "@/lib/espn/nfl/scores";
import { isGameWindowActive, isNflSeasonMonth } from "@/lib/nfl/scheduling";

export interface LiveScoresSyncResult {
  skipped: boolean;
  reason?: string;
  eventsUpdated: number;
  eventsFinalized: number;
  eventsLocked: number;
}

function log(message: string): void {
  console.log(`[nfl-live-scores] ${message}`);
}

export async function runLiveScoresSync(
  now?: Date,
): Promise<LiveScoresSyncResult> {
  if (!isNflSeasonMonth(now)) {
    log("Off-season — skipping");
    return {
      skipped: true,
      reason: "off-season",
      eventsUpdated: 0,
      eventsFinalized: 0,
      eventsLocked: 0,
    };
  }

  const dataSource = await getDataSourceByName("ESPN");
  const [allScorableEvents, lockedEventIds] = await Promise.all([
    getScorableEvents(dataSource.id),
    getLockedEventIds(),
  ]);

  if (allScorableEvents.length === 0) {
    log("No scorable events — skipping");
    return {
      skipped: true,
      reason: "no-scorable-events",
      eventsUpdated: 0,
      eventsFinalized: 0,
      eventsLocked: 0,
    };
  }

  const scorableEvents = allScorableEvents.filter(
    (e) => !lockedEventIds.has(e.eventId),
  );
  const eventsLocked = allScorableEvents.length - scorableEvents.length;

  if (scorableEvents.length === 0) {
    log(`All ${eventsLocked} scorable events are locked — skipping`);
    return {
      skipped: true,
      reason: "all-locked",
      eventsUpdated: 0,
      eventsFinalized: 0,
      eventsLocked,
    };
  }

  if (!isGameWindowActive(scorableEvents, now)) {
    log("No active game window — skipping");
    return {
      skipped: true,
      reason: "no-game-window",
      eventsUpdated: 0,
      eventsFinalized: 0,
      eventsLocked,
    };
  }

  log(`Fetching scores for ${scorableEvents.length} events from ESPN...`);
  const fetchedScores = await Promise.all(
    scorableEvents.map((event) =>
      fetchEventScore({
        statusRef: event.statusRef,
        homeScoreRef: event.homeScoreRef,
        awayScoreRef: event.awayScoreRef,
      }),
    ),
  );

  let eventsUpdated = 0;
  let eventsFinalized = 0;

  for (let i = 0; i < scorableEvents.length; i++) {
    const event = scorableEvents[i];
    const score = fetchedScores[i];

    await updateEvent(event.eventId, {
      status: score.status,
      homeScore: score.homeScore,
      awayScore: score.awayScore,
    });
    eventsUpdated++;

    if (score.status === "final") {
      eventsFinalized++;
    }
  }

  log(
    `Sync complete: ${eventsUpdated} events updated, ${eventsFinalized} finalized, ${eventsLocked} locked`,
  );

  if (eventsFinalized > 0) {
    log(
      `${eventsFinalized} events finalized — standings recalculation needed (PL-015)`,
    );
  }

  return { skipped: false, eventsUpdated, eventsFinalized, eventsLocked };
}
