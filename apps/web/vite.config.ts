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
    // Same-origin in dev: the SPA and API share :5173 so auth cookies need no CORS
    // (see docs/architecture.md §Environments; CORS is added only if a real
    // cross-origin consumer appears).
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
