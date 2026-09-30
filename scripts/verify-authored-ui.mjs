#!/usr/bin/env -S nix develop -c node
// Real Checks window -> Vite API -> React frames -> authored Chromium execution.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { EventEmitter, once } from "node:events"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { createServer } from "vite"
import { chromium } from "playwright-core"
import { caliper } from "../src/plugin.js"
import { cal, deferLayout, reveal } from "./verify-helpers.mjs"

const { values } = parseArgs({ options: { reference: { type: "boolean", default: true }, layout: { type: "boolean", default: false }, modules: { type: "string" }, out: { type: "string", default: "/tmp/caliper-authored-ui" } } })
// The served Run 1 renderer is unstyled. Opt in to production geometry gates
// with --layout only after the real UI is integrated; deferrals are not passes.
const reference = values.reference && !values.layout
assert(values.modules && process.env.CHROMIUM, "Pass --modules <React consumer node_modules> and set CHROMIUM")
const root = mkdtempSync(join(tmpdir(), "caliper-authored-ui-consumer-"))
const out = resolve(values.out)
mkdirSync(out, { recursive: true })
mkdirSync(join(root, "src"))
symlinkSync(resolve(values.modules), join(root, "node_modules"), "dir")
writeFileSync(join(root, "package.json"), JSON.stringify({ name: "authored-ui-consumer", type: "module", exports: { ".": "./src/index.ts" } }))
writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }))
writeFileSync(join(root, "src/index.ts"), 'import "./global.css"')
writeFileSync(join(root, "src/global.css"), "body { margin: 0; padding: 24px; background: white; color: black; font: 18px sans-serif; } button { padding: 12px; font: inherit; color: black; background: white; }")
const helper = join(root, "src/check-helper.ts")
writeFileSync(helper, 'export const revision = "before"\n')
const part = "src/Retry.atom.part.tsx"
writeFileSync(join(root, part), `import { useState } from 'react'
export const name = 'Retry scenario'
export default function Retry() { const [ready, setReady] = useState(false); return <main><h1>Local library</h1><button onClick={() => setReady(true)}>{ready ? 'Library loaded' : 'Retry'}</button></main> }
export function Hang() { return <main><h1>Waiting scenario</h1><button>Waiting</button></main> }
export const checks = {
 default: {
  'retry loads the library': async ({ canvas, input, expect, waitFor }) => {
    await input.click(canvas.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Library loaded' })).toBeVisible())
  },
  'deliberate assertion failure': ({ canvas, expect }) => { expect(canvas.getByRole('button')).toHaveTextContent('Wrong label') }
 },
 Hang: {
  'completed before the interruption': ({ canvas, expect }) => { expect(canvas.getByRole('button', { name: 'Waiting' })).toBeVisible() },
  'hanging callback': async () => {
    const helper = await import('./check-helper')
    await fetch('/authored-ui-start?revision=' + helper.revision)
    await new Promise(() => {})
  }
 }
}
`)
const witnesses = new EventEmitter()
const server = await createServer({ root, configFile: false, logLevel: "silent", cacheDir: join(root, ".vite"), plugins: [
  caliper({ wrap: false }),
  { name: "authored-ui-witness", configureServer(server) {
    // Register before Vite's internal fallback routes, not after createServer.
    server.middlewares.use((request, response, next) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      if (url.pathname !== "/authored-ui-start") return next()
      response.end("started")
      witnesses.emit("started", url.searchParams.get("revision"))
    })
  } },
], server: { host: "127.0.0.1", port: 0 } })
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
/** @type {string[]} */
const errors = []
page.on("pageerror", error => errors.push(error.message))
/** @type {Record<string, unknown>} */
const evidence = {}
try {
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  assert(url)
  const base = `${url}__caliper/`
  const dialog = page.getByRole("dialog", { name: "Checks", exact: true })
  const runButton = dialog.getByRole("button", { name: "Check selected preview", exact: true })
  const closeButton = dialog.locator(cal.checksClose)
  const getView = async () => /** @type {import('../src/checks/contract.js').ChecksView} */ (await (await fetch(`${base}checks`)).json())
  const open = async () => { await (await reveal(page, page.locator(`${cal.tool}[data-tool="checks"]`))).click(); await dialog.waitFor() }
  /** @param {string} state */
  const select = async state => {
    if (await dialog.isVisible()) await closeButton.click()
    await (await reveal(page, page.locator(`${cal.state}[data-state="${state}"]`).first())).click()
    await open()
  }
  const start = async () => {
    const response = page.waitForResponse(response => response.url().endsWith("/checks/run") && response.request().method() === "POST")
    await runButton.click()
    const ack = await response
    assert.equal(ack.status(), 202, await ack.text())
    const running = await ack.json()
    assert.equal(running._tag, "Running")
    await dialog.locator(cal.checkStop).waitFor()
    return running.id
  }
  /** @param {string} id */
  const ready = async id => {
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      const view = await getView()
      if (view._tag === "Ready" && view.id === id) {
        assert.equal(view.report.version, 2)
        assert(view.report.version === 2)
        await dialog.locator(cal.report).waitFor()
        return { ...view, report: view.report }
      }
      assert(view._tag !== "Failed" && view._tag !== "Cancelled", JSON.stringify(view))
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`Checks did not finish: ${JSON.stringify(await getView())}`)
  }
  /** @param {import('playwright-core').Locator[]} controls @param {number} width @param {number} height */
  const reachable = async (controls, width, height) => {
    for (const control of controls) {
      await control.scrollIntoViewIfNeeded()
      const box = await control.boundingBox()
      assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1, `Control outside ${width} × ${height}: ${await control.innerText()}`)
    }
    assert(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1), "Dialog has horizontal overflow")
  }
  /** @type {Array<[string, number, number]>} */
  const shapes = [["wide", 1600, 1000], ["narrow-tall", 360, 900], ["wide-short", 1400, 300], ["small", 320, 480]]
  await page.goto(`${base}#part=${encodeURIComponent(part)}&state=default`)
  await page.locator(`${cal.state}[data-state="default"]`).waitFor()
  await open()
  await dialog.getByText(/^No checks run yet/).waitFor()
  const first = await ready(await start())
  assert.equal(first.report.run.termination, "Completed")
  assert.equal(first.stale, false)
  assert.deepEqual(first.report.results.map(result => result.device).sort(), ["odin2portal", "rg353m"])
  for (const result of first.report.results) {
    assert.deepEqual(result.authored.checks.map(check => [check.name, check.status]), [["retry loads the library", "Passed"], ["deliberate assertion failure", "Failed"]])
    assert.equal(result.checks.find(check => check.name === "determinism")?.status, "Passed")
    assert.notEqual(result.authored.checks[0]?.imageSha256, result.sha256, "Interaction must not replace the initial-state image")
    assert.equal(result.authored.provenance.kind, "Original")
  }
  const row = dialog.locator(`${cal.checkRow}[data-index="0"]`)
  await (await reveal(page, row.locator(":scope > summary"))).click()
  await (await reveal(page, row.getByText(/Wrong label/))).waitFor({ state: "visible" })
  assert(!(await row.innerText()).includes("\u001b["), "Browser assertion details must not display terminal color codes")
  await row.locator(`${cal.finding} > summary`).filter({ hasText: "retry loads the library" }).click()
  await row.getByText("Checks declared in real files. Covers these named checks only.", { exact: true }).waitFor()
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('[data-cal="check-row"][data-index="0"] img')]
    return images.length === 4 && images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)
  })
  const item = first.report.results[0]
  assert(item)
  for (const [kind, query, hash] of [["first", "kind=first", item.sha256], ["interaction", "kind=authored&check=0", item.authored.checks[0]?.imageSha256]]) {
    const image = await fetch(`${base}checks/image?id=${first.id}&index=0&${query}`)
    assert.equal(image.status, 200)
    assert.equal(image.headers.get("content-type"), "image/png")
    const bytes = Buffer.from(await image.arrayBuffer())
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash)
    writeFileSync(join(out, `${kind}.png`), bytes)
  }
  writeFileSync(join(out, "completed-report.json"), JSON.stringify(first, null, 2))
  if (reference) deferLayout(["Authored result, assertion and approval controls inside all four viewport shapes", "Authored Checks follows a 360 × 480 embedded container"])
  else {
    for (const [name, width, height] of shapes) {
      await page.setViewportSize({ width, height })
      await reachable([closeButton, runButton, row.getByRole("checkbox"), row.getByRole("button", { name: "Approve this image", exact: true })], width, height)
      await row.getByText(/^Authored interactions/).scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(out, `results-${name}.png`) })
      await row.locator(`${cal.finding} > summary`).filter({ hasText: "deliberate assertion failure" }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(out, `assertion-${name}.png`) })
    }
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.locator("#caliper").evaluate(node => { node.style.width = "360px"; node.style.height = "480px" })
    await page.waitForFunction(() => (document.querySelector('[data-cal="checks"]')?.getBoundingClientRect().right ?? 9999) <= 360)
    await reachable([closeButton, runButton, row.getByRole("checkbox")], 360, 480)
    await page.screenshot({ path: join(out, "results-embedded.png") })
    await page.locator("#caliper").evaluate(node => { node.style.removeProperty("width"); node.style.removeProperty("height") })
  }

  await select("Hang")
  const hanging = once(witnesses, "started", { signal: AbortSignal.timeout(60_000) })
  const cancelledId = await start()
  assert.deepEqual(await hanging, ["before"], "The real callback must start before Stop")
  // Close is not Stop. The same active browser work survives reopening.
  await closeButton.click()
  assert.equal((await getView())._tag, "Running")
  await open()
  const stop = dialog.getByRole("button", { name: "Stop checks", exact: true })
  if (reference) deferLayout(["Running authored Checks Close/Stop controls inside all four viewport shapes"])
  else {
    for (const [name, width, height] of shapes) {
      await page.setViewportSize({ width, height })
      await reachable([closeButton, stop], width, height)
      await stop.scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(out, `running-${name}.png`) })
    }
  }
  const stopStarted = Date.now()
  await stop.click()
  const cancelled = await ready(cancelledId)
  evidence.stopMs = Date.now() - stopStarted
  assert(Number(evidence.stopMs) < 8000, "Stop exceeded the cleanup budget plus UI transport allowance")
  assert.equal(cancelled.report.run.termination, "Cancelled")
  assert.equal(cancelled.report.results[0]?.authored.checks[0]?.status, "Passed")
  assert.equal(cancelled.report.results[0]?.authored.checks[1]?.status, "Inconclusive")
  assert(cancelled.report.results[1]?.authored.checks.every(check => check.status === "NotRun"))
  await (await reveal(page, dialog.getByText(/Run ended: Cancelled/))).waitFor({ state: "visible" })
  writeFileSync(join(out, "cancelled-report.json"), JSON.stringify(cancelled, null, 2))
  await page.setViewportSize({ width: 1600, height: 1000 })
  await select("default")
  const rerun = await ready(await start())
  assert.notEqual(rerun.id, first.id)
  assert.equal(rerun.report.run.termination, "Completed")
  assert.deepEqual(rerun.report.results.map(result => result.authored.status), ["Failed", "Failed"], "Rerun must preserve the deliberate assertion failures, not fabricate a pass")

  await select("Hang")
  const changing = once(witnesses, "started", { signal: AbortSignal.timeout(60_000) })
  const staleId = await start()
  assert.deepEqual(await changing, ["before"])
  const changedAt = Date.now()
  writeFileSync(helper, 'export const revision = "after"\n')
  const stale = await ready(staleId)
  evidence.sourceChangeMs = Date.now() - changedAt
  assert(Number(evidence.sourceChangeMs) < 8000, "Source invalidation did not stop the hanging callback promptly")
  assert.equal(stale.report.run.termination, "SourceChanged")
  assert.equal(stale.report.run.stale, true)
  assert.equal(stale.stale, true)
  assert.equal(stale.report.results[0]?.authored.checks[0]?.status, "Passed")
  await dialog.getByText(/^Results are out of date/).waitFor()
  await (await reveal(page, dialog.locator(`${cal.checkRow}[data-index="0"] > summary`))).click()
  assert(await dialog.getByRole("checkbox").isDisabled())
  assert(await dialog.getByRole("button", { name: "Approve this image", exact: true }).isDisabled())
  await page.screenshot({ path: join(out, "source-changed.png") })
  writeFileSync(join(out, "source-changed-report.json"), JSON.stringify(stale, null, 2))
  await select("default")
  const current = await ready(await start())
  assert.equal(current.report.run.termination, "Completed")
  assert.equal(current.stale, false)
  assert.notEqual(current.report.run.source.fingerprint, stale.report.run.source.fingerprint)
  assert.deepEqual(errors, [])
  evidence.completedRuns = 3
  evidence.devices = current.report.results.map(result => result.device)
  evidence.pageErrors = errors
  rmSync(join(out, "failure.json"), { force: true })
  rmSync(join(out, "failure.png"), { force: true })
  writeFileSync(join(out, "verification.json"), JSON.stringify(evidence, null, 2))
  console.log(`Verified real authored Checks UI run/results/images, Stop, rerun, helper-edit invalidation, ${reference ? "with container-layout gates deferred for the unstyled reference" : "and five container shapes"}. ${JSON.stringify(evidence)} Screenshots: ${out}`)
} catch (error) {
  await page.screenshot({ path: join(out, "failure.png") }).catch(() => {})
  writeFileSync(join(out, "failure.json"), JSON.stringify({ error: String(error), errors, evidence, body: await page.locator("body").innerText().catch(() => "unavailable") }, null, 2))
  throw error
} finally {
  await browser.close()
  if (server.httpServer && "closeAllConnections" in server.httpServer) server.httpServer.closeAllConnections()
  await server.close()
  rmSync(root, { recursive: true, force: true })
}
