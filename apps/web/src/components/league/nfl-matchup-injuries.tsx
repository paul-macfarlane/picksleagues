import type {
  NflGameStatsResponse,
  NflInjuryReportEntry,
  SlateGame,
  SlateTeam,
} from "@picksleagues/schemas";
import { formatDateTime } from "@/lib/format";

// Unknown statuses stay visible in Basic so a new provider status cannot hide an Out.
function isKeyInjury(entry: NflInjuryReportEntry): boolean {
  return entry.status.toLowerCase() !== "questionable";
}

function injuryLine(entry: NflInjuryReportEntry): string {
  const position = entry.position ? ` (${entry.position})` : "";
  const type = entry.injuryType ? ` — ${entry.injuryType}` : "";
  return `${entry.athleteName}${position} · ${entry.status}${type}`;
}

function InjuryList({
  team,
  entries,
  keyOnly,
}: {
  team: SlateTeam;
  entries: NflInjuryReportEntry[];
  keyOnly: boolean;
}) {
  const shown = keyOnly ? entries.filter(isKeyInjury) : entries;
  return (
    <div className="flex flex-col gap-1">
      <p className="type-eyebrow text-foreground">{team.abbreviation}</p>
      {shown.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {entries.length > 0
            ? "Only Questionable players reported. See Advanced."
            : "None reported in the synced data."}
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {/* A served snapshot, never reordered client-side. Name/status keys
              collide when one athlete has multiple same-status injuries. */}
          {shown.map((entry, index) => (
            <li key={index} className="text-xs text-muted-foreground">
              {injuryLine(entry)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Injury context belongs to this game, independently of the season-record fallback. */
export function NflMatchupInjuries({
  game,
  context,
  keyOnly,
}: {
  game: SlateGame;
  context: NflGameStatsResponse["context"];
  keyOnly: boolean;
}) {
  return (
    <section className="flex flex-col gap-2" aria-label="Matchup injuries">
      <p className="type-eyebrow">{keyOnly ? "Key injuries" : "Injury report"}</p>
      {context ? (
        <>
          <p className="text-xs text-muted-foreground">
            Report for this matchup, separate from the season stats above.
            {keyOnly && " Questionable players are listed in Advanced."}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <InjuryList team={game.awayTeam} entries={context.away.injuries} keyOnly={keyOnly} />
            <InjuryList team={game.homeTeam} entries={context.home.injuries} keyOnly={keyOnly} />
          </div>
          <p className="type-eyebrow">
            Injury and matchup data last changed {formatDateTime(context.updatedAt)}.
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Injury and matchup data haven&apos;t synced for this game yet.
        </p>
      )}
    </section>
  );
}
