// @ts-check
/** Build the Darkroom gallery with Bun and serve it on a local port. Shared by the UI scripts. */
import { execFileSync } from "node:child_process"
import { createServer } from "node:http"
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { extname, join, normalize } from "node:path"

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf", ".png": "image/png", ".map": "application/json" }
const PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
  + '<title>Darkroom gallery</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/gallery.css">'
  + "<style>html,body,#root{height:100%;margin:0}body{background:#121316}@media (prefers-color-scheme:light){body{background:#DDDEE2}}</style>"
  + '</head><body><div id="root"></div><script type="module" src="/gallery.js"></script></body></html>'

/** @returns {Promise<{ origin: string, close: () => Promise<void> }>} */
export async function serveGallery() {
  const dir = mkdtempSync(join(tmpdir(), "caliper-darkroom-"))
  execFileSync("bun", ["build", "scripts/ui/gallery.tsx", "--outdir", dir, "--target", "browser", "--asset-naming", "[name].[ext]"], { stdio: ["ignore", "ignore", "inherit"] })
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost")
    if (url.pathname === "/" || url.pathname === "/index.html") { response.setHeader("content-type", "text/html"); response.end(PAGE); return }
    const file = normalize(join(dir, url.pathname))
    if (!file.startsWith(dir) || !existsSync(file)) { response.statusCode = 404; response.end("not found"); return }
    response.setHeader("content-type", TYPES[/** @type {keyof typeof TYPES} */ (extname(file))] ?? "application/octet-stream")
    response.end(readFileSync(file))
  })
  await new Promise(resolve => server.listen(Number(process.env.PORT ?? 0), "127.0.0.1", () => resolve(undefined)))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("No address")
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise(resolve => server.close(() => { rmSync(dir, { recursive: true, force: true }); resolve(undefined) })),
  }
}

/** The three mockup sizes, with the mockup's device scale factors. */
export const SIZES = [
  { name: "desk", width: 1600, height: 1000, scale: 1 },
  { name: "fold", width: 1000, height: 680, scale: 2 },
  { name: "phone", width: 416, height: 640, scale: 3 },
]
