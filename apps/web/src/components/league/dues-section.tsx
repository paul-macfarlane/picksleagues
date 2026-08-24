import { useState } from "react";
import { DuesAmountSchema, MAX_DUES_AMOUNT, type LeagueResponse } from "@picksleagues/schemas";
import { useUpdateLeagueDues } from "@/api/dues";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/section";

/**
 * Commissioner-only, like the Danger Zone: the route renders this on the role
 * axis alone, and there is no window to disable on — MANAGE_DUES is anytime
 * (ADR-0045), which is why this is its own section with its own Save rather
 * than a field in the settings form whose neighbours lock at the start.
 */
export function DuesSection({ league }: { league: LeagueResponse }) {
  return (
    <Section
      title="Dues"
      description="Track who has paid this season. Money changes hands outside the app."
      className="gap-4"
    >
      {/* Remount on the server value so a refetched amount re-seeds the draft
          without a sync effect — the same idiom as settings-section.tsx. */}
      <DuesForm key={String(league.duesAmount)} league={league} />
    </Section>
  );
}

const AMOUNT_ID = "league-dues-amount";
const AMOUNT_DESCRIPTION_ID = "league-dues-amount-description";
const AMOUNT_ERROR_ID = "league-dues-amount-error";

function DuesForm({ league }: { league: LeagueResponse }) {
  const updateDues = useUpdateLeagueDues(league.id);
  const tracking = league.duesAmount !== null;

  // A string draft rather than NumberField's numeric value: "not tracking" is
  // an empty field here, and NumberField has no empty state — it always holds
  // a number to submit. Clearing goes through its own button, so an empty
  // draft is simply "nothing to save", never an implicit clear.
  const [draft, setDraft] = useState(tracking ? String(league.duesAmount) : "");
  const trimmed = draft.trim();
  const parsed = trimmed === "" ? null : DuesAmountSchema.safeParse(Number(trimmed));
  const invalid = parsed !== null && !parsed.success;
  const amount = parsed?.success ? parsed.data : null;
  const canSave = amount !== null && amount !== league.duesAmount && !updateDues.isPending;

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={AMOUNT_ID}>Amount per member (USD)</Label>
        <Input
          id={AMOUNT_ID}
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_DUES_AMOUNT}
          step={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={[AMOUNT_DESCRIPTION_ID, invalid ? AMOUNT_ERROR_ID : null]
            .filter(Boolean)
            .join(" ")}
        />
        <p id={AMOUNT_DESCRIPTION_ID} className="text-sm text-muted-foreground">
          {tracking
            ? "Paid marks are kept if you stop tracking — set an amount again and they come back."
            : "Set an amount to start tracking. Members can then be marked paid from the Members tab."}
        </p>
        {invalid && (
          <p id={AMOUNT_ERROR_ID} className="text-sm text-destructive">
            Whole dollars, 1 to {MAX_DUES_AMOUNT.toLocaleString()}.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!canSave}
          onClick={() => amount !== null && updateDues.mutate(amount)}
        >
          Save dues
        </Button>
        {tracking && (
          <Button
            variant="outline"
            size="sm"
            disabled={updateDues.isPending}
            onClick={() => updateDues.mutate(null)}
          >
            Stop tracking
          </Button>
        )}
      </div>
    </>
  );
}
