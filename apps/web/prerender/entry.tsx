/**
 * Prerenders the public routes to real HTML at build time (LNCH-13).
 *
 * Google rejected the app's OAuth branding — "your home page does not explain
 * the purpose of your app" — because every URL served the same empty
 * `<div id="root">`: the reviewer never runs the SPA, so the page genuinely
 * had no content and no privacy-policy link. Each document written here is the
 * built shell with its head tags swapped and the route's markup inside that
 * div, so a crawler reads the page and a member still boots the same SPA from
 * the same hashed assets.
 *
 * Runs under Node with `src/lib/auth.ts` aliased to `auth-stub.ts` — see
 * there for why the real client can't survive the trip.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { renderShellBody, renderShellMeta } from "@picksleagues/html-shell";
import { routeTree } from "../src/routeTree.gen";
import { PRERENDER_ROUTES, SITE_ORIGIN } from "./routes";

// Anchored on the working directory, not this module: the bundle Node runs
// sits in `prerender/dist/`, so a path relative to `import.meta.dirname` is
// resolved from a directory that only exists after the build that writes it.
// `pnpm prerender` runs with `apps/web` as the cwd.
const DIST = path.resolve(process.cwd(), "dist");

/**
 * A floor on the rendered prose, not a style check. Every failure this build
 * step can have — a route that redirects, a `beforeLoad` that throws, an error
 * boundary catching it — still *renders*, and renders something short: the
 * error boundary that caught `/welcome`'s session fetch came to 79 characters.
 * The splash is the shortest real page at ~900, so this sits clear of both.
 */
const MIN_TEXT_LENGTH = 500;

function visibleTextLength(html: string): number {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

const shell = await readFile(path.join(DIST, "index.html"), "utf8");

for (const route of PRERENDER_ROUTES) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [route.path] }),
  });
  await router.load();

  const markup = renderToStaticMarkup(<RouterProvider router={router} />);
  const textLength = visibleTextLength(markup);
  if (textLength < MIN_TEXT_LENGTH) {
    throw new Error(
      `${route.path} prerendered only ${textLength} characters of text — expected at least ` +
        `${MIN_TEXT_LENGTH}. The page almost certainly rendered an error boundary or a redirect ` +
        `rather than its content:\n${markup.slice(0, 400)}`,
    );
  }

  const withMeta = renderShellMeta(shell, {
    title: route.title,
    description: route.description,
    canonical: `${SITE_ORIGIN}${route.path}`,
  });
  if (!withMeta.includes(`<title>${route.title}</title>`)) {
    throw new Error(
      `${route.path}: the shell's <title> was not substituted. The tag spellings in ` +
        `apps/web/index.html and packages/html-shell have diverged.`,
    );
  }

  const document = renderShellBody(withMeta, markup);
  if (!document.includes(markup)) {
    throw new Error(
      `${route.path}: the shell has no empty '<div id="root"></div>' to fill, so the page would ` +
        `ship without its content. apps/web/index.html changed shape.`,
    );
  }

  const outDir = path.join(DIST, route.path);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "index.html"), document);
  console.log(`prerendered ${route.path} (${textLength} chars of text)`);
}

/**
 * The Build Output routes that serve these documents, spliced into
 * `.vercel/output/config.json` by `scripts/build-vercel-output.sh`.
 *
 * Generated rather than hand-listed so a route added to `routes.ts` can't ship
 * prerendered-but-unreachable. Named explicitly rather than left to the
 * filesystem handler's directory-index resolution, which Vercel's Build Output
 * API docs never promise — and if that resolution does happen first, it finds
 * the same file and these rules are simply never reached.
 *
 * A fragment, not a document: it is the middle of an array, and it is written
 * outside `dist/` so it isn't published as a static file.
 */
const routeRules = PRERENDER_ROUTES.map(
  (route) => `    { "src": "^${route.path}/?$", "dest": "${route.path}/index.html" },`,
).join("\n");
await writeFile(
  path.resolve(process.cwd(), "prerender/dist/vercel-routes.fragment"),
  `${routeRules}\n`,
);

/**
 * The sitemap (LNCH-14), from the same list for the same reason: a page that
 * is prerendered but unlisted is one no crawler is told to look for.
 *
 * No `<lastmod>` — it is optional, and the honest value is a per-deploy
 * timestamp that would rewrite this file on every build while telling a
 * crawler nothing about whether the prose actually changed.
 */
const urls = PRERENDER_ROUTES.map(
  (route) => `  <url><loc>${SITE_ORIGIN}${route.path}</loc></url>`,
).join("\n");
await writeFile(
  path.join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
);
console.log(`wrote sitemap.xml (${PRERENDER_ROUTES.length} urls)`);
