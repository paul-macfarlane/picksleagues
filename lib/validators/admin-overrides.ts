import { z } from "zod";

export const OVERRIDE_ENTITIES = ["team", "phase", "event", "odds"] as const;
export type OverrideEntity = (typeof OVERRIDE_ENTITIES)[number];

export const toggleLockSchema = z.object({
  entity: z.enum(OVERRIDE_ENTITIES),
  id: z.string().uuid({ error: "Invalid id." }),
  locked: z.boolean(),
});

export type ToggleLockInput = z.infer<typeof toggleLockSchema>;
