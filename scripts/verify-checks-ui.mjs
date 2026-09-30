#!/usr/bin/env -S nix develop -c node
// Real chrome -> HTTP checks -> Chromium, with no external model calls.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { createServer } from "vite"
import { chromium } from "playwright-core"
import { caliper } from "../src/plugin.js"
import { createTakeStore } from "../src/takes/store.js"
import { cal, deferLayout, reveal } from "./verify-helpers.mjs"

const { values } = parseArgs({ options: { reference: { type: "boolean", default: true }, layout: { type: "boolean", default: false }, modules: { type: "string" }, out: { type: "string", default: "/tmp/caliper-checks-ui" } } })
// The served Run 1 renderer is unstyled. Opt in to production geometry gates
// with --layout only after the real UI is integrated; deferrals are not passes.
const reference = values.reference && !values.layout
assert(values.modules && process.env.CHROMIUM, "Pass --modules and set CHROMIUM")
const root = mkdtempSync(join(tmpdir(), "caliper-checks-ui-consumer-"))
const out = resolve(values.out)
mkdirSync(out, { recursive: true })
/** @param {string} file @param {string} text */
const write = (file, text) => { const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
const part = "src/Button.atom.part.tsx"
const source = `export const name = "Review button"
export default function Default() { return <button>Ready</button> }
export function MissingName() { return <button style={{ width: 60, height: 30 }} /> }
export function Empty() { return null }
export function Overflow() { return <button style={{ width: 1800 }}>Long control</button> }
export function Unstable() { return <button>{crypto.randomUUID()}</button> }
`
write("package.json", JSON.stringify({ name: "checks-ui-consumer", type: "module", exports: { ".": "./src/index.ts" } }))
write("tsconfig.json", JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }))
write("src/index.ts", 'import "./global.css"')
write("src/global.css", "body { margin: 0; background: white; color: black; } button { color: black; background: white; }")
write(part, source)
symlinkSync(resolve(values.modules), join(root, "node_modules"), "dir")
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
const server = await createServer({ root, cacheDir: join(root, ".vite"), configFile: false, logLevel: "silent", plugins: [caliper({ wrap: false })], server: { host: "127.0.0.1", port: 0 } })
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } })
/** @type {string[]} */
const errors = []
page.on("pageerror", error => errors.push(error.message))
try {
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  assert(url)
  const base = `${url}__caliper/`
  const getView = async () => /** @type {import('../src/checks/contract.js').ChecksView} */ (await (await fetch(`${base}checks`)).json())
  await page.goto(`${base}#part=${encodeURIComponent(part)}&state=*`)
  await page.locator(`${cal.state}[data-state="default"]`).waitFor()
  const dialog = page.getByRole("dialog", { name: "Checks", exact: true })
  const open = async () => {
    const button = await reveal(page, page.locator(`${cal.tool}[data-tool="checks"]`))
    await button.click()
    await dialog.waitFor()
  }
  await open()
  await dialog.getByText(/^No checks run yet/).waitFor()
  await dialog.getByRole("button", { name: "Check selected preview", exact: true }).click()
  await dialog.getByText(/(?:Checking 10 state\/device results|(?:Initial|Repeat) renders: \d+ of 10)/).waitFor()
  await dialog.locator(cal.checksClose).click()
  // Run continues outside the dialog. Reopening and reloading retain server state.
  await page.waitForFunction(async () => (await (await fetch("checks")).json())._tag === "Ready", null, { timeout: 120_000 })
  await page.reload()
  await page.locator(`${cal.state}[data-state="default"]`).waitFor()
  await open()
  await dialog.locator(cal.report).waitFor()
  let ready = await getView()
  assert.equal(ready._tag, "Ready")
  assert(ready._tag === "Ready")
  assert.equal(ready.report.results.length, 10)
  const originalId = ready.id
  const defaultIndex = ready.report.results.findIndex(result => result.state === "default" && result.device === "rg353m")
  const missingIndex = ready.report.results.findIndex(result => result.state === "MissingName" && result.device === "rg353m")
  const missing = dialog.locator(`${cal.checkRow}[data-index="${missingIndex}"]`)
  await missing.locator(":scope > summary").click()
  await (await reveal(page, missing.getByText(/button-name/).first())).waitFor({ state: "visible" })
  assert((await missing.innerText()).includes("Failed"))
  await page.screenshot({ path: join(out, "findings.png") })
  await missing.locator(":scope > summary").click()

  let row = dialog.locator(`${cal.checkRow}[data-index="${defaultIndex}"]`)
  await row.locator(":scope > summary").click()
  const reviewed = row.locator(cal.imageReviewed)
  await page.waitForFunction(({ index, selector }) => {
    const images = [...document.querySelectorAll(`${selector}[data-index="${index}"] img`)]
    return images.length === 2 && images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)
  }, { index: defaultIndex, selector: cal.checkRow })
  assert(await row.getByRole("button", { name: "Approve this image", exact: true }).isDisabled())
  await reviewed.check()
  const approvedResponse = page.waitForResponse(response => response.url().endsWith("/checks/approve"))
  await row.getByRole("button", { name: "Approve this image", exact: true }).click()
  assert.equal((await approvedResponse).status(), 200)
  await dialog.getByText(/Baseline approved from these saved images/).waitFor()
  assert(await row.getByRole("button", { name: "Baseline approved", exact: true }).isDisabled())
  assert.equal((await getView())._tag, "Ready")

  await dialog.getByRole("button", { name: "Check selected preview", exact: true }).click()
  await dialog.getByText(/(?:Checking 10 state\/device results|(?:Initial|Repeat) renders: \d+ of 10)/).waitFor()
  await dialog.locator(cal.report).waitFor({ timeout: 120_000 })
  ready = await getView()
  assert(ready._tag === "Ready")
  assert.notEqual(ready.id, originalId)
  assert.equal(ready.report.results[defaultIndex]?.checks.find(check => check.name === "baseline")?.status, "Passed")
  row = dialog.locator(`${cal.checkRow}[data-index="${defaultIndex}"]`)
  await row.locator(":scope > summary").click()
  await row.getByText("Baseline at check time", { exact: false }).waitFor()
  assert.equal(await row.locator("img").count(), 3)

  if (reference) deferLayout(["Checks controls stay inside all five size-ladder viewports without horizontal overflow", "Checks follows a 740 × 600 embedded Caliper container"])
  else {
    // No viewport-only assumptions: all actions remain reachable on the size ladder.
    for (const [name, width, height] of /** @type {Array<[string, number, number]>} */ ([["generous", 1800, 1000], ["medium", 1000, 800], ["narrow-tall", 360, 900], ["wide-short", 1400, 300], ["tiny", 320, 480]])) {
      await page.setViewportSize({ width, height })
      for (const control of [dialog.locator(cal.checksClose), dialog.getByRole("button", { name: "Check selected preview", exact: true }), row.getByRole("checkbox"), row.getByRole("button", { name: "Approve this image", exact: true })]) {
        await control.scrollIntoViewIfNeeded()
        const box = await control.boundingBox()
        assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1, `${name}: control stays reachable`)
      }
      assert(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${name}: no horizontal overflow`)
      await row.locator(":scope > summary").scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(out, `${name}.png`) })
    }
    await page.setViewportSize({ width: 1800, height: 1000 })
    await page.locator("#caliper").evaluate(node => { node.style.width = "740px"; node.style.height = "600px" })
    await page.waitForFunction(() => (document.querySelector('[data-cal="checks"]')?.getBoundingClientRect().right ?? 9999) <= 740)
    await page.screenshot({ path: join(out, "in-container.png") })
    await page.locator("#caliper").evaluate(node => { node.style.removeProperty("width"); node.style.removeProperty("height") })
  }

  write(part, source.replace(">Ready<", ">Changed<"))
  await dialog.getByText(/^Results are out of date/).waitFor()
  assert(await row.getByRole("checkbox").isDisabled())
  assert(await row.getByRole("button", { name: "Approve this image", exact: true }).isDisabled())
  await page.keyboard.press("Escape")
  await dialog.waitFor({ state: "hidden" })
  if (!reference) assert(await page.locator(`${cal.tool}[data-tool="checks"]`).evaluate(node => node === document.activeElement))
  else deferLayout(["Checks Escape restores focus to its opener; narrow Close restores focus to overflow opener"])
  assert((await page.locator(`${cal.state}[data-state="default"]`).innerText()).includes("Out of date"))
  await page.setViewportSize({ width: 320, height: 480 })
  await open()
  await dialog.locator(cal.checksClose).click()
  if (!reference) assert(await page.locator(`${cal.tool}[data-tool="checks"]`).evaluate(node => node === document.activeElement))
  await page.setViewportSize({ width: 1800, height: 1000 })

  // Take reports use the actual overlay, stay labelled, and never enable baseline approval.
  const store = createTakeStore(root)
  const take = store.create({ part, state: "default", device: "rg353m" })
  store.write(take, part, source.replace("<button>Ready</button>", '<button style={{ width: 60, height: 30 }} />'))
  // External fixture setup bypasses the API's take notification. Reload its snapshot.
  await page.reload()
  await page.locator(`${cal.navTake}[data-take="${take}"]`).click()
  await open()
  await dialog.getByRole("button", { name: "Check selected preview", exact: true }).click()
  await dialog.getByText(/(?:Checking 2 state\/device results|(?:Initial|Repeat) renders: \d+ of 2)/).waitFor()
  await dialog.locator(cal.report).waitFor({ timeout: 120_000 })
  ready = await getView()
  assert(ready._tag === "Ready" && ready.request.take === take)
  assert(ready.report.results.every(result => result.take === take))
  await dialog.locator(`${cal.checkRow}[data-index="0"] > summary`).click()
  await dialog.locator(`${cal.checkRow}[data-index="0"]`).getByText(/Take images cannot become product baselines/).waitFor()
  for (const control of await dialog.locator(cal.approveImage).all()) assert(await control.isDisabled(), "Take evidence cannot authorize baseline approval")
  assert(ready.report.results.some(result => result.checks.some(check => check.name === "accessibility" && check.status === "Failed")))
  await dialog.locator(cal.checksClose).click()
  const replacement = await fetch(`${base}takes/${take}/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
  assert.equal(replacement.status, 200, await replacement.text())
  assert(readFileSync(join(root, part), "utf8").includes('width: 60'))
  // Let the consumer render accepted files before disposing Vite's source watchers.
  await page.goto(`${base}#part=${encodeURIComponent(part)}&state=default`)
  await page.reload()
  await page.frameLocator(cal.frame).getByRole("button").waitFor()
  assert.deepEqual(errors, [])

  // A missing browser is a visible failure, not an endless spinner or an empty pass.
  const executable = process.env.CHROMIUM
  delete process.env.CHROMIUM
  let unavailable
  try {
    unavailable = await createServer({ root, cacheDir: join(root, ".vite-unavailable"), configFile: false, logLevel: "silent", plugins: [caliper({ wrap: false })], server: { host: "127.0.0.1", port: 0 } })
  } finally { process.env.CHROMIUM = executable }
  try {
    await unavailable.listen()
    await page.goto(`${unavailable.resolvedUrls?.local[0]}__caliper/#part=${encodeURIComponent(part)}&state=default`)
    await page.locator(`${cal.state}[data-state="default"]`).waitFor()
    await open()
    await dialog.getByRole("button", { name: "Check selected preview", exact: true }).click()
    await dialog.getByText(/Checks could not finish/).waitFor()
    await dialog.getByText(/Set CHROMIUM/).waitFor()
    await page.screenshot({ path: join(out, "setup-failure.png") })
  } catch (error) {
    await page.screenshot({ path: join(out, "setup-failure-debug.png") })
    writeFileSync(join(out, "setup-failure-debug.txt"), JSON.stringify({ errors, body: await page.locator("body").innerText(), view: await (await fetch(`${unavailable.resolvedUrls?.local[0]}__caliper/checks`)).json() }, null, 2))
    throw error
  } finally { await page.goto("about:blank"); await unavailable.close() }
  console.log(`Verified checks UI, saved-image approval, stale status, reload, take reports, unchanged Replace${reference ? "; layout and focus gates deferred for the unstyled reference" : ", and six container layouts"}. Screenshots: ${out}`)
} catch (error) {
  await page.screenshot({ path: join(out, "failure.png") })
  writeFileSync(join(out, "failure.txt"), JSON.stringify({ errors, body: await page.locator("body").innerText() }, null, 2))
  throw error
} finally {
  await browser.close()
  await server.close()
  rmSync(root, { recursive: true, force: true })
}
