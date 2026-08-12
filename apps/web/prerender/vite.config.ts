import path from "node:path";
import { defineConfig, mergeConfig } from "vite";
import baseConfig from "../vite.config";

/**
 * The SSR build behind `pnpm prerender` — the app's own config plus the two
 * things rendering it under Node needs.
 *
 * `outDir` stays inside `apps/web` so Node resolves externalized dependencies
 * from the workspace's `node_modules` when the bundle runs; pointed at the
 * repo root instead, the build succeeds and the run dies on the first import.
 */
const config = mergeConfig(
  baseConfig,
  defineConfig({
    ssr: {
      // Workspace packages export TypeScript source, which Node can't import
      // from node_modules — Vite has to inline them rather than externalize.
      noExternal: [/^@picksleagues\//],
    },
    build: {
      ssr: path.resolve(import.meta.dirname, "./entry.tsx"),
      outDir: path.resolve(import.meta.dirname, "./dist"),
      emptyOutDir: true,
    },
  }),
);

/**
 * Replaced wholesale rather than merged, and in array form, because Vite tries
 * aliases in order and the base config's `@` would match `@/lib/auth` first —
 * merging leaves the stub unreachable and the build fails on the one route
 * whose `beforeLoad` reads a session.
 */
config.resolve = {
  ...config.resolve,
  alias: [
    { find: /^@\/lib\/auth$/, replacement: path.resolve(import.meta.dirname, "./auth-stub.ts") },
    { find: /^@\//, replacement: `${path.resolve(import.meta.dirname, "../src")}/` },
  ],
};

export default config;
