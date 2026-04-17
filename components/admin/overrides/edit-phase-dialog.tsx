"use client";

import { useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { formatInTimeZone } from "date-fns-tz";
import { PencilIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { updatePhaseAction } from "@/actions/admin-overrides";
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
import type { Phase } from "@/lib/db/schema/sports";
import type { z } from "zod";
import {
  UTC_DATETIME_FORMAT,
  updatePhaseSchema,
  type UpdatePhaseInput,
} from "@/lib/validators/admin-overrides";

type UpdatePhaseOutput = z.output<typeof updatePhaseSchema>;

function toUtcInput(d: Date): string {
  return formatInTimeZone(d, "UTC", "yyyy-MM-dd HH:mm");
}

export function EditPhaseDialog({ phase }: { phase: Phase }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const defaults: UpdatePhaseInput = {
    id: phase.id,
    label: phase.label,
    startDate: toUtcInput(phase.startDate),
    endDate: toUtcInput(phase.endDate),
    pickLockTime: toUtcInput(phase.pickLockTime),
  };

  const form = useForm<UpdatePhaseInput, unknown, UpdatePhaseOutput>({
    resolver: zodResolver(updatePhaseSchema),
    mode: "onBlur",
    defaultValues: defaults,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = form;

  function onSubmit(values: UpdatePhaseOutput) {
    startTransition(async () => {
      const result = await updatePhaseAction(values);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Updated ${values.label}`);
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit phase</DialogTitle>
          <DialogDescription>
            Times are UTC. Saving locks this row so future ESPN syncs won&apos;t
            overwrite your edits.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
          noValidate
        >
          <input type="hidden" {...register("id")} />
          <Field>
            <FieldLabel htmlFor="phase-label">Label</FieldLabel>
            <Input
              id="phase-label"
              {...register("label")}
              aria-invalid={errors.label ? true : undefined}
            />
            <FieldError errors={[errors.label]} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="phase-start">Starts</FieldLabel>
              <Input
                id="phase-start"
                placeholder={UTC_DATETIME_FORMAT}
                {...register("startDate")}
                aria-invalid={errors.startDate ? true : undefined}
              />
              <FieldDescription>{UTC_DATETIME_FORMAT}</FieldDescription>
              <FieldError errors={[errors.startDate]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="phase-end">Ends</FieldLabel>
              <Input
                id="phase-end"
                placeholder={UTC_DATETIME_FORMAT}
                {...register("endDate")}
                aria-invalid={errors.endDate ? true : undefined}
              />
              <FieldDescription>{UTC_DATETIME_FORMAT}</FieldDescription>
              <FieldError errors={[errors.endDate]} />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="phase-lock">Pick lock</FieldLabel>
            <Input
              id="phase-lock"
              placeholder={UTC_DATETIME_FORMAT}
              {...register("pickLockTime")}
              aria-invalid={errors.pickLockTime ? true : undefined}
            />
            <FieldDescription>
              Picks freeze for this phase at this time.
            </FieldDescription>
            <FieldError errors={[errors.pickLockTime]} />
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
