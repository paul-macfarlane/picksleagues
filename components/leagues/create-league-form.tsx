"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { createLeagueAction } from "@/actions/leagues";
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
import type { Phase } from "@/lib/db/schema/sports";
import { phaseLabel } from "@/lib/nfl/leagues";
import {
  LEAGUE_SIZE_DEFAULT,
  PICKS_PER_PHASE_DEFAULT,
  PICK_TYPE_LABELS,
  createLeagueSchema,
  type CreateLeagueInput,
} from "@/lib/validators/leagues";

type CreateLeagueOutput = z.output<typeof createLeagueSchema>;

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

export function CreateLeagueForm({
  phases,
  defaultStartPhase,
  defaultEndPhase,
}: {
  phases: Phase[];
  defaultStartPhase: Pick<Phase, "seasonType" | "weekNumber">;
  defaultEndPhase: Pick<Phase, "seasonType" | "weekNumber">;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const options = phases.map(toPhaseOption);

  const defaults: CreateLeagueInput = {
    name: "",
    imageUrl: "",
    startSeasonType: defaultStartPhase.seasonType,
    startWeekNumber: defaultStartPhase.weekNumber,
    endSeasonType: defaultEndPhase.seasonType,
    endWeekNumber: defaultEndPhase.weekNumber,
    size: LEAGUE_SIZE_DEFAULT,
    picksPerPhase: PICKS_PER_PHASE_DEFAULT,
    pickType: "against_the_spread",
  };

  const form = useForm<CreateLeagueInput, unknown, CreateLeagueOutput>({
    resolver: zodResolver(createLeagueSchema),
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

  function onSubmit(values: CreateLeagueOutput) {
    startTransition(async () => {
      const result = await createLeagueAction(values);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Created ${values.name}`);
      router.push(`/leagues/${result.data.leagueId}`);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-6"
      noValidate
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="league-name">Name</FieldLabel>
          <Input
            id="league-name"
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
              name={watchedName ?? ""}
              imageUrl={watchedImageUrl}
              size="lg"
            />
            <Input
              id="league-image"
              type="url"
              placeholder="https://…"
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
        <FieldDescription>
          Pick the first and last week of the NFL schedule your league covers.
        </FieldDescription>
        <FieldError errors={[errors.endWeekNumber]} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="league-size">League size</FieldLabel>
            <Input
              id="league-size"
              type="number"
              inputMode="numeric"
              min={2}
              max={20}
              {...register("size")}
              aria-invalid={errors.size ? true : undefined}
            />
            <FieldDescription>2–20 members.</FieldDescription>
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
              {...register("picksPerPhase")}
              aria-invalid={errors.picksPerPhase ? true : undefined}
            />
            <FieldDescription>1–16 games to pick each phase.</FieldDescription>
            <FieldError errors={[errors.picksPerPhase]} />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="league-pick-type">Pick type</FieldLabel>
          <Select
            value={pickType}
            onValueChange={(value) =>
              setValue("pickType", value as CreateLeagueInput["pickType"], {
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

      <Button type="submit" size="lg" disabled={isPending} className="w-full">
        {isPending ? "Creating…" : "Create league"}
      </Button>
    </form>
  );
}
