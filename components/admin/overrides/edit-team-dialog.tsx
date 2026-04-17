"use client";

import { useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { PencilIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { updateTeamAction } from "@/actions/admin-overrides";
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
import type { Team } from "@/lib/db/schema/sports";
import type { z } from "zod";
import {
  updateTeamSchema,
  type UpdateTeamInput,
} from "@/lib/validators/admin-overrides";

type UpdateTeamOutput = z.output<typeof updateTeamSchema>;

export function EditTeamDialog({ team }: { team: Team }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const defaults: UpdateTeamInput = {
    id: team.id,
    name: team.name,
    location: team.location,
    abbreviation: team.abbreviation,
    logoUrl: team.logoUrl ?? "",
    logoDarkUrl: team.logoDarkUrl ?? "",
  };

  const form = useForm<UpdateTeamInput, unknown, UpdateTeamOutput>({
    resolver: zodResolver(updateTeamSchema),
    mode: "onBlur",
    defaultValues: defaults,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = form;

  function onSubmit(values: UpdateTeamOutput) {
    startTransition(async () => {
      const result = await updateTeamAction(values);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Updated ${values.abbreviation}`);
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
          <DialogTitle>Edit team</DialogTitle>
          <DialogDescription>
            Saving locks this row so future ESPN syncs won&apos;t overwrite your
            edits.
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
              <FieldLabel htmlFor="team-location">Location</FieldLabel>
              <Input
                id="team-location"
                {...register("location")}
                aria-invalid={errors.location ? true : undefined}
              />
              <FieldError errors={[errors.location]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="team-name">Name</FieldLabel>
              <Input
                id="team-name"
                {...register("name")}
                aria-invalid={errors.name ? true : undefined}
              />
              <FieldError errors={[errors.name]} />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="team-abbreviation">Abbreviation</FieldLabel>
            <Input
              id="team-abbreviation"
              className="uppercase"
              {...register("abbreviation")}
              aria-invalid={errors.abbreviation ? true : undefined}
            />
            <FieldDescription>2–5 uppercase letters.</FieldDescription>
            <FieldError errors={[errors.abbreviation]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="team-logo-url">Logo URL</FieldLabel>
            <Input
              id="team-logo-url"
              type="url"
              placeholder="https://..."
              {...register("logoUrl")}
              aria-invalid={errors.logoUrl ? true : undefined}
            />
            <FieldError errors={[errors.logoUrl]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="team-logo-dark-url">
              Logo URL (dark mode)
            </FieldLabel>
            <Input
              id="team-logo-dark-url"
              type="url"
              placeholder="https://..."
              {...register("logoDarkUrl")}
              aria-invalid={errors.logoDarkUrl ? true : undefined}
            />
            <FieldError errors={[errors.logoDarkUrl]} />
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
