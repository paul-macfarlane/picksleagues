import { useState } from "react";
import type { SimStateResponse } from "@picksleagues/schemas";
import { useImportReplaySeason } from "@/api/sim";
import { LabeledSelect } from "@/components/labeled-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Five years of candidate seasons, newest first — nobody replays a
// decade-old season, and keeping the list short enough to scan beats
// matching the schema's own bounds (2000–2100), which are far wider than any
// season an operator would actually want to replay.
const CANDIDATE_YEAR_COUNT = 5;

export function SimReplayCard({ state }: { state: SimStateResponse }) {
  const importReplay = useImportReplaySeason();
  // Counted down from the server's own `isReplayableSeasonYear` boundary, not
  // from the calendar year: an NFL season runs Aug–Feb, so for most of the year
  // `realNow`'s year minus one is still in progress and the import would 400.
  const years = Array.from(
    { length: CANDIDATE_YEAR_COUNT },
    (_, index) => state.latestReplayableSeasonYear - index,
  );
  const [year, setYear] = useState(String(years[0]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import a replay season</CardTitle>
        <CardDescription>
          A synchronous full-season ESPN crawl — this can take a while. Historical seasons carry no
          odds, so spreads are synthesized rather than real market lines (ADR-0011).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          {/* A select, not a free-text number field: every option is a season
              the server has already declared replayable, so an out-of-range
              year is unrepresentable and needs no client-side restatement of
              the schema's min/max. LabeledSelect is generic over `string`, so
              years are mapped to strings at this boundary. */}
          <div className="flex-1">
            <LabeledSelect
              id="sim-replay-year"
              label="Season"
              value={year}
              onValueChange={setYear}
              options={years.map((candidate) => ({
                value: String(candidate),
                label: String(candidate),
              }))}
            />
          </div>
          <Button
            disabled={importReplay.isPending}
            onClick={() => importReplay.mutate(Number(year))}
          >
            Import
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
