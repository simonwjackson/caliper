#!/usr/bin/env -S nix develop -c node
// @ts-check
/** Local browser contract gate. No model calls, consumer files or live chrome routes. */
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createServer } from "node:http"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright-core"

assert(process.env.CHROMIUM, "Set CHROMIUM or run through nix develop")
const dir = mkdtempSync(join(tmpdir(), "caliper-chrome-contract-"))
execFileSync("bun", ["build", "scripts/fixtures/chrome-contract.tsx", "--outdir", dir, "--target", "browser"], { stdio: "inherit" })
const bundle = readFileSync(join(dir, "chrome-contract.js"))
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost")
  if (url.pathname === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle) }
  else if (url.pathname === "/frame") response.end('<!doctype html><title>Scenario frame</title><button id="count" onclick="this.textContent=String(Number(this.textContent)+1)">0</button>')
  else if (url.pathname === "/report.json") { response.setHeader("content-type", "application/json"); response.end('{"coverage":"Contract scenario only"}') }
  else response.end('<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>')
})
/** @type {import('playwright-core').Browser | undefined} */
let browser
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(undefined)))
  const address = server.address()
  assert(address && typeof address !== "string")
  const origin = `http://127.0.0.1:${address.port}`
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM, headless: true })
  const page = await browser.newPage({ viewport: { width: 1000, height: 680 } })
  /** @type {string[]} */
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()) })
  await page.goto(origin)
  await page.waitForFunction(() => Boolean(window.chromeContract))
  const hooks = await page.evaluate(() => window.chromeContract.hooks)
  /** @param {keyof typeof hooks} name */
  const selector = name => `[data-cal="${hooks[name]}"]`
  const names = await page.evaluate(() => window.chromeContract.names)
  const seen = new Set()
  for (const name of names) {
    await page.goto(`${origin}/?scenario=${name}`)
    await page.waitForSelector(selector("root"))
    for (const hook of await page.locator("[data-cal]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-cal")))) seen.add(hook)
  }
  assert.deepEqual(Object.values(hooks).filter(hook => !seen.has(hook)), [], "Every hook appears in an applicable scenario")

  await page.goto(origin)
  await page.waitForSelector(selector("root"))
  await page.locator(selector("prompt")).fill("Use the shared button")
  await page.locator(selector("prompt")).press("Control+Enter")
  await page.locator('summary').filter({ hasText: "New take options" }).click()
  await page.locator(selector("count")).selectOption("2")
  await page.locator(selector("follow")).click()
  assert(await page.evaluate(() => window.chromeContract.calls.some(call => call.name === "onStart")))
  assert(await page.evaluate(() => window.chromeContract.calls.some(call => call.name === "onFollow" && call.args[0] === "6")))
  await page.locator('input[type="file"]').setInputFiles({ name: "ref.png", mimeType: "image/png", buffer: Buffer.from("reference input") })
  assert.equal(await page.evaluate(() => window.chromeContract.calls.filter(call => call.name === "onAttach").length), 1)
  await page.locator(selector("attachmentRemove")).click()
  assert.equal(await page.locator(`${selector("attachments")} li`).count(), 0)
  await page.locator(selector("accept")).click()
  assert(await page.evaluate(() => window.chromeContract.calls.some(call => call.name === "onAccept" && call.args[0] === "6")))

  // A stream update must not reload the frame or discard its reached interaction state.
  const takeFrame = page.frameLocator(`${selector("frame")}[data-take="6"]`)
  await takeFrame.locator("#count").click()
  await page.evaluate(() => window.chromeContract.tick())
  assert.equal(await takeFrame.locator("#count").textContent(), "1")
  assert.equal(await page.evaluate(() => window.chromeContract.calls.filter(call => call.name === "onFrameMount" && call.args[0] === "6@1234").length), 1)
  await page.setViewportSize({ width: 416, height: 640 })
  await page.locator(`${selector("frame")}[data-take="6"]`).evaluate(node => node.scrollIntoView())
  assert.equal(await takeFrame.locator("body").evaluate(() => innerWidth), 640)

  const slider = page.locator(`${selector("knobSlider")}[data-knob="gap"]`)
  await slider.focus()
  await slider.press("ArrowRight")
  const knobCalls = await page.evaluate(() => window.chromeContract.calls.filter(call => call.name === "onKnobInput" || call.name === "onKnobCommit").map(call => ({ name: call.name, value: call.args[1] })))
  assert.deepEqual(knobCalls, [{ name: "onKnobInput", value: "9px" }, { name: "onKnobCommit", value: "9px" }])
  assert.equal(await page.locator(`${selector("knobSlider")}[data-knob="threshold"]`).count(), 0, "Unbounded numbers must not acquire invented sliders")
  await page.locator(`${selector("knobToken")}[data-token="--paper"]`).click()
  assert(await page.evaluate(() => window.chromeContract.calls.some(call => call.name === "onKnobCommit" && call.args[1] === "var(--paper)")))
  await page.locator(selector("promote")).click()
  assert(await page.evaluate(() => window.chromeContract.calls.some(call => call.name === "onPromote" && call.args[0] === "padding")))

  await page.goto(`${origin}/?scenario=plan`)
  await page.locator(`${selector("directionTitle")}[data-direction="b"]`).fill("Keep the strange")
  await page.locator(`${selector("directionRemove")}[data-direction="a"]`).click()
  assert.equal(await page.locator(`${selector("directionTitle")}[data-direction="b"]`).inputValue(), "Keep the strange")
  await page.locator(selector("planStart")).click()
  assert.equal(await page.locator(selector("start")).count(), 0)
  assert(await page.evaluate(() => window.chromeContract.calls.some(call => call.name === "onStart")))

  await page.goto(`${origin}/?scenario=alternate`)
  assert(await page.locator(selector("applyAlternate")).isDisabled())
  await page.locator(selector("behaviorReviewed")).check()
  await page.locator(selector("applyAlternate")).click()
  assert(await page.evaluate(() => window.chromeContract.calls.some(call => call.name === "onApplyAlternate" && call.args[0] === "6" && call.args[1] === "review-r1")))

  await page.goto(`${origin}/?scenario=checks`)
  await page.locator(`${selector("checkRow")} > summary`).click()
  assert(await page.locator(selector("approveImage")).isDisabled())
  await page.locator(selector("imageReviewed")).check()
  await page.locator(selector("approveImage")).click()
  assert(await page.evaluate(() => window.chromeContract.calls.some(call => call.name === "onApproveImage" && call.args[0] === "run-1" && call.args[1] === 0)))
  await page.keyboard.press("Escape")
  await page.locator(selector("checks")).waitFor({ state: "detached" })
  assert.equal(await page.evaluate(() => window.chromeContract.calls.filter(call => call.name === "onCheckStop").length), 0, "Closing checks is not cancellation")
  await page.goto(`${origin}/?scenario=checksRunning`)
  await page.locator(selector("checkStop")).click()
  assert(await page.evaluate(() => window.chromeContract.calls.some(call => call.name === "onCheckStop" && call.args[0] === "run-2")))

  await page.goto(`${origin}/?scenario=failed`)
  assert(await page.locator(selector("start")).isDisabled())
  assert.equal(await page.locator(`${selector("agent")}[role="alert"]`).count(), 1)
  await page.locator(selector("codeRetry")).click()
  assert(await page.evaluate(() => window.chromeContract.calls.some(call => call.name === "onCodeRetry")))
  await page.evaluate(() => window.chromeContract.unmount())
  assert(await page.evaluate(() => window.chromeContract.calls.some(call => call.name === "onFrameMount" && call.args[1] === null)))
  assert.deepEqual(errors, [], "No uncaught errors or React contract warnings")
  console.log(`Chrome contract verified: ${names.length} scenarios, ${Object.values(hooks).length} hooks, real browser action and identity gates.`)
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(() => resolve(undefined)))
  rmSync(dir, { recursive: true, force: true })
}
