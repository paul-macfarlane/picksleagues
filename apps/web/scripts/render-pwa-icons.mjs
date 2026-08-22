// Regenerates the PWA icon PNGs in ../public from the brand mark's geometry
// (src/components/brand.tsx, public/favicon.svg). Run from the repo root:
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

const any = { bg: DARK_BG, ball: BRAND, check: "#ffffff", scale: 0.62 };
// Launchers crop maskable icons to a circle or squircle; the W3C safe zone is
// the central 80%, so the mark stays well inside it.
const maskable = { bg: BRAND, ball: "#ffffff", check: BRAND, scale: 0.58 };
const jobs = [
  ["icon-192.png", 192, any],
  ["icon-512.png", 512, any],
  ["icon-maskable-512.png", 512, maskable],
];

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
await browser.close();
