#!/usr/bin/env -S nix develop --command node
// Render every state of the Darkroom mockup at desk and folded-phone size,
// light and dark, to out/b-<state>-<size>-<scheme>.png. Run from the
// caliper checkout root so `nix develop` provides CHROMIUM and
// node_modules/playwright-core.
//
//   docs/design/mockups/render.mjs              # every state
//   docs/design/mockups/render.mjs knobs grid   # some states
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
export const STATES = ["takes", "empty", "knobs", "code", "grid", "compare", "checks", "calibrate", "error", "parts"];
const states = process.argv.slice(2).length ? process.argv.slice(2) : STATES;
const sizes = [
  { name: "desk", width: 1600, height: 1000, scale: 1 },
  { name: "phone", width: 416, height: 640, scale: 3 },
];
const types = { ".html": "text/html", ".css": "text/css", ".png": "image/png", ".ttf": "font/ttf", ".mjs": "text/javascript" };

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  try {
    const body = await readFile(join(here, path === "/" ? "index.html" : path));
    res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
for (const state of states) {
  for (const size of sizes) {
    if (state === "parts" && size.name === "desk") continue; // the drawer exists only on the phone
    for (const scheme of ["dark", "light"]) {
      const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, colorScheme: scheme });
      const p = await ctx.newPage();
      await p.goto(`${base}/b-darkroom.html?state=${state}`, { waitUntil: "networkidle" });
      await p.evaluate(() => document.fonts.ready);
      const file = join(out, `b-${state}-${size.name}-${scheme}.png`);
      await p.screenshot({ path: file });
      console.log(file);
      await ctx.close();
    }
  }
}
await browser.close();
server.close();
