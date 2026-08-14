/**
 * String↔wire conversion shared by the override editors (games, NFL stats).
 * The invariant both directions protect: an empty input means "no override for
 * this field" — never zero, never an error — because clearing a field is how
 * an operator hands it back to the provider (arch D15).
 */

export function nullableToInput(value: number | null): string {
  return value === null ? "" : String(value);
}

/**
 * An empty field is an explicit clear; a non-empty non-number stays NaN so it
 * surfaces as a field error rather than being read as a clear (which is what
 * `Number("")`'s 0 would hide).
 */
export function toNullableNumber(raw: string): number | null {
  const trimmed = raw.trim();
  return trimmed === "" ? null : Number(trimmed);
}
