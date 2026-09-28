#!/usr/bin/env -S nix shell nixpkgs#nodejs --command node
// Exercise product intent through the real CLI, chrome, take overlay and agent.
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { once } from "node:events"
import { createServer as createHttpServer } from "node:http"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { setTimeout } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { parseArgs, promisify } from "node:util"
import { createServer } from "vite"
import { chromium } from "playwright-core"
import { caliper } from "../src/plugin.js"
import { createTakeStore } from "../src/takes/store.js"
import { reveal } from "./reveal.mjs"

const { values } = parseArgs({ options: { modules: { type: "string" }, out: { type: "string", default: "/tmp/caliper-expectations-browser" } } })
assert(values.modules && process.env.CHROMIUM, "Pass --modules and set CHROMIUM")
const root = mkdtempSync(join(tmpdir(), "caliper-expectations-consumer-"))
const out = resolve(values.out)
mkdirSync(out, { recursive: true })
/** @param {string} file @param {string} text */
const write = (file, text) => { const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
const part = "src/Intent.atom.part.tsx"
const invalidPart = "src/Invalid.atom.part.tsx"
const dynamicPart = "src/Dynamic.atom.part.tsx"
const reason = "Unnamed control is deliberate in this verification fixture only."
const spillReason = "This fixture deliberately scrolls 32 CSS pixels to the right."
const accessibleRule = { rule: "button-name", target: ["#accepted"], reason }
const spillRule = { target: "#caliper-host > div:nth-of-type(1)", edge: "right", maxPixels: 32, reason: spillReason }
const expectations = {
  default: { accessibility: [accessibleRule] },
  Empty: { empty: { reason: "No content is the intended fixture state." } },
  Shadow: { accessibility: [{ rule: "button-name", target: [["#shadow", "button"]], reason: "Exact shadow target in this fixture." }] },
  UnexpectedContent: { empty: { reason: "This fixture detects an empty expectation mismatch." } },
  Mixed: { accessibility: [accessibleRule] },
  Fixed: { accessibility: [accessibleRule] },
  WrongRule: { accessibility: [{ ...accessibleRule, rule: "image-alt" }] },
  WrongTarget: { accessibility: [accessibleRule] },
  Overflow: { spill: [spillRule] },
  Exceeded: { spill: [spillRule] },
  OtherEdge: { spill: [spillRule] },
  ExtraSpill: { spill: [spillRule] },
}
const components = `import { useLayoutEffect, useRef } from "react"
export const name = "Product intent"
export default function Default() { return <button id="accepted" /> }
export function Empty() { return null }
export function Shadow() {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const shadow = ref.current!.attachShadow({ mode: "open" })
    const button = document.createElement("button")
    button.style.cssText = "width:60px;height:30px"
    shadow.append(button)
  }, [])
  return <div id="shadow" ref={ref} />
}
export function UnexpectedContent() { return <button>Visible content</button> }
export function Undeclared() { return <button id="accepted" /> }
export function Mixed() { return <><button id="accepted" /><button id="new-finding" /></> }
export function Fixed() { return <button id="accepted">Now named</button> }
export function WrongRule() { return <button id="accepted" /> }
export function WrongTarget() { return <button id="different" /> }
export function Overflow() { return <div style={{width:"calc(100vw + 32px)", height:32}}>Scrollable content</div> }
export function Exceeded() { return <div style={{width:"calc(100vw + 64px)", height:32}}>Too much spill</div> }
export function OtherEdge() { return <div style={{width:"calc(100vw + 32px)", height:"calc(100vh + 32px)"}}>Another edge</div> }
export function ExtraSpill() { return <><div style={{width:"calc(100vw + 32px)",height:32}}>Accepted target</div><div style={{width:"calc(100vw + 32px)",height:32}}>Another target</div></> }
`
const source = `${components}\nexport const expectations = ${JSON.stringify(expectations, null, 2)}\n`
write("package.json", JSON.stringify({ name: "expectations-consumer", type: "module", exports: { ".": "./src/index.ts" } }))
write("tsconfig.json", JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }))
write("src/index.ts", 'import "./global.css"')
write("src/global.css", "body { margin: 0; background: white; color: black; } button { width: 60px; height: 30px; color: black; background: white; }")
write(part, source)
write(invalidPart, `export default function Default() { return <button id="accepted" /> }\nexport const expectations = ${JSON.stringify({ default: expectations.default, MissingState: { empty: { reason: "A typo must not authorize any exception." } } })}`)
write(dynamicPart, `export default function Default() { return <button id="accepted" /> }\nexport const expectations = (() => (${JSON.stringify({ default: expectations.default })}))()`)
symlinkSync(resolve(values.modules), join(root, "node_modules"), "dir")

