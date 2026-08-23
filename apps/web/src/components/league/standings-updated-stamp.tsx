import { formatDateTime } from "@/lib/format";

/**
 * The "last updated" line every standings board ends with (spec §UI
 * conventions): when settlement last wrote the board, never a freshness the
 * data can't keep — the numbers arrive on an ingestion job's schedule.
 * `data-settled` is the fact the stamp reports — whether this board has ever
 * been written — so a journey can assert either state without binding to
 * either sentence. Pass a per-board `data-testid`; the journeys address each
 * board's stamp by name.
 */
export function StandingsUpdatedStamp({
  updatedAt,
  "data-testid": testId,
}: {
  updatedAt: string | null | undefined;
  "data-testid": string;
}) {
  return (
    <p data-testid={testId} data-settled={updatedAt ? "true" : "false"} className="type-eyebrow">
      {updatedAt ? `Last updated ${formatDateTime(updatedAt)}` : "Nothing has settled yet."}
    </p>
  );
}
