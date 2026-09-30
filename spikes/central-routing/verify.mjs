#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 --command node
// @ts-check
// Spike only. Check the central routing design in Chromium: several tabs on
// different projects, one tab with two projects, HMR, workers, lazy imports,
// a stopped service worker, frame and hard reloads, and a project that comes
// back on a new port. It reports every check and does not stop at the first failure.
import { readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { chromium } from "playwright-core"
import { readRegistry } from "./central.mjs"
import { counterSource, startProject, startStack, waitForProject } from "./stack.mjs"

const { values } = parseArgs({ options: { port: { type: "string", default: "3141" }, via: { type: "string" }, headed: { type: "boolean" } } })
if (!process.env.CHROMIUM) throw new Error("Set CHROMIUM.")
const stack = await startStack({ port: Number(values.port) })
const base = values.via ?? stack.central.url
const baseHost = new URL(base).host
const { pico, react18 } = stack.ids
const PICO_PART = "src/ui/atoms/PicoButton.atom.part.tsx"
const COUNTER = "src/Counter.part.tsx"
const picoFrame = `${pico}~${PICO_PART}~default`
const olderFrame = `${react18}~${COUNTER}~default`
const page = (/** @type {string} */ query) => new URL(`/__caliper/?${query}`, base).href
console.log(`central ${stack.central.url}, browser uses ${base}, work ${stack.work}`)

/** @type {{ name: string, ok: boolean, detail: unknown }[]} */
const results = []
/** @param {string} name @param {() => Promise<unknown>} run */
async function check(name, run) {
  const started = Date.now()
  try {
    const detail = await run()
    results.push({ name, ok: true, detail: { ms: Date.now() - started, ...(typeof detail === "object" ? detail : { detail }) } })
    console.log(`PASS ${name}`)
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) })
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : error}`)
  }
}
const assert = (/** @type {unknown} */ ok, /** @type {string} */ message) => { if (!ok) throw new Error(message) }

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, headless: !values.headed, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
const context = await browser.newContext({ viewport: { width: 1300, height: 900 } })
// Count React renderers per document. Two copies of React in one frame inject twice.
await context.addInitScript(() => {
  const renderers = new Map()
  Object.assign(window, { __REACT_DEVTOOLS_GLOBAL_HOOK__: {
    supportsFiber: true, renderers,
    inject(/** @type {any} */ renderer) { const id = renderers.size + 1; renderers.set(id, renderer); return id },
    onCommitFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
  } })
})
/** @type {string[]} */
const sockets = []
/** @type {string[]} */
const problems = []
/** @type {string[]} */
const connected = []

/** @param {string} query */
async function open(query) {
  const tab = await context.newPage()
  tab.on("websocket", socket => sockets.push(socket.url()))
  tab.on("pageerror", error => problems.push(`pageerror ${error.message}`))
  tab.on("console", message => {
    if (message.text().includes("[vite] connected")) connected.push(message.location().url)
    if (message.type() === "error") problems.push(`console ${message.text()} ${message.location().url}`)
  })
  tab.on("response", response => { if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`) })
  await tab.goto(page(query))
  await tab.locator("html[data-spike=ready]").waitFor({ timeout: 30_000 })
  return tab
}
/** @param {import("playwright-core").Page} tab @param {string} id */
const framesOf = (tab, id) => tab.frames().filter(frame => frame.url().includes(`/__caliper/p/${id}/`))
/** @param {import("playwright-core").Frame} frame @param {number} [timeout] */
const rendered = (frame, timeout = 60_000) => frame.locator("html[data-caliper-state=Rendered]").waitFor({ state: "attached", timeout })
/** @param {import("playwright-core").Frame} frame */
const renderers = frame => frame.evaluate(() => [.../** @type {any} */ (window).__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.values()].map(renderer => renderer.version))
/** @param {import("playwright-core").Page} tab @param {string} id @param {number} count */
async function waitFrames(tab, id, count) {
  const end = Date.now() + 30_000
  while (framesOf(tab, id).length < count && Date.now() < end) await tab.waitForTimeout(100)
  return framesOf(tab, id)
}

