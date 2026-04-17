"use client";

import { useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { PencilIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { updateOddsAction } from "@/actions/admin-overrides";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { OddsWithContext } from "@/data/events";
import {
  updateOddsSchema,
  type UpdateOddsInput,
} from "@/lib/validators/admin-overrides";

type UpdateOddsOutput = z.output<typeof updateOddsSchema>;

function toStringOrEmpty(n: number | null): string {
  return n === null ? "" : String(n);
}

export function EditOddsDialog({ row }: { row: OddsWithContext }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const matchup = `${row.event.awayTeam.abbreviation} @ ${row.event.homeTeam.abbreviation}`;

  const defaults: UpdateOddsInput = {
    id: row.id,
    homeSpread: toStringOrEmpty(row.homeSpread),
    awaySpread: toStringOrEmpty(row.awaySpread),
    homeMoneyline: toStringOrEmpty(row.homeMoneyline),
    awayMoneyline: toStringOrEmpty(row.awayMoneyline),
    overUnder: toStringOrEmpty(row.overUnder),
  };

  const form = useForm<UpdateOddsInput, unknown, UpdateOddsOutput>({
    resolver: zodResolver(updateOddsSchema),
    mode: "onBlur",
    defaultValues: defaults,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = form;

  function onSubmit(values: UpdateOddsOutput) {
    startTransition(async () => {
      const result = await updateOddsAction(values);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Updated odds for ${matchup}`);
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isPending && !next) return;
        if (next) reset(defaults);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <PencilIcon className="size-3.5" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit odds — {matchup}</DialogTitle>
          <DialogDescription>
            {row.sportsbook.name}. Leave a field empty to store it as null.
            Saving locks this row.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
          noValidate
        >
          <input type="hidden" {...register("id")} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="odds-away-spread">Away spread</FieldLabel>
              <Input
                id="odds-away-spread"
                inputMode="decimal"
                placeholder="e.g. 3.5"
                {...register("awaySpread")}
                aria-invalid={errors.awaySpread ? true : undefined}
              />
              <FieldError errors={[errors.awaySpread]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="odds-home-spread">Home spread</FieldLabel>
              <Input
                id="odds-home-spread"
                inputMode="decimal"
                placeholder="e.g. -3.5"
                {...register("homeSpread")}
                aria-invalid={errors.homeSpread ? true : undefined}
              />
              <FieldError errors={[errors.homeSpread]} />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="odds-away-ml">Away moneyline</FieldLabel>
              <Input
                id="odds-away-ml"
                inputMode="numeric"
                placeholder="e.g. 150"
                {...register("awayMoneyline")}
                aria-invalid={errors.awayMoneyline ? true : undefined}
              />
              <FieldError errors={[errors.awayMoneyline]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="odds-home-ml">Home moneyline</FieldLabel>
              <Input
                id="odds-home-ml"
                inputMode="numeric"
                placeholder="e.g. -180"
                {...register("homeMoneyline")}
                aria-invalid={errors.homeMoneyline ? true : undefined}
              />
              <FieldError errors={[errors.homeMoneyline]} />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="odds-over-under">Over / under</FieldLabel>
            <Input
              id="odds-over-under"
              inputMode="decimal"
              placeholder="e.g. 47.5"
              {...register("overUnder")}
              aria-invalid={errors.overUnder ? true : undefined}
            />
            <FieldDescription>Game total.</FieldDescription>
            <FieldError errors={[errors.overUnder]} />
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save & lock"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
