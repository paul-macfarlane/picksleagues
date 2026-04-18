"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { LockIcon } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { updateLeagueAction } from "@/actions/leagues";
import { LeagueAvatar } from "@/components/leagues/league-avatar";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { League } from "@/lib/db/schema/leagues";
import type { Phase } from "@/lib/db/schema/sports";
import { comparePhasesByOrdinal, phaseLabel } from "@/lib/nfl/leagues";
import {
  PICK_TYPE_LABELS,
  updateLeagueSchema,
  type UpdateLeagueInput,
} from "@/lib/validators/leagues";

type UpdateLeagueOutput = z.output<typeof updateLeagueSchema>;

type PhaseOption = {
  value: string;
  label: string;
  seasonType: Phase["seasonType"];
  weekNumber: number;
};

function toPhaseOption(phase: Phase): PhaseOption {
  return {
    value: `${phase.seasonType}:${phase.weekNumber}`,
    label: phaseLabel(phase.seasonType, phase.weekNumber),
    seasonType: phase.seasonType,
    weekNumber: phase.weekNumber,
  };
}

function parsePhaseValue(value: string): {
  seasonType: Phase["seasonType"];
  weekNumber: number;
} {
  const [seasonType, week] = value.split(":");
  return {
    seasonType: seasonType as Phase["seasonType"],
    weekNumber: Number(week),
  };
}

