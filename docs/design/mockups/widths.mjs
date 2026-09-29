#!/usr/bin/env -S nix develop --command node
// Print the box of every element under a selector whose width exceeds its parent's, to find overflow.
//   docs/design/mockups/widths.mjs log ".p-take"
import { chromium } from "playwright-core";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
const here = dirname(fileURLToPath(import.meta.url));
const [state, selector, w = "1600", hgt = "1000"] = process.argv.slice(2);
const server = createServer(async (req, res) => {
  try { res.end(await readFile(join(here, decodeURIComponent(new URL(req.url, "http://x").pathname)))); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const p = await browser.newPage({ viewport: { width: +w, height: +hgt } });
await p.goto(`http://127.0.0.1:${server.address().port}/b-darkroom.html?state=${state}`, { waitUntil: "networkidle" });
const out = await p.evaluate((sel) => {
  const root = document.querySelector(sel);
  const rows = [];
  const walk = (el, depth) => {
    const r = el.getBoundingClientRect();
    const pr = el.parentElement.getBoundingClientRect();
    const tag = el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ").join(".") : "");
    rows.push(`${"  ".repeat(depth)}${tag} w=${Math.round(r.width)} right=${Math.round(r.right)}${r.right > pr.right + 1 ? "  OVER parent by " + Math.round(r.right - pr.right) : ""}`);
    if (depth < 4) for (const c of el.children) walk(c, depth + 1);
  };
  walk(root, 0);
  return rows.join("\n");
}, selector);
console.log(out);
await browser.close(); server.close();
