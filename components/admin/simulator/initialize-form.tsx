"use client";

import { useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { initializeSimulatorAction } from "@/actions/simulator";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  initializeSimulatorSchema,
  type InitializeSimulatorInput,
} from "@/lib/validators/simulator";

export function InitializeSimulatorForm({
  currentYear,
  minYear,
}: {
  currentYear: number;
  minYear: number;
}) {
  const [isPending, startTransition] = useTransition();
  const form = useForm<InitializeSimulatorInput>({
    resolver: zodResolver(initializeSimulatorSchema),
    defaultValues: { year: currentYear - 1 },
    mode: "onBlur",
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = form;

  function onSubmit(values: InitializeSimulatorInput) {
    startTransition(async () => {
      const result = await initializeSimulatorAction(values);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Initialized season ${values.year}`);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Initialize season</CardTitle>
        <CardDescription>
          Replays historical ESPN data for the chosen season. Replaces any
          existing simulation.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
          noValidate
        >
          <Field>
            <FieldLabel htmlFor="year">Season year</FieldLabel>
            <Input
              id="year"
              type="number"
              inputMode="numeric"
              min={minYear}
              max={currentYear}
              {...register("year", { valueAsNumber: true })}
              aria-invalid={errors.year ? true : undefined}
            />
            <FieldDescription>
              Between {minYear} and {currentYear}.
            </FieldDescription>
            <FieldError errors={[errors.year]} />
          </Field>
          <Button type="submit" disabled={isPending} className="w-fit">
            {isPending ? "Initializing…" : "Initialize"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
