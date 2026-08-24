/**
 * One short tick when a pick save lands (MOB-7), fired from the mutation
 * hooks' success paths so every surface sharing the hook gets it exactly
 * once — a component-level call would add a second buzz the first time two
 * surfaces render the same mutation. No-ops where the Vibration API is
 * missing (all of iOS) or blocked; feedback there stays the toast alone.
 */
export function pickSavedHaptic(): void {
  try {
    navigator.vibrate?.(10);
  } catch {
    // Some embedded webviews throw instead of returning false; a failed
    // buzz must never fail the save's success path.
  }
}
