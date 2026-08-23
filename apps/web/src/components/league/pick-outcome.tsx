import { CheckIcon, MinusIcon, XIcon } from "lucide-react";
import { PICK_OUTCOME, type PickOutcome } from "@picksleagues/schemas";
import { StatusPill, type StatusPillTone } from "@/components/status-pill";

/**
 * How a settled pick reads across every surface that shows one: the pick
 * editor's rows and the week/pick detail's per-member list today, March
 * Madness's bracket slots later (`PICK_OUTCOME` is mode-agnostic by design —
 * see the engineering rules' list of genuinely shared surfaces, which is why
 * this isn't named `pickem*`).
 *
 * **Colour never carries the meaning alone.** Each outcome pairs a hue with a
 * distinct glyph and a word, so the distinction survives colour-blindness and
 * greyscale. The words grade the *pick*, not the game: "Correct" rather than
 * "Won", since a member can pick correctly on a team that lost against the
 * spread — and, in an ATS league, the reverse.
 *
 * Nothing here renders for an unsettled pick. A pick whose game hasn't reached
 * a terminal state has no result row at all (arch D10), and a checkmark on one
 * would claim an outcome the app doesn't have yet.
 */
const PICK_OUTCOME_DISPLAY = {
  [PICK_OUTCOME.CORRECT]: {
    label: "Correct",
    Icon: CheckIcon,
    tone: "success",
    button: "border-success bg-success/10 text-success hover:bg-success/10",
  },
  [PICK_OUTCOME.INCORRECT]: {
    label: "Incorrect",
    Icon: XIcon,
    tone: "danger",
    button: "border-destructive bg-destructive/10 text-destructive hover:bg-destructive/10",
  },
  [PICK_OUTCOME.PUSH]: {
    label: "Push",
    Icon: MinusIcon,
    // Deliberately the neutral tone: a push is neither, and giving it a third
    // hue would imply a third verdict rather than the absence of one.
    tone: "neutral",
    button: "border-border bg-muted text-muted-foreground hover:bg-muted",
  },
} as const satisfies Record<
  PickOutcome,
  { label: string; Icon: typeof CheckIcon; tone: StatusPillTone; button: string }
>;

/** Tint for the control showing the side that was picked, once it has graded. */
export function pickOutcomeButtonClassName(outcome: PickOutcome): string {
  return PICK_OUTCOME_DISPLAY[outcome].button;
}

/**
 * The left rule on a pick row, coloured by how the pick graded (FB-42) — what
 * lets a member scan a week's worth of rows instead of reading each one.
 *
 * **Redundant by design.** The rule repeats what the row's badge already says
 * in a glyph and a word, exactly so the same colour-never-alone rule this
 * module is built on still holds: strip the colour and nothing is lost. A push
 * gets the hairline colour — a verdict, but not one with a hue (see the table
 * above) — and an ungraded pick gets no colour at all, which on the row tier's
 * always-present rule (`rowRuleClassName`) reads as "nothing to say yet"
 * rather than as a missing rule.
 */
export function pickOutcomeAccentClassName(outcome: PickOutcome | null): string {
  if (outcome === PICK_OUTCOME.CORRECT) return "border-l-success";
  if (outcome === PICK_OUTCOME.INCORRECT) return "border-l-destructive";
  if (outcome === PICK_OUTCOME.PUSH) return "border-l-border";
  return "border-l-transparent";
}

export function PickOutcomeIcon({ outcome }: { outcome: PickOutcome }) {
  const { Icon } = PICK_OUTCOME_DISPLAY[outcome];
  return <Icon aria-hidden="true" />;
}

/**
 * The pill form, sharing the shape of the row's other badges (Locked, No line
 * yet) because it takes their slot once a pick settles — by then "Locked" is
 * both implied and the less interesting fact.
 */
export function PickOutcomeBadge({
  outcome,
  className,
}: {
  outcome: PickOutcome;
  className?: string;
}) {
  const { label, Icon, tone } = PICK_OUTCOME_DISPLAY[outcome];
  return (
    // `data-outcome` is the grade itself (`PICK_OUTCOME`), which is what the
    // merge-gate journey asserts — the label beside it is copy, and "Correct"
    // is a substring of "Incorrect" besides.
    <StatusPill tone={tone} className={className} data-testid="pick-outcome" data-outcome={outcome}>
      <Icon aria-hidden="true" className="size-3" />
      {label}
    </StatusPill>
  );
}
