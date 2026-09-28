#!/usr/bin/env -S nix develop --command node
// Serve the mockups on every interface (IPv6 and IPv4) with no host check,
// so a phone on the tailnet can open them.
//   docs/design/mockups/serve.mjs [port]     default 5312
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? 5312);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".png": "image/png", ".otf": "font/otf", ".ttf": "font/ttf", ".woff2": "font/woff2", ".mjs": "text/javascript", ".md": "text/plain; charset=utf-8" };

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  const file = join(here, normalize(path));
  if (!file.startsWith(here)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }); res.end(`not found: ${path}`);
  }
}).listen(port, "::", () => console.log(`mockups on http://[::]:${port}/ (all hosts)`));
