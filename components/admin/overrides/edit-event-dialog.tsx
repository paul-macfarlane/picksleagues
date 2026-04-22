"use client";

import { useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { PencilIcon } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { updateEventAction } from "@/actions/admin-overrides";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EventWithTeams } from "@/data/events";
import type { Team } from "@/lib/db/schema/sports";
import {
  UTC_DATETIME_FORMAT,
  eventStatusValues,
  updateEventSchema,
  type UpdateEventInput,
} from "@/lib/validators/admin-overrides";

import { numberToInput, toUtcInput } from "./format";

type UpdateEventOutput = z.output<typeof updateEventSchema>;

const STATUS_LABELS: Record<(typeof eventStatusValues)[number], string> = {
  not_started: "Not started",
  in_progress: "In progress",
  final: "Final",
};

export function EditEventDialog({
  event,
  teams,
}: {
  event: EventWithTeams;
  teams: Team[];
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const sortedTeams = [...teams].sort((a, b) =>
    a.abbreviation.localeCompare(b.abbreviation),
  );

  const defaults: UpdateEventInput = {
    id: event.id,
    homeTeamId: event.homeTeamId,
    awayTeamId: event.awayTeamId,
    startTime: toUtcInput(event.startTime),
    status: event.status,
    homeScore: numberToInput(event.homeScore),
    awayScore: numberToInput(event.awayScore),
    period: numberToInput(event.period),
    clock: event.clock ?? "",
  };

  const form = useForm<UpdateEventInput, unknown, UpdateEventOutput>({
    resolver: zodResolver(updateEventSchema),
    mode: "onBlur",
    defaultValues: defaults,
  });

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = form;

  function onSubmit(values: UpdateEventOutput) {
    startTransition(async () => {
      const result = await updateEventAction(values);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Updated ${event.awayTeam.abbreviation} @ ${event.homeTeam.abbreviation}`,
      );
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
          <DialogTitle>Edit event</DialogTitle>
          <DialogDescription>
            Saving locks this row. Scores are required when status is final.
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
              <FieldLabel htmlFor="event-away-team">Away team</FieldLabel>
              <Controller
                name="awayTeamId"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="event-away-team" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sortedTeams.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.abbreviation} — {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError errors={[errors.awayTeamId]} />
            </Field>

            <Field>
              <FieldLabel htmlFor="event-home-team">Home team</FieldLabel>
              <Controller
                name="homeTeamId"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="event-home-team" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sortedTeams.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.abbreviation} — {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError errors={[errors.homeTeamId]} />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="event-start">Kickoff</FieldLabel>
            <Input
              id="event-start"
              placeholder="2025-09-09 13:00"
              {...register("startTime")}
              aria-invalid={errors.startTime ? true : undefined}
            />
            <FieldDescription>{UTC_DATETIME_FORMAT}</FieldDescription>
            <FieldError errors={[errors.startTime]} />
          </Field>

          <Field>
            <FieldLabel htmlFor="event-status">Status</FieldLabel>
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="event-status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {eventStatusValues.map((status) => (
                      <SelectItem key={status} value={status}>
                        {STATUS_LABELS[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.status]} />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="event-away-score">Away score</FieldLabel>
              <Input
                id="event-away-score"
                inputMode="numeric"
                {...register("awayScore")}
                aria-invalid={errors.awayScore ? true : undefined}
              />
              <FieldError errors={[errors.awayScore]} />
            </Field>

            <Field>
              <FieldLabel htmlFor="event-home-score">Home score</FieldLabel>
              <Input
                id="event-home-score"
                inputMode="numeric"
                {...register("homeScore")}
                aria-invalid={errors.homeScore ? true : undefined}
              />
              <FieldError errors={[errors.homeScore]} />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="event-period">Period</FieldLabel>
              <Input
                id="event-period"
                inputMode="numeric"
                placeholder="e.g. 3"
                {...register("period")}
                aria-invalid={errors.period ? true : undefined}
              />
              <FieldDescription>1–4 regular, 5+ overtime.</FieldDescription>
              <FieldError errors={[errors.period]} />
            </Field>

            <Field>
              <FieldLabel htmlFor="event-clock">Clock</FieldLabel>
              <Input
                id="event-clock"
                placeholder="e.g. 4:12"
                {...register("clock")}
                aria-invalid={errors.clock ? true : undefined}
              />
              <FieldError errors={[errors.clock]} />
            </Field>
          </div>

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
