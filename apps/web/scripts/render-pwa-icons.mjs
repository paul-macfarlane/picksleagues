// Regenerates the PWA icon PNGs and the social-preview card (og.png) in
// ../public from the brand mark's geometry (src/components/brand.tsx,
// public/favicon.svg). Run from the repo root:
//   node apps/web/scripts/render-pwa-icons.mjs
// Committed outputs, not a build step: the mark changes rarely and a build
// that needs a browser to produce a favicon is a build that fails on a host
// without one.
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const BALL = "M0.5 16 C5 5 27 5 31.5 16 C27 27 5 27 0.5 16 Z";
const CHECK = "M10 16.5 L14.3 20.8 L22.5 11.5";
const BRAND = "#d2622a";
const DARK_BG = "#0e0b0a";

// `scale` is the share of the tile the 32-unit mark occupies.
function tile({ bg, ball, check, size, scale }) {
  const m = size * scale;
  const off = (size - m) / 2;
  return `<body style="margin:0;background:${bg}"><svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${bg}"/>
  <g transform="translate(${off} ${off}) scale(${m / 32})">
    <path d="${BALL}" transform="rotate(-45 16 16)" fill="${ball}"/>
    <path d="${CHECK}" fill="none" stroke="${check}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
  </g></svg></body>`;
}

// One look everywhere: every tile is the dark ground with the orange ball, the
// same composition as public/apple-touch-icon.png, so the app reads as one
// icon whichever platform installs it. The maskable variant differs only in
// scale — launchers crop it to a circle or squircle, and the W3C safe zone is
// the central 80%, so the mark sits further in.
const tileSpec = { bg: DARK_BG, ball: BRAND, check: "#ffffff" };
const any = { ...tileSpec, scale: 0.62 };
const maskable = { ...tileSpec, scale: 0.56 };
const jobs = [
  ["icon-192.png", 192, any],
  ["icon-512.png", 512, any],
  ["icon-maskable-512.png", 512, maskable],
];

// The tagline is what a shared link previews as, so it names the category
// the way sign-in and the welcome hero do (FB-33) — never a single mode.
const OG = { width: 1200, height: 630 };
const OG_TAGLINE = "Season-long sports leagues with friends";
function ogCard() {
  const m = 120;
  const off = (OG.width - m) / 2;
  return `<body style="margin:0;background:${DARK_BG};font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif">
  <svg xmlns="http://www.w3.org/2000/svg" width="${OG.width}" height="${OG.height}" viewBox="0 0 ${OG.width} ${OG.height}">
    <rect width="${OG.width}" height="${OG.height}" fill="${DARK_BG}"/>
    <g transform="translate(${off} 158) scale(${m / 32})">
      <path d="${BALL}" transform="rotate(-45 16 16)" fill="${BRAND}"/>
      <path d="${CHECK}" fill="none" stroke="#ffffff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <text x="600" y="400" text-anchor="middle" fill="#ffffff" font-size="88" font-weight="700">Picks Leagues</text>
    <text x="600" y="478" text-anchor="middle" fill="#a3a3a3" font-size="34">${OG_TAGLINE}</text>
  </svg></body>`;
}

const browser = await chromium.launch();
for (const [name, size, spec] of jobs) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await page.setContent(tile({ ...spec, size }));
  await page.screenshot({ path: path.join(out, name) });
  await page.close();
}
{
  const page = await browser.newPage({ viewport: OG, deviceScaleFactor: 1 });
  await page.setContent(ogCard());
  await page.screenshot({ path: path.join(out, "og.png") });
  await page.close();
}
await browser.close();