/** @type {Record<string, import("playwright-core").Page>} */
const tabs = {}
await check("three tabs load: Pico, React 18, and both in one tab", async () => {
  const started = Date.now()
  tabs.pico = await open(`frames=${picoFrame}`)
  tabs.older = await open(`frames=${olderFrame}`)
  tabs.both = await open(`frames=${picoFrame}|${olderFrame}`)
  const frames = [...await waitFrames(tabs.pico, pico, 1), ...await waitFrames(tabs.older, react18, 1), ...await waitFrames(tabs.both, pico, 1), ...await waitFrames(tabs.both, react18, 1)]
  assert(frames.length === 4, `expected 4 frames, found ${frames.length}`)
  await Promise.all(frames.map(frame => rendered(frame)))
  const controlled = await Promise.all(Object.values(tabs).map(tab => tab.evaluate(() => !!navigator.serviceWorker.controller)))
  return { allRenderedMs: Date.now() - started, topControlled: controlled }
})

await check("each frame loads exactly one React, of its own project", async () => {
  const seen = {}
  for (const [name, tab] of Object.entries(tabs)) {
    for (const frame of framesOf(tab, pico)) { const versions = await renderers(frame); seen[`${name}/pico`] = versions; assert(versions.length === 1 && versions[0]?.startsWith("19."), `${name} Pico frame renderers ${versions}`) }
    for (const frame of framesOf(tab, react18)) { const versions = await renderers(frame); seen[`${name}/react18`] = versions; assert(versions.length === 1 && versions[0] === "18.3.1", `${name} React 18 frame renderers ${versions}`) }
  }
  return seen
})

await check("every HMR socket goes to the central app with its project id", async () => {
  const hmr = sockets.filter(url => url.includes("/__caliper/hmr/"))
  assert(hmr.length >= 4, `expected at least 4 HMR sockets, saw ${sockets.join(", ")}`)
  for (const url of sockets) {
    const parsed = new URL(url)
    assert(parsed.host === baseHost, `socket went to ${parsed.host}, not ${baseHost}: ${url}`)
  }
  assert(hmr.filter(url => url.includes(pico)).length >= 2 && hmr.filter(url => url.includes(react18)).length >= 2, "each project needs two sockets")
  assert(connected.length >= 4, `expected 4 "[vite] connected" messages, saw ${connected.length}`)
  return { sockets: hmr.map(url => new URL(url).pathname) }
})

await check("a module worker and its import route to the React 18 project", async () => {
  for (const tab of [tabs.older, tabs.both]) {
    const frame = /** @type {import("playwright-core").Frame} */ (framesOf(tab, react18)[0])
    await frame.locator("[data-worker]").getByText("worker says PING").waitFor({ timeout: 20_000 })
  }
})

await check("a lazy import routes to the right project", async () => {
  for (const tab of [tabs.older, tabs.both]) {
    const frame = /** @type {import("playwright-core").Frame} */ (framesOf(tab, react18)[0])
    await frame.getByRole("button", { name: "Load lazy" }).click()
    await frame.locator("[data-lazy]").getByText("lazy loaded").waitFor({ timeout: 20_000 })
  }
})

/** Mark every frame, so a full reload shows as a missing mark. */
const markAll = () => Promise.all(Object.values(tabs).flatMap(tab => tab.frames().filter(frame => frame.url().includes("/__caliper/p/")).map(frame => frame.evaluate(() => Object.assign(window, { __spikeMark: 1 })))))
/** @param {import("playwright-core").Frame} frame */
const marked = frame => frame.evaluate(() => /** @type {any} */ (window).__spikeMark === 1)

