#!/usr/bin/env -S nix develop -c node
// @ts-check
/**
 * Build the workspaces mockup with Bun, then either render it or serve it.
 * Run from the caliper checkout root, so `nix develop` provides CHROMIUM.
 *
 *   docs/design/mockups/workspaces/shoot.mjs              # render out/*.png and index.html
 *   docs/design/mockups/workspaces/shoot.mjs serve [port] # serve on every interface (default 5313)
 *
 * Rendering also checks, at every size, that the page does not scroll and
 * that every column and every row of the board is on screen or one picker
 * press away. A failed check exits 1.
 */
import { execFileSync } from "node:child_process"
import { createServer } from "node:http"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, "out")
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf", ".png": "image/png" }
const PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<title>Workspaces mockup</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/mockup.css">'
  + "<style>body{background:#121316}@media (prefers-color-scheme:light){body{background:#DDDEE2}}</style>"
  + '</head><body><div id="root"></div><script type="module" src="/mockup.js"></script></body></html>'

const dir = mkdtempSync(join(tmpdir(), "caliper-workspaces-"))
execFileSync("bun", ["build", join(here, "mockup.tsx"), "--outdir", dir, "--target", "browser", "--asset-naming", "[name]-[hash].[ext]"], { stdio: ["ignore", "ignore", "inherit"] })
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost")
  if (url.pathname === "/" || url.pathname === "/index.html") { response.setHeader("content-type", "text/html"); response.end(PAGE); return }
  const file = normalize(join(dir, url.pathname))
  if (!file.startsWith(dir) || !existsSync(file)) { response.statusCode = 404; response.end("not found"); return }
  response.setHeader("content-type", TYPES[/** @type {keyof typeof TYPES} */ (extname(file))] ?? "application/octet-stream")
  response.end(readFileSync(file))
})

if (process.argv[2] === "serve") {
  const port = Number(process.argv[3] ?? 5313)
  server.listen(port, "::", () => console.log(`workspaces mockup on http://[::]:${port}/?state=board (states: new frame planning running board answer discard)`))
} else {
  await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(undefined)))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("No address")
  const origin = `http://127.0.0.1:${address.port}`
  const { chromium } = await import("playwright-core")
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM })

  const SIZES = { desk: [1600, 1000, 1], fold: [1000, 680, 2], phone: [416, 640, 3] }
  const LADDER = { generous: [1920, 1200, 1], medium: [960, 1000, 1], "narrow-tall": [390, 900, 2], "wide-short": [1280, 300, 1], tiny: [240, 180, 3] }
  const STATES = ["new", "frame", "planning", "running", "board", "answer", "discard"]
  /** @type {{ name: string, query: string, size: number[], caption: string }[]} */
  const shots = []
  for (const state of STATES) for (const [size, dims] of Object.entries(SIZES)) shots.push({ name: `${state}-${size}-dark`, query: `state=${state}&scheme=dark`, size: dims, caption: `${state}, ${size}, dark` })
  for (const [size, dims] of Object.entries(SIZES)) shots.push({ name: `board-${size}-light`, query: "state=board&scheme=light", size: dims, caption: `board, ${size}, light` })
  shots.push({ name: "board-fold-dark-closed", query: "state=board&scheme=dark&side=closed", size: SIZES.fold, caption: "board, fold, questions closed" })
  shots.push({ name: "frame-phone-dark-drawer", query: "state=frame&scheme=dark&drawer=open", size: SIZES.phone, caption: "frame, phone, parts drawer open to pin" })
  for (const [size, dims] of Object.entries(LADDER)) shots.push({ name: `ladder-${size}`, query: "state=board&scheme=dark&side=closed", size: dims, caption: `board at ${size} (${dims[0]} × ${dims[1]}), questions closed` })

  mkdirSync(out, { recursive: true })
  /** @type {string[]} */
  const failures = []
  for (const shot of shots) {
    const [width, height, scale] = shot.size
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale })
    const page = await context.newPage()
    page.on("pageerror", error => failures.push(`${shot.name}: ${error.message}`))
    await page.goto(`${origin}/?${shot.query}`)
    await page.waitForSelector(".ws-board")
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(120)
    const check = await page.evaluate(() => {
      const board = document.querySelector(".ws-board")
      const scrolls = document.scrollingElement ? document.scrollingElement.scrollHeight > innerHeight + 1 : false
      if (!board || !document.querySelector(".ws-grid")) return { scrolls, columns: -1, rows: -1, plan: "" }
      const columnsShape = board.getAttribute("data-columns")
      const rowsShape = board.getAttribute("data-rows")
      const heads = document.querySelectorAll(".ws-heads .ws-head").length
      const columnPicker = document.querySelectorAll(".ws-colpick .ws-picker__item").length
      const columns = columnsShape === "All" ? heads : columnsShape === "Pair" ? 1 + columnPicker : columnPicker
      const rows = rowsShape === "Stack" ? document.querySelectorAll(".ws-row").length : document.querySelectorAll(".ws-rowpick .ws-picker__item").length
      return { scrolls, columns, rows, plan: `${columnsShape}/${rowsShape}` }
    })
    const expected = /state=(new)\b/.test(shot.query) ? { columns: -1, rows: -1 } : /state=(frame)\b/.test(shot.query) ? { columns: 1, rows: 3 } : { columns: 4, rows: 3 }
    if (check.scrolls) failures.push(`${shot.name}: the page scrolls`)
    if (check.columns !== expected.columns || check.rows !== expected.rows) failures.push(`${shot.name}: reachable ${check.columns} columns and ${check.rows} rows, expected ${expected.columns} and ${expected.rows} (${check.plan})`)
    await page.screenshot({ path: join(out, `${shot.name}.png`) })
    console.log(`${shot.name}.png ${check.plan}`)
    await context.close()
  }
  await browser.close()
  server.close()
  rmSync(dir, { recursive: true, force: true })

  const figures = shots.map(shot => `<figure><a href="out/${shot.name}.png"><img src="out/${shot.name}.png" alt="${shot.caption}" loading="lazy"></a><figcaption>${shot.caption}</figcaption></figure>`).join("\n")
  writeFileSync(join(here, "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Workspaces, slice 1</title><link rel="icon" href="data:,">
<style>body{margin:0;padding:1.5rem;background:#121316;color:#ECECEE;font:14px/1.5 system-ui,sans-serif}h1{font-size:18px;margin:0 0 .3rem}p{color:#A3A6AE;margin:0 0 1.2rem;max-width:60rem}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,28rem),1fr));gap:1.4rem}figure{margin:0}img{width:100%;height:auto;display:block;border:1px solid #303237;border-radius:6px}figcaption{color:#A3A6AE;font-size:12px;margin-top:.35rem}</style></head>
<body><h1>Workspaces, slice 1</h1><p>Generated by shoot.mjs. Every Pico screen is a real render. See README.md for what is real and what is staged.</p><main>
${figures}
</main></body></html>
`)
  if (failures.length) { console.error(`\n${failures.length} check(s) failed:\n${failures.join("\n")}`); process.exit(1) }
  console.log(`\n${shots.length} images; every size passed the scroll and reachability checks.`)
}
