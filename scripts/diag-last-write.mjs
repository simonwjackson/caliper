#!/usr/bin/env -S nix develop --command node
/**
 * Diagnosis loop: after a fast run of writes to one CSS file, does the page
 * show the last write? Plain Vite, no Caliper, unless CALIPER=1.
 * Prints one line per trial and a red/green verdict.
 *
 *   RUNS=10 STEPS=60 STEP_MS=16 ./scripts/diag-last-write.mjs
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "vite"
import { chromium } from "playwright-core"

const RUNS = Number(process.env.RUNS ?? 10)
const STEPS = Number(process.env.STEPS ?? 60)
const STEP_MS = Number(process.env.STEP_MS ?? 16)
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 2000)
const sleep = ms => new Promise(r => setTimeout(r, ms))

const root = mkdtempSync(join(tmpdir(), "diag-last-write-"))
const css = join(root, "a.css")
const body = n => `.box {\n  --step: ${n};\n  width: ${n}px;\n}\n`
writeFileSync(join(root, "index.html"), `<!doctype html><div class="box"></div><script type="module">import "./a.css"</script>`)
writeFileSync(css, body(0))

/** Server-side trace, reset per trial. */
const trace = { changes: [], loads: [], sends: [] }
const stepOf = code => Number(code.match(/--step: (\d+)/)?.[1] ?? -1)
const probe = {
  name: "diag-probe",
  enforce: "pre",
  configureServer(server) {
    server.watcher.on("change", file => { if (file === css) trace.changes.push({ t: Date.now(), disk: stepOf(readFileSync(css, "utf8")) }) })
    const send = server.ws.send.bind(server.ws)
    server.ws.send = (...args) => {
      const payload = args[0]
      if (payload?.type) trace.sends.push({ t: Date.now(), type: payload.type, paths: payload.updates?.map(u => `${u.path}?t=${u.timestamp}`) })
      return send(...args)
    }
  },
  transform(code, id) {
    if (id.split("?")[0] === css) trace.loads.push({ t: Date.now(), id: id.replace(root, ""), step: stepOf(code) })
  },
}
const plugins = [probe]
if (process.env.CALIPER) plugins.push((await import("../src/plugin.js")).caliper())

const server = await createServer({ root, configFile: false, logLevel: "silent", plugins, server: { host: "127.0.0.1", port: 0 } })
await server.listen()
const url = server.resolvedUrls.local[0]
/** The candidate fix: after the last of a run of writes, tell the watcher once more. */
const timers = new Map()
const trailing = file => {
  clearTimeout(timers.get(file))
  timers.set(file, setTimeout(() => { timers.delete(file); server.watcher.emit("change", file) }, Number(process.env.FIX)))
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox"] })
const page = await browser.newPage()
const requests = []
page.on("request", r => { if (r.url().includes("a.css")) requests.push({ t: Date.now(), url: r.url().replace(url, "/") }) })
await page.goto(url)
await page.waitForFunction(() => getComputedStyle(document.querySelector(".box")).getPropertyValue("--step").trim() === "0")

let red = 0
let base = 0
for (let run = 1; run <= RUNS; run++) {
  trace.changes.length = trace.loads.length = trace.sends.length = requests.length = 0
  const t0 = Date.now()
  for (let i = 1; i <= STEPS; i++) {
    const next = Date.now() + STEP_MS
    writeFileSync(css, body(base + i))
    if (process.env.FIX) trailing(css)
    await sleep(Math.max(0, next - Date.now()))
  }
  const tLast = Date.now()
  await sleep(SETTLE_MS)
  const want = base + STEPS
  const shown = Number(await page.evaluate(() => getComputedStyle(document.querySelector(".box")).getPropertyValue("--step").trim()))
  const ok = shown === want
  if (!ok) red++
  if (process.env.RELOAD) {
    // A fresh page load, as the agent's render tool does.
    await page.reload()
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".box")).getPropertyValue("--step").trim() !== "")
    const reloaded = Number(await page.evaluate(() => getComputedStyle(document.querySelector(".box")).getPropertyValue("--step").trim()))
    console.log(JSON.stringify({ run, afterReload: reloaded, want, stale: reloaded !== want }))
  }
  const lastChange = trace.changes.at(-1)
  const lastLoad = trace.loads.at(-1)
  console.log(JSON.stringify({
    run, ok, want, shown,
    watcherChanges: trace.changes.length,
    lastChangeSawDisk: lastChange?.disk, lastChangeAfterLastWriteMs: lastChange ? lastChange.t - tLast : null,
    updatesSent: trace.sends.filter(s => s.type === "update").length,
    otherSends: [...new Set(trace.sends.filter(s => s.type !== "update").map(s => s.type))],
    transforms: trace.loads.length, lastTransformStep: lastLoad?.step, lastTransformAfterLastWriteMs: lastLoad ? lastLoad.t - tLast : null,
    browserRequests: requests.length,
    ms: tLast - t0,
  }))
  if (!ok && process.env.VERBOSE) console.log(JSON.stringify({ tail: { changes: trace.changes.slice(-4).map(c => ({ ...c, t: c.t - tLast })), loads: trace.loads.slice(-4).map(c => ({ ...c, t: c.t - tLast })), sends: trace.sends.slice(-4).map(c => ({ ...c, t: c.t - tLast })), requests: requests.slice(-4).map(c => ({ ...c, t: c.t - tLast })) } }, null, 1))
  base = want
}
console.log(red ? `RED: ${red} of ${RUNS} runs did not show the last write` : `GREEN: ${RUNS} of ${RUNS} runs showed the last write`)
await browser.close()
await server.close()
rmSync(root, { recursive: true, force: true })
process.exit(red ? 1 : 0)
