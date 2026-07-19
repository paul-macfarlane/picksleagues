import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const port = 3000;

serve({ fetch: createApp().fetch, port }, () => {
  console.log(`API dev server listening on http://localhost:${port}/api`);
});
