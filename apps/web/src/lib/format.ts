// One home for "render an ISO timestamp in the viewer's local timezone"
// (engineering rules: kickoff times/deadlines always render local, never a
// fixed zone) — every kickoff/deadline display in the SPA goes through this.
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}
