import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import path from "node:path";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    // 5173/3000 for `pnpm dev`; both overridable so the E2E stack can run a
    // parallel SPA+API pair against its own database without evicting a dev
    // server someone is hand-testing against (playwright.config.ts).
    port: Number(process.env.WEB_PORT ?? 5173),
    // Vite otherwise walks to the next free port, which silently breaks both
    // the OAuth callback origin (pinned to 5173) and Playwright's baseURL —
    // failing to bind is the honest outcome.
    strictPort: true,
    // Same-origin in dev: the SPA and API share an origin so auth cookies need
    // no CORS (see docs/architecture.md §Environments; CORS is added only if a
    // real cross-origin consumer appears).
    proxy: {
      "/api": `http://localhost:${process.env.API_PORT ?? 3000}`,
    },
  },
});
