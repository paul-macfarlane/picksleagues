import { z } from "@hono/zod-openapi";

/**
 * A member-supplied avatar URL (ADR-0022): any `https:` URL, length-bounded.
 * The single source for this rule — served to both the API and the UI.
 *
 * Deliberately not narrowed further. A host allowlist needs maintaining and
 * stops nothing, because every allowlistable CDN serves user-uploaded bytes by
 * definition; a server-side fetch to confirm the bytes are an image is TOCTOU
 * by construction and turns a member-supplied URL into an SSRF vector out of
 * our own egress. A URL that isn't an image degrades to the avatar's initials
 * fallback, which is the whole cost of being permissive here.
 */
export const ImageUrlSchema = z
  .url({ protocol: /^https$/ })
  .max(2048)
  .openapi("ImageUrl");

export type ImageUrl = z.infer<typeof ImageUrlSchema>;