export function EditLeagueForm({
  league,
  phases,
  structuralLocked,
  memberCount,
  readOnly = false,
}: {
  league: League;
  phases: Phase[];
  structuralLocked: boolean;
  memberCount: number;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Include the league's current endpoints even if they aren't in the
  // current season's phase list (e.g. an old end-week that's already been
  // cleaned up). Sort the combined list so appended endpoints don't render
  // out of order below the in-season phases.
  const options: PhaseOption[] = [...phases.map(toPhaseOption)];
  for (const endpoint of [
    { seasonType: league.startSeasonType, weekNumber: league.startWeekNumber },
    { seasonType: league.endSeasonType, weekNumber: league.endWeekNumber },
  ]) {
    const value = `${endpoint.seasonType}:${endpoint.weekNumber}`;
    if (!options.some((o) => o.value === value)) {
      options.push({
        value,
        label: phaseLabel(endpoint.seasonType, endpoint.weekNumber),
        seasonType: endpoint.seasonType,
        weekNumber: endpoint.weekNumber,
      });
    }
  }
  options.sort(comparePhasesByOrdinal);

  const defaults: UpdateLeagueInput = {
    leagueId: league.id,
    name: league.name,
    imageUrl: league.imageUrl ?? "",
    startSeasonType: league.startSeasonType,
    startWeekNumber: league.startWeekNumber,
    endSeasonType: league.endSeasonType,
    endWeekNumber: league.endWeekNumber,
    size: league.size,
    picksPerPhase: league.picksPerPhase,
    pickType: league.pickType,
  };

  const form = useForm<UpdateLeagueInput, unknown, UpdateLeagueOutput>({
    resolver: zodResolver(updateLeagueSchema),
    mode: "onBlur",
    defaultValues: defaults,
  });

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
  } = form;

  const startSeasonType = useWatch({ control, name: "startSeasonType" });
  const startWeekNumber = useWatch({ control, name: "startWeekNumber" });
  const endSeasonType = useWatch({ control, name: "endSeasonType" });
  const endWeekNumber = useWatch({ control, name: "endWeekNumber" });
  const pickType = useWatch({ control, name: "pickType" });
  const watchedName = useWatch({ control, name: "name" });
  const watchedImageUrl = useWatch({ control, name: "imageUrl" });

  const startValue = `${startSeasonType}:${startWeekNumber}`;
  const endValue = `${endSeasonType}:${endWeekNumber}`;

  function onSubmit(values: UpdateLeagueOutput) {
    startTransition(async () => {
      const result = await updateLeagueAction(values);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("League updated.");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-6"
      noValidate
    >
      <input type="hidden" {...register("leagueId")} />
      {readOnly ? (
        <p className="flex items-start gap-2 rounded-md border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">
          <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Only commissioners can edit these settings.</span>
        </p>
      ) : structuralLocked ? (
        <p className="flex items-start gap-2 rounded-md border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">
          <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Structural settings are locked once the season&apos;s first pick
            lock has passed. Name and image stay editable.
          </span>
        </p>
      ) : null}

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="league-name">Name</FieldLabel>
          <Input
            id="league-name"
            disabled={readOnly}
            {...register("name")}
            aria-invalid={errors.name ? true : undefined}
          />
          <FieldDescription>3–50 characters.</FieldDescription>
          <FieldError errors={[errors.name]} />
        </Field>

        <Field>
          <FieldLabel htmlFor="league-image">Image URL</FieldLabel>
          <div className="flex items-center gap-3">
            <LeagueAvatar
              name={watchedName ?? league.name}
              imageUrl={watchedImageUrl}
              size="lg"
            />
            <Input
              id="league-image"
              type="url"
              placeholder="https://…"
              disabled={readOnly}
              {...register("imageUrl")}
              aria-invalid={errors.imageUrl ? true : undefined}
            />
          </div>
          <FieldDescription>
            Optional. Paste a link and the preview updates live.
          </FieldDescription>
          <FieldError errors={[errors.imageUrl]} />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="league-start-week">Start week</FieldLabel>
            <Select
              value={startValue}
              disabled={readOnly || structuralLocked}
              onValueChange={(value) => {
                const parsed = parsePhaseValue(value);
                setValue("startSeasonType", parsed.seasonType, {
                  shouldDirty: true,
                });
                setValue("startWeekNumber", parsed.weekNumber, {
                  shouldDirty: true,
                  shouldValidate: true,
                });
              }}
            >
              <SelectTrigger id="league-start-week">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="league-end-week">End week</FieldLabel>
            <Select
              value={endValue}
              disabled={readOnly || structuralLocked}
              onValueChange={(value) => {
                const parsed = parsePhaseValue(value);
                setValue("endSeasonType", parsed.seasonType, {
                  shouldDirty: true,
                });
                setValue("endWeekNumber", parsed.weekNumber, {
                  shouldDirty: true,
                  shouldValidate: true,
                });
              }}
            >
              <SelectTrigger id="league-end-week">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <FieldError errors={[errors.endWeekNumber]} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="league-size">League size</FieldLabel>
            <Input
              id="league-size"
              type="number"
              inputMode="numeric"
              min={Math.max(2, memberCount)}
              max={20}
              disabled={readOnly || structuralLocked}
              {...register("size")}
              aria-invalid={errors.size ? true : undefined}
            />
            <FieldDescription>
              Minimum {Math.max(2, memberCount)} (current members). Max 20.
            </FieldDescription>
            <FieldError errors={[errors.size]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="league-picks-per-phase">
              Picks per phase
            </FieldLabel>
            <Input
              id="league-picks-per-phase"
              type="number"
              inputMode="numeric"
              min={1}
              max={16}
              disabled={readOnly || structuralLocked}
              {...register("picksPerPhase")}
              aria-invalid={errors.picksPerPhase ? true : undefined}
            />
            <FieldDescription>1–16 games per phase.</FieldDescription>
            <FieldError errors={[errors.picksPerPhase]} />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="league-pick-type">Pick type</FieldLabel>
          <Select
            value={pickType}
            disabled={readOnly || structuralLocked}
            onValueChange={(value) =>
              setValue("pickType", value as UpdateLeagueInput["pickType"], {
                shouldDirty: true,
              })
            }
          >
            <SelectTrigger id="league-pick-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PICK_TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError errors={[errors.pickType]} />
        </Field>
      </FieldGroup>

      {readOnly ? null : (
        <Button type="submit" size="lg" disabled={isPending} className="w-full">
          {isPending ? "Saving…" : "Save changes"}
        </Button>
      )}
    </form>
  );
}
