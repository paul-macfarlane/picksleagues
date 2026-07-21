// Open-redirect guard for the `?redirect` search param that threads invite-link
// returns through sign-in → claim (mvp-spec §Users & Identity onboarding;
// consumed by LG-3's `/join/:code` later). Only same-origin, root-relative
// paths are honored — anything else (protocol-relative `//host`, absolute
// URLs, missing) falls back to the dashboard. Backslashes are rejected because
// browsers normalize `\` to `/`, so `/\evil.com` would become protocol-relative.
export function safeInternalPath(raw: string | undefined): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\")) {
    return raw;
  }
  return "/";
}
