/**
 * The row tier (ADR-0043 §2) has no component — it is a list item with a
 * hairline below it — but it does have one class string, because a row that
 * draws its own box inside a section is the nesting the tiers exist to
 * remove, and nine call sites each restating the hairline drift in exactly
 * the padding a reader notices. A row's *left edge* may carry a rule that
 * encodes its state (`pickOutcomeAccentClassName`); a row never carries a
 * border of its own.
 */
export const rowClassName = "border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0";

/**
 * The left rule a row may carry (ADR-0043 §2): 3px wide, which is the narrowest
 * a rule stays visible beside the hairline at 390px. Colour is the caller's —
 * `pickOutcomeAccentClassName` for a graded pick, `border-l-primary` for the
 * one the member has selected — and a row with no state to encode keeps the
 * transparent rule so its content stays aligned with its neighbours'.
 */
export const rowRuleClassName = "border-l-3 border-l-transparent pl-3";
