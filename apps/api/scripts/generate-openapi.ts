// Emits the committed OpenAPI spec (arch D4) by asking the app for its own
// document — the routes are the source of truth, never a hand-edited file.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createApp } from "../src/app.js";

const outDir = path.resolve(import.meta.dirname, "../../../openapi");
const res = await createApp().request("/api/openapi.json");
if (!res.ok) {
  throw new Error(`Spec generation failed: ${res.status}`);
}
const spec = await res.json();
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "openapi.json"), `${JSON.stringify(spec, null, 2)}\n`);
console.log(`Wrote ${path.join(outDir, "openapi.json")}`);