await check("a React 18 edit updates both React 18 frames and no Pico frame", async () => {
  await markAll()
  writeFileSync(join(stack.roots.react18, COUNTER), counterSource("HMR source"))
  const updated = []
  for (const tab of [tabs.older, tabs.both]) {
    const frame = /** @type {import("playwright-core").Frame} */ (framesOf(tab, react18)[0])
    await frame.getByRole("heading", { name: "HMR source" }).waitFor({ timeout: 20_000 })
    updated.push({ keptMark: await marked(frame) })
  }
  const picoMarks = await Promise.all([...framesOf(tabs.pico, pico), ...framesOf(tabs.both, pico)].map(marked))
  assert(picoMarks.every(Boolean), "a Pico frame reloaded after a React 18 edit")
  return { react18Frames: updated, picoFramesUntouched: picoMarks }
})

await check("a Pico edit updates both Pico frames", async () => {
  await markAll()
  const file = join(stack.roots.pico, PICO_PART)
  writeFileSync(file, readFileSync(file, "utf8").replace('label="TRY AGAIN"', 'label="TRY HMR"'))
  const updated = []
  for (const tab of [tabs.pico, tabs.both]) {
    const frame = /** @type {import("playwright-core").Frame} */ (framesOf(tab, pico)[0])
    await frame.getByText("TRY HMR").waitFor({ timeout: 20_000 })
    updated.push({ keptMark: await marked(frame) })
  }
  return { picoFrames: updated }
})

await check("a Pico CSS edit is a hot update, with no frame reload", async () => {
  await markAll()
  const file = join(stack.roots.pico, "src/ui/atoms/PicoButton.css")
  writeFileSync(file, `${readFileSync(file, "utf8")}\nhtml { --spike-hmr: 1; }\n`)
  const kept = []
  for (const tab of [tabs.pico, tabs.both]) {
    const frame = /** @type {import("playwright-core").Frame} */ (framesOf(tab, pico)[0])
    await frame.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--spike-hmr").trim() === "1", undefined, { timeout: 20_000 })
    kept.push(await marked(frame))
  }
  assert(kept.every(Boolean), "a Pico frame reloaded for a CSS edit")
  return { keptMark: kept }
})

await check("routing survives a stopped service worker", async () => {
  const session = await context.newCDPSession(tabs.both)
  await session.send("ServiceWorker.enable")
  await session.send("ServiceWorker.stopAllWorkers")
  await tabs.both.waitForTimeout(500)
  const frame = /** @type {import("playwright-core").Frame} */ (framesOf(tabs.both, react18)[0])
  const answer = await frame.evaluate(async () => {
    const response = await fetch(`/src/lazy.ts?after-stop=${Date.now()}`)
    const module = await import(/* @vite-ignore */ `/src/lazy.ts?import-after-stop=${Date.now()}`)
    return { status: response.status, lazy: module.lazyText }
  })
  assert(answer.status === 200 && answer.lazy === "lazy loaded", JSON.stringify(answer))
  // A running worker's URL has no project in it. Its import must still route after the stop.
  const inWorker = await frame.evaluate(() => new Promise(done => {
    const echo = /** @type {any} */ (window).__echo
    echo.onmessage = (/** @type {MessageEvent} */ event) => done(String(event.data))
    echo.postMessage("import")
    setTimeout(() => done("no answer"), 10_000)
  }))
  assert(inWorker === "lazy loaded in worker", `worker import after the stop: ${inWorker}`)
  return { ...answer, inWorker }
})

await check("a frame reload keeps its project", async () => {
  const frame = /** @type {import("playwright-core").Frame} */ (framesOf(tabs.both, pico)[0])
  await frame.evaluate(() => location.reload())
  await tabs.both.waitForTimeout(300)
  const again = /** @type {import("playwright-core").Frame} */ ((await waitFrames(tabs.both, pico, 1))[0])
  await rendered(again)
  assert(!(await marked(again)), "the frame did not reload")
})

