#!/usr/bin/env -S nix develop --command node
// @ts-check
/**
 * Check in a real browser that a page shows the last of several fast saves to
 * one CSS file. Vite's watcher drops a save within 50 ms of the last one;
 * Caliper sends the dropped change (src/late-changes.js).
 *
 *   ./scripts/verify-fast-saves.mjs              with Caliper: must be green
 *   PLAIN=1 ./scripts/verify-fast-saves.mjs      plain Vite: shows the bug (red)
 *
 * Each trial writes STEPS saves STEP_MS apart, waits SETTLE_MS, and reads the
 * page, then reads it again after a full reload. ATOMIC=1 saves by writing a
 * temporary file and renaming it, as many editors do. Exits 1 when any trial
 * shows an older save.
 */
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "vite"
import { chromium } from "playwright-core"
import { caliper } from "../src/plugin.js"

const RUNS = Number(process.env.RUNS ?? 10)
const STEPS = Number(process.env.STEPS ?? 2)
const STEP_MS = Number(process.env.STEP_MS ?? 20)
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 500)
const sleep = (/** @type {number} */ ms) => new Promise(resolve => setTimeout(resolve, ms))

const root = mkdtempSync(join(tmpdir(), "caliper-fast-saves-"))
const css = join(root, "a.css")
const body = (/** @type {number} */ n) => `.box {\n  --step: ${n};\n}\n`
/** @param {number} n */
function save(n) {
  if (!process.env.ATOMIC) return writeFileSync(css, body(n))
  writeFileSync(`${css}.tmp`, body(n))
  renameSync(`${css}.tmp`, css)
}
writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fast-saves", type: "module" }))
writeFileSync(join(root, "index.html"), '<!doctype html><div class="box"></div><script type="module">import "./a.css"</script>')
save(0)

const server = await createServer({
  root,
  configFile: false,
  logLevel: "silent",
  plugins: process.env.PLAIN ? [] : [caliper()],
  server: { host: "127.0.0.1", port: 0 },
})
await server.listen()
const url = server.resolvedUrls?.local[0] ?? ""
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox"] })
const page = await browser.newPage()
const shown = async () => Number(await page.evaluate(() => {
  const box = document.querySelector(".box")
  return box ? getComputedStyle(box).getPropertyValue("--step").trim() : ""
}))

let red = 0
try {
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector(".box") && getComputedStyle(document.querySelector(".box") ?? document.body).getPropertyValue("--step").trim() === "0")
  for (let run = 0; run < RUNS; run++) {
    const want = (run + 1) * STEPS
    for (let n = want - STEPS + 1; n <= want; n++) {
      const next = Date.now() + STEP_MS
      save(n)
      await sleep(Math.max(0, next - Date.now()))
    }
    await sleep(SETTLE_MS)
    const live = await shown()
    await page.reload()
    await page.waitForFunction(() => document.querySelector(".box") && getComputedStyle(document.querySelector(".box") ?? document.body).getPropertyValue("--step").trim() !== "")
    const reloaded = await shown()
    const ok = live === want && reloaded === want
    if (!ok) red++
    console.log(JSON.stringify({ run: run + 1, want, live, reloaded, ok }))
  }
} finally {
  await browser.close()
  await server.close()
  rmSync(root, { recursive: true, force: true })
}
const setup = `${process.env.PLAIN ? "plain Vite" : "Caliper"}, ${process.env.ATOMIC ? "rename" : "write"} saves, ${STEPS} saves ${STEP_MS} ms apart`
console.log(red ? `RED: ${red} of ${RUNS} trials showed an older save (${setup})` : `GREEN: ${RUNS} of ${RUNS} trials showed the last save (${setup})`)
process.exit(red ? 1 : 0)
