import { z } from "@hono/zod-openapi";

// mvp-spec §Users & Identity: display name is prefilled from the OAuth
// provider and freely editable; the spec states no length bound, so 1-50
// trimmed is our chosen sanity bound — the single source served to both the
// API and the UI.
export const DisplayNameSchema = z.string().trim().min(1).max(50).openapi("DisplayName");

export type DisplayName = z.infer<typeof DisplayNameSchema>;
