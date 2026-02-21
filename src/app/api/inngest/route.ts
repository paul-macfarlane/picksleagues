import { serve } from "inngest/next";

import { helloWorld, inngest } from "@/lib/inngest";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [helloWorld],
});
