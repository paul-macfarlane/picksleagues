"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { LockIcon } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { updateLeagueAction } from "@/actions/leagues";
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
import {
  PICK_TYPE_LABELS,
  SEASON_FORMAT_LABELS,
  updateLeagueSchema,
  type UpdateLeagueInput,
} from "@/lib/validators/leagues";

type UpdateLeagueOutput = z.output<typeof updateLeagueSchema>;

export function EditLeagueForm({
  league,
  inSeason,
  memberCount,
}: {
  league: League;
  inSeason: boolean;
  memberCount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const defaults: UpdateLeagueInput = {
    leagueId: league.id,
    name: league.name,
    imageUrl: league.imageUrl ?? "",
    seasonFormat: league.seasonFormat,
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

  const seasonFormat = useWatch({ control, name: "seasonFormat" });
  const pickType = useWatch({ control, name: "pickType" });

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
      {inSeason ? (
        <p className="flex items-start gap-2 rounded-md border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">
          <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Structural settings are locked while the league is in-season. Name
            and image stay editable.
          </span>
        </p>
      ) : null}

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
            disabled={inSeason}
            onValueChange={(value) =>
              setValue(
                "seasonFormat",
                value as UpdateLeagueInput["seasonFormat"],
                { shouldDirty: true },
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
          <FieldError errors={[errors.seasonFormat]} />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="league-size">League size</FieldLabel>
            <Input
              id="league-size"
              type="number"
              inputMode="numeric"
              min={Math.max(2, memberCount)}
              max={20}
              disabled={inSeason}
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
              disabled={inSeason}
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
            disabled={inSeason}
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

      <Button type="submit" size="lg" disabled={isPending} className="w-full">
        {isPending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