// An actual local endpoint drives the production agent without a paid model call.
/** @type {Array<{ messages: Array<{ role: string, content: unknown }> }>} */
const modelRequests = []
const model = createHttpServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  modelRequests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")))
  const first = modelRequests.length === 1
  response.writeHead(200, { "content-type": "text/event-stream" })
  const delta = first
    ? { role: "assistant", tool_calls: [{ index: 0, id: "intent-check", type: "function", function: { name: "render", arguments: '{"checks":true}' } }] }
    : { role: "assistant", content: "Reported accepted exceptions and observed findings." }
  for (const [change, finish] of [[delta, null], [{}, first ? "tool_calls" : "stop"]]) {
    response.write(`data: ${JSON.stringify({ id: "local-intent-check", object: "chat.completion.chunk", created: 0, model: "intent-model", choices: [{ index: 0, delta: change, finish_reason: finish }] })}\n\n`)
  }
  response.end("data: [DONE]\n\n")
})
model.listen(0, "127.0.0.1")
await once(model, "listening")
const modelAddress = model.address()
assert(modelAddress && typeof modelAddress !== "string")
write(".env.local", "CALIPER_INTENT_TEST_KEY=local-test-only\n")
const server = await createServer({ root, cacheDir: join(root, ".vite"), configFile: false, logLevel: "silent", plugins: [caliper({ wrap: false, agent: { model: "intent-model", baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`, apiKeyEnv: "CALIPER_INTENT_TEST_KEY", reasoning: "off" } })], server: { host: "127.0.0.1", port: 0 } })
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
/** @type {string[]} */
const errors = []
page.on("pageerror", error => errors.push(error.message))
const cli = fileURLToPath(new URL("../bin/caliper-render.mjs", import.meta.url))
const runFile = promisify(execFile)
try {
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  assert(url)
  const base = `${url}__caliper/`
  /** @param {string[]} args @returns {Promise<Awaited<ReturnType<typeof import('../src/render/checks.js').checkJobs>>>} */
  const run = async args => {
    const { stdout } = await runFile(process.execPath, [cli, "--url", url, "--out", out, "--check", ...args], { maxBuffer: 16_000_000, timeout: 120_000 })
    return JSON.parse(stdout)
  }
  /** @param {import('../src/render/check-contract.js').CheckReport['results'][number]} result @param {string} name */
  const check = (result, name) => { const found = result.checks.find(item => item.name === name); assert(found, `${result.state}: missing ${name}`); return found }
  const all = await run(["--part", "*", "--state", "*", "--device", "*"])
  assert.equal(all.report.results.length, 30)
  for (const device of ["rg353m", "odin2portal"]) {
    /** @param {string} state @param {string} [file] */
    const result = (state, file = part) => {
      const found = all.report.results.find(item => item.part === file && item.state === state && item.device === device)
      assert(found, `${file} ${state} ${device} was checked`)
      return found
    }
    const accepted = check(result("default"), "accessibility")
    assert.equal(accepted.status, "Accepted")
    assert.deepEqual(accepted.accepted, [{ rule: "button-name", target: '["#accepted"]', reason }])
    assert(accepted.detail.includes("button-name") && accepted.detail.includes("violations"), "raw axe evidence survives acceptance")
    assert.equal(check(result("Shadow"), "accessibility").status, "Accepted")
    assert.equal(check(result("Shadow"), "accessibility").accepted?.[0]?.target, '[["#shadow","button"]]')
    assert.equal(check(result("Empty"), "render").status, "Passed")
    assert(check(result("Empty"), "render").detail.includes(expectations.Empty.empty.reason))
    assert.equal(check(result("UnexpectedContent"), "render").status, "Failed")
    assert.equal(check(result("Undeclared"), "accessibility").status, "Failed", "intent belongs to one state")
    assert.equal(check(result("Mixed"), "accessibility").status, "Failed")
    assert.equal(check(result("Mixed"), "accessibility").accepted?.length, 1, "accepted and new findings stay distinct")
    assert.equal(check(result("Fixed"), "accessibility").status, "Review")
    assert.equal(check(result("Fixed"), "accessibility").unmatched?.length, 1)
    assert.equal(check(result("WrongRule"), "accessibility").status, "Failed")
    assert.equal(check(result("WrongTarget"), "accessibility").status, "Failed")
    const overflow = check(result("Overflow"), "spill")
    assert.equal(overflow.status, "Accepted")
    assert.equal(overflow.accepted?.[0]?.reason, spillReason)
    assert(overflow.detail.includes(spillRule.target), "full spill target remains in observed evidence")
    assert.equal(check(result("Exceeded"), "spill").status, "Review", "pixel limit bounds the exception")
    assert.equal(check(result("OtherEdge"), "spill").status, "Review", "another edge remains unresolved")
    assert.equal(check(result("ExtraSpill"), "spill").status, "Review", "another element remains unresolved")
    for (const file of [invalidPart, dynamicPart]) {
      assert.equal(check(result("default", file), "expectations").status, "Failed")
      assert.equal(check(result("default", file), "accessibility").status, "Failed")
      assert.equal(check(result("default", file), "accessibility").accepted?.length ?? 0, 0)
    }
  }
  console.log("CLI: 30 state/device results verified exact rules and targets, spill bounds, unused declarations, invalid metadata, intended empty and mismatch.")

  const store = createTakeStore(root)
  const take = store.create({ part, state: "default", device: "rg353m" })
  const takeReason = "Take-only declaration for a take-only target."
  store.write(take, part, `export default function Default() { return <button id="take-target" /> }\nexport const expectations = ${JSON.stringify({ default: { accessibility: [{ rule: "button-name", target: ["#take-target"], reason: takeReason }] } })}`)
  const taken = await run(["--part", part, "--take", take])
  assert.equal(check(taken.report.results[0], "accessibility").status, "Accepted")
  assert.equal(check(taken.report.results[0], "accessibility").accepted?.[0]?.reason, takeReason)
  assert.equal(taken.report.results[0].take, take)
  const unchanged = await run(["--part", part])
  assert.equal(check(unchanged.report.results[0], "accessibility").accepted?.[0]?.reason, reason, "take intent does not leak into real files")
  console.log("Take overlay: its own source declaration is applied without changing real-file intent.")

  await page.goto(`${base}#part=${encodeURIComponent(part)}&state=default`)
  await page.locator(`.cal-state[data-nav-key="state:${part}:default"]`).waitFor()
  const dialog = page.getByRole("dialog", { name: "Checks", exact: true })
  const open = async () => { await (await reveal(page, page.locator(".cal-checks-toggle"))).click(); await dialog.waitFor() }
  const runUi = async () => {
    await dialog.getByRole("button", { name: "Check selected preview", exact: true }).click()
    await dialog.getByText(/Checking 2 state\/device renders twice/).waitFor()
    await dialog.locator(".cal-check-summary").waitFor({ timeout: 120_000 })
    const ready = /** @type {import('../src/checks/contract.js').ChecksView} */ (await (await fetch(`${base}checks`)).json())
    assert(ready._tag === "Ready")
    return ready
  }
  await open()
  let ready = await runUi()
  assert(ready.report.results.every(result => check(result, "accessibility").status === "Accepted"))
  assert((await dialog.locator(".cal-check-summary").innerText()).includes("2 accepted exceptions"))
  let row = dialog.locator('.cal-check-result[data-index="0"]')
  await row.locator(":scope > summary").click()
  let finding = row.locator(".cal-check-finding").filter({ has: page.locator('[data-status="Accepted"]') })
  await finding.locator(":scope > summary").click()
  assert((await finding.innerText()).includes(reason))
  assert((await finding.innerText()).includes("Violation:"), "accepted UI retains the observed violation")
  for (const [name, width, height] of /** @type {Array<[string, number, number]>} */ ([["generous", 1600, 1000], ["narrow-tall", 360, 900], ["wide-short", 1400, 300]])) {
    await page.setViewportSize({ width, height })
    for (const control of [dialog.getByRole("button", { name: "Close checks" }), dialog.getByRole("button", { name: "Check selected preview", exact: true }), finding.locator(":scope > summary"), dialog.getByRole("link", { name: "Download report" })]) {
      await control.scrollIntoViewIfNeeded()
      const box = await control.boundingBox()
      assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1, `${name}: control remains reachable`)
    }
    assert(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${name}: no horizontal dialog overflow`)
    await finding.locator(":scope > summary").scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(out, `${name}.png`) })
  }
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.locator("#caliper").evaluate(node => { node.style.width = "720px"; node.style.height = "560px" })
  await page.waitForFunction(() => (document.querySelector(".cal-checks-dialog")?.getBoundingClientRect().right ?? Infinity) <= 720)
  await page.screenshot({ path: join(out, "contained.png") })
  await page.locator("#caliper").evaluate(node => { node.style.removeProperty("width"); node.style.removeProperty("height") })
  await dialog.getByRole("button", { name: "Close checks" }).click()
  await page.reload()
  await page.locator(`.cal-state[data-take="${take}"]`).click()
  await open()
  ready = await runUi()
  assert(ready.report.results.every(result => result.take === take && check(result, "accessibility").status === "Accepted"))
  row = dialog.locator('.cal-check-result[data-index="0"]')
  await row.locator(":scope > summary").click()
  finding = row.locator(".cal-check-finding").filter({ has: page.locator('[data-status="Accepted"]') })
  await finding.locator(":scope > summary").click()
  assert((await finding.innerText()).includes(takeReason))
  await row.getByText(/Take images cannot become product baselines/).waitFor()
  assert.equal(await row.getByRole("button", { name: "Approve this image", exact: true }).count(), 0)
  await page.screenshot({ path: join(out, "take-intent.png") })
  assert.deepEqual(errors, [])
  console.log("Checks UI: accepted counts, reasons and raw violations verified at generous, narrow-tall, wide-short and contained sizes; take images cannot be approved.")

  const started = await fetch(`${base}takes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ part, state: "default", device: "rg353m", prompt: "Run checks and report the accepted product exception without editing files." }) })
  assert.equal(started.status, 201)
  const startedTake = await started.json()
  let idle = false
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const snapshot = await (await fetch(`${base}takes.json`)).json()
    const view = snapshot.takes.find((/** @type {import('../src/types').TakeView} */ item) => item.take === startedTake.take)
    if (view && view.run._tag !== "Running") { assert.equal(view.run._tag, "Idle", JSON.stringify(view.run)); idle = true; break }
    await setTimeout(100)
  }
  assert(idle, "agent check completed")
  const toolMessage = modelRequests.flatMap(request => request.messages).find(message => message.role === "tool")
  const toolText = JSON.stringify(toolMessage?.content)
  assert(toolText.includes("Accepted") && toolText.includes(reason) && toolText.includes("button-name"), "agent receives accepted status, reason and original rule")
  console.log(`Agent: real render tool returned Accepted with its reason and evidence. Reports and screenshots: ${out}`)
} catch (error) {
  await page.screenshot({ path: join(out, "failure.png") })
  writeFileSync(join(out, "failure.txt"), JSON.stringify({ errors, body: await page.locator("body").innerText() }, null, 2))
  throw error
} finally {
  await browser.close()
  if (server.httpServer && "closeAllConnections" in server.httpServer) server.httpServer.closeAllConnections()
  await server.close()
  model.closeAllConnections()
  await new Promise((resolve, reject) => model.close(error => error ? reject(error) : resolve(undefined)))
  rmSync(root, { recursive: true, force: true })
}
