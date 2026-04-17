"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { createLeagueAction } from "@/actions/leagues";
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
import {
  LEAGUE_SIZE_DEFAULT,
  PICKS_PER_PHASE_DEFAULT,
  PICK_TYPE_LABELS,
  SEASON_FORMAT_LABELS,
  createLeagueSchema,
  type CreateLeagueInput,
} from "@/lib/validators/leagues";

type CreateLeagueOutput = z.output<typeof createLeagueSchema>;

export function CreateLeagueForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const defaults: CreateLeagueInput = {
    name: "",
    imageUrl: "",
    seasonFormat: "regular_season",
    size: LEAGUE_SIZE_DEFAULT,
    picksPerPhase: PICKS_PER_PHASE_DEFAULT,
    pickType: "straight_up",
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

  const seasonFormat = useWatch({ control, name: "seasonFormat" });
  const pickType = useWatch({ control, name: "pickType" });

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
          <Input
            id="league-image"
            type="url"
            placeholder="https://…"
            {...register("imageUrl")}
            aria-invalid={errors.imageUrl ? true : undefined}
          />
          <FieldDescription>
            Optional. Paste a link to a logo or banner.
          </FieldDescription>
          <FieldError errors={[errors.imageUrl]} />
        </Field>

        <Field>
          <FieldLabel htmlFor="league-season-format">Season format</FieldLabel>
          <Select
            value={seasonFormat}
            onValueChange={(value) =>
              setValue(
                "seasonFormat",
                value as CreateLeagueInput["seasonFormat"],
                {
                  shouldDirty: true,
                },
              )
            }
          >
            <SelectTrigger id="league-season-format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SEASON_FORMAT_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            Which portion of the NFL season this league covers.
          </FieldDescription>
          <FieldError errors={[errors.seasonFormat]} />
        </Field>

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
