import createClient from "openapi-fetch";
import type { paths } from "@picksleagues/openapi";

// The SPA's only API surface (engineering rules §API-first): every request goes
// through the generated contract client — no hand-rolled fetch.
export const api = createClient<paths>({ baseUrl: "/" });
