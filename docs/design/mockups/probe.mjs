#!/usr/bin/env -S nix develop --command node
// Print the box of each region at a given size, to debug layout.
//   docs/design/mockups/probe.mjs a-bench 416 640
import { chromium } from "playwright-core";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
const here = dirname(fileURLToPath(import.meta.url));
const [page, w, h] = process.argv.slice(2);
const server = createServer(async (req, res) => {
  try { res.end(await readFile(join(here, decodeURIComponent(new URL(req.url, "http://x").pathname)))); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const p = await browser.newPage({ viewport: { width: +w, height: +h } });
p.on("console", (m) => console.log("console:", m.text()));
await p.goto(`http://127.0.0.1:${server.address().port}/${page}.html`);
const out = await p.evaluate(() => {
  const app = document.querySelector(".app");
  const cs = getComputedStyle(app);
  const boxes = [...app.children].map((c) => {
    const r = c.getBoundingClientRect();
    return `${c.className.split(" ")[0]}: ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} display=${getComputedStyle(c).display}`;
  });
  return [`app ${app.clientWidth}x${app.clientHeight} cols=${cs.gridTemplateColumns} rows=${cs.gridTemplateRows} areas=${cs.gridTemplateAreas}`, ...boxes].join("\n");
});
console.log(out);
await browser.close(); server.close();
