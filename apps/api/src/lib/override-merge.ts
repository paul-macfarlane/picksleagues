/**
 * Three-state merge for override patch requests (arch D15): `undefined` leaves
 * the stored override, `null` clears it back to provider truth, a value sets
 * it. Shared by every `override_*` write service (games, NFL stats) so the
 * omitted-vs-null distinction — the entire point of the wire shape — has one
 * implementation to get wrong.
 */
export function mergeOverrideField<T>(patch: T | null | undefined, stored: T | null): T | null {
  return patch === undefined ? stored : patch;
}
