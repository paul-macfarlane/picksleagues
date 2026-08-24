import { LEAGUE_MODE, type LeagueResponse } from "@picksleagues/schemas";
import { VISIBILITY_OPTIONS } from "@/components/league-settings-fields";
import { LabeledValue } from "@/components/labeled-value";
import { Section } from "@/components/section";
import { nflSeasonRangeLabel, pickTypeLabel } from "@/lib/league";
import {
  marchMadnessSettingsOf,
  pickemSettingsOf,
  survivorSettingsOf,
} from "@/lib/league-settings";

/**
 * The member-facing Settings tab: the league's configuration stated as
 * values, not as a disabled copy of the commissioner's form — greyed radios
 * and steppers a member can never use read as broken controls, and they bury
 * the four facts the member came for. Commissioners get the editor
 * (`LeagueSettingsSection`) instead; the route branches on the role axis.
 *
 * Dues and Leave league are deliberately absent: both already live on the
 * Members tab for every member (members-section.tsx), and the league name is
 * the band above.
 */
export function LeagueSettingsSummary({ league }: { league: LeagueResponse }) {
  const visibilityLabel =
    VISIBILITY_OPTIONS.find((option) => option.value === league.visibility)?.label ??
    league.visibility;

  // Parsed, never cast (see lib/league-settings.ts). `null` here means the
  // stored blob doesn't parse — a state the server can't normally produce —
  // and a member can't fix settings, so the mode lines are simply omitted
  // rather than shown as guesses.
  const pickemSettings = pickemSettingsOf(league);
  const survivorSettings = survivorSettingsOf(league);
  const marchMadnessSettings = marchMadnessSettingsOf(league);

  return (
    <Section title="League settings" description="Set by the commissioner." className="gap-4">
      <div className="flex flex-col gap-2">
        <LabeledValue label="Visibility">{visibilityLabel}</LabeledValue>
        <LabeledValue label="Max members">{league.maxMembers}</LabeledValue>

        {league.mode === LEAGUE_MODE.PICKEM && pickemSettings && (
          <>
            <LabeledValue label="Season range">{nflSeasonRangeLabel(pickemSettings)}</LabeledValue>
            <LabeledValue label="Pick type">{pickTypeLabel(pickemSettings.pickType)}</LabeledValue>
            <LabeledValue label="Picks per week">{pickemSettings.picksPerWeek}</LabeledValue>
          </>
        )}

        {league.mode === LEAGUE_MODE.SURVIVOR && survivorSettings && (
          <LabeledValue label="Season range">{nflSeasonRangeLabel(survivorSettings)}</LabeledValue>
        )}

        {league.mode === LEAGUE_MODE.MARCH_MADNESS && marchMadnessSettings && (
          <LabeledValue label="Max brackets per member">
            {marchMadnessSettings.maxBracketsPerMember}
          </LabeledValue>
        )}
      </div>
    </Section>
  );
}
