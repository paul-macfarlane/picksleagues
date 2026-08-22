// The SPA's tsconfig is browser-typed on purpose; this test alone reads the
// filesystem, so it borrows Node's types here rather than widening the app.
/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A broken manifest fails silently: the app still loads, the browser just
 * never offers "Add to Home Screen". So this pins the three things that
 * take installability away without any other symptom — the JSON itself, the
 * icon files it names, and a start URL the manifest's scope can't reach.
 */

const PUBLIC = path.resolve(import.meta.dirname, "../public");
const manifest = JSON.parse(readFileSync(path.join(PUBLIC, "manifest.webmanifest"), "utf8")) as {
  start_url: string;
  scope: string;
  display: string;
  icons: { src: string; sizes: string; purpose?: string }[];
};

// PNG dimensions live in the IHDR chunk: width at byte 16, height at byte 20.
function pngSize(file: string) {
  const buf = readFileSync(file);
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
}

describe("web app manifest", () => {
  it("is linked from the shell every page boots from", () => {
    const shell = readFileSync(path.resolve(import.meta.dirname, "../index.html"), "utf8");
    expect(shell).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
  });

  it("opens standalone at a URL inside its scope", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
  });

  it.each(manifest.icons)("ships $src at its declared $sizes", ({ src, sizes }) => {
    expect(pngSize(path.join(PUBLIC, src))).toBe(sizes);
  });

  it("covers both installability minimums: a 192 and a 512 'any' icon, plus a maskable one", () => {
    const any = manifest.icons.filter((i) => (i.purpose ?? "any") === "any").map((i) => i.sizes);
    expect(any).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
  });
});
