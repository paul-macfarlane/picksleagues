import { z } from "zod";

export const initializeSimulatorSchema = z.object({
  year: z
    .number({ error: "Year must be a number." })
    .int("Year must be a whole number."),
});

export type InitializeSimulatorInput = z.infer<
  typeof initializeSimulatorSchema
>;
