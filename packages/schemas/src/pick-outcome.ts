import { z } from "@hono/zod-openapi";

/**
 * How a settled pick resolved. Mode-agnostic on purpose: Pick'em grades against
 * this set (spec §Pick'em Scoring) and so does March Madness (spec §Game Mode 3
 * grades each bracket slot correct/incorrect, with vacated-team pushes).
 *
 * `PUSH` covers both the ATS push and the SU tie, plus the spec's
 * cancellation-as-push rule — all three earn the same fixed half point in
 * Pick'em (ADR-0018), so they are one outcome, not three.
 *
 * A pick whose game has not reached a terminal state has no outcome at all and
 * no result row (arch D10 — results are a pure derivation).
 */
export const PICK_OUTCOME = {
  CORRECT: "correct",
  INCORRECT: "incorrect",
  PUSH: "push",
} as const;

export type PickOutcome = (typeof PICK_OUTCOME)[keyof typeof PICK_OUTCOME];

export const PickOutcomeSchema = z.enum(PICK_OUTCOME).openapi("PickOutcome");
