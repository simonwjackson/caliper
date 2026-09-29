#!/usr/bin/env -S nix develop --command node
// Screenshot one element at 4x, to check a detail.
//   docs/design/mockups/zoom.mjs takes ".chain-head" out.png
import { chromium } from "playwright-core";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
const here = dirname(fileURLToPath(import.meta.url));
const [state, selector, out] = process.argv.slice(2);
const server = createServer(async (req, res) => {
  try { res.end(await readFile(join(here, decodeURIComponent(new URL(req.url, "http://x").pathname)))); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 4, colorScheme: "dark" });
const p = await ctx.newPage();
await p.goto(`http://127.0.0.1:${server.address().port}/b-darkroom.html?state=${state}`, { waitUntil: "networkidle" });
await p.evaluate(() => document.fonts.ready);
await p.locator(selector).first().screenshot({ path: out });
console.log(out);
await browser.close(); server.close();