const missesBefore = stack.central.misses.length
await check("hard reload without recovery (observation)", async () => {
  const tab = await open(`norecover&frames=${olderFrame}`)
  await rendered(/** @type {import("playwright-core").Frame} */ ((await waitFrames(tab, react18, 1))[0]))
  const session = await context.newCDPSession(tab)
  await session.send("Page.reload", { ignoreCache: true })
  await tab.locator("html[data-spike=ready]").waitFor({ timeout: 30_000 })
  const topControlled = await tab.evaluate(() => !!navigator.serviceWorker.controller)
  const frame = (await waitFrames(tab, react18, 1))[0]
  let frameRendered = false
  try { if (frame) { await rendered(frame, 15_000); frameRendered = true } } catch { /* observed below */ }
  const frameControlled = frame ? await frame.evaluate(() => !!navigator.serviceWorker.controller).catch(() => null) : null
  await tab.close()
  return { topControlled, frameControlled, frameRendered, missesDuringReload: stack.central.misses.slice(missesBefore) }
})

await check("hard reload with recovery renders the frame", async () => {
  const tab = await open(`frames=${olderFrame}`)
  await rendered(/** @type {import("playwright-core").Frame} */ ((await waitFrames(tab, react18, 1))[0]))
  const session = await context.newCDPSession(tab)
  await session.send("Page.reload", { ignoreCache: true })
  await tab.locator("html[data-spike=ready]").waitFor({ timeout: 30_000 })
  const frame = /** @type {import("playwright-core").Frame} */ ((await waitFrames(tab, react18, 1))[0])
  await rendered(frame)
  const recovered = await tab.evaluate(() => sessionStorage.getItem("spike:recovered"))
  const topControlled = await tab.evaluate(() => !!navigator.serviceWorker.controller)
  await tab.close()
  return { recovered, topControlled }
})

await check("a project that restarts on a new port comes back in its open frames", async () => {
  const before = /** @type {import("./central.mjs").Entry} */ (readRegistry(stack.registry).find(entry => entry.id === react18))
  await markAll()
  const child = stack.children.get("react18")
  child?.kill("SIGTERM")
  await new Promise(done => child?.once("exit", done))
  // Hold the old port, so Vite must pick another one.
  const holder = createServer()
  await new Promise(done => holder.listen(Number(new URL(before.url).port), "127.0.0.1", () => done(undefined)))
  stack.children.set("react18", startProject({ root: stack.roots.react18, registry: stack.registry, log: join(stack.work, "react18.log") }))
  const after = await waitForProject(stack.registry, react18)
  for (const tab of [tabs.older, tabs.both]) {
    const end = Date.now() + 60_000
    let frame
    while (Date.now() < end) {
      frame = framesOf(tab, react18)[0]
      if (frame && !(await marked(frame).catch(() => true)) && await frame.locator("html[data-caliper-state=Rendered]").count().catch(() => 0)) break
      await tab.waitForTimeout(250)
    }
    assert(frame && !(await marked(frame)), `the React 18 frame did not reload onto ${after.url}`)
    await frame.getByRole("heading", { name: "HMR source" }).waitFor({ timeout: 10_000 })
  }
  holder.close()
  return { before: before.url, after: after.url }
})

await check("no request reached the central app without a project, outside the no-recovery observation", async () => {
  const unexpected = stack.central.misses.filter((_, index) => index < missesBefore)
  assert(unexpected.length === 0, `misses: ${unexpected.join(", ")}`)
})

await check("no browser errors", async () => {
  // The project restart closes sockets on purpose. Vite logs that as a console error.
  const real = problems.filter(line => !/WebSocket connection .* failed|server connection lost|Failed to load resource: .* 502/.test(line))
  assert(real.length === 0, real.slice(0, 12).join("\n"))
  return { ignored: problems.length - real.length }
})

await browser.close()
await stack.stop()
const report = join(stack.work, "report.json")
writeFileSync(report, JSON.stringify({ base, results }, null, 2))
console.log(JSON.stringify(results, null, 2))
console.log(`\n${results.filter(result => result.ok).length} of ${results.length} checks passed. Report: ${report}`)
process.exit(0)
