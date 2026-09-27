#!/usr/bin/env -S nix shell nixpkgs#nodejs --command node
/** Real React/Vite/browser verification. Writes only a temporary consumer. */
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { createServer } from "vite"
import { chromium } from "playwright-core"
import { caliper } from "../src/plugin.js"
import { createTakeStore } from "../src/takes/store.js"
import { createIntegrationReview } from "../src/takes/integration.js"

const { values } = parseArgs({ options: { modules: { type: "string" }, component: { type: "boolean", default: false }, live: { type: "boolean", default: false }, out: { type: "string", default: "/tmp/caliper-integration-browser" } } })
assert(values.modules && process.env.CHROMIUM, "Pass --modules and set CHROMIUM")
const root = mkdtempSync(join(tmpdir(), "caliper-integration-browser-"))
const out = values.out
mkdirSync(out, { recursive: true })
/** @param {string} file @param {string} content */
const write = (file, content) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), content) }
const component = 'import { useState } from "react"; import "./Chip.css"; export function Chip({ tone = "original" }) { const [count, setCount] = useState(0); return <button className={`chip ${tone}`} onClick={() => setCount(count + 1)}>Chip {count}</button> }'
const part = 'import { Chip } from "./Chip"; export const name = "Chip"; export default function Default() { return <Chip /> }; export const Long = () => <div><Chip />Existing context</div>; export const Empty = () => null'
const files = {
  "package.json": JSON.stringify({ name: "integration-consumer", type: "module", exports: { ".": "./src/index.ts" } }),
  "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
  "src/index.ts": 'import "./global.css"',
  "src/global.css": 'body { margin: 0; background: white; }',
  "src/Chip.tsx": component,
  "src/Chip.css": '.chip { color: blue; font-size: 16px; }',
  "src/Chip.atom.part.tsx": part,
}
for (const [file, content] of Object.entries(files)) write(file, content)
symlinkSync(resolve(values.modules), join(root, "node_modules"), "dir")
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
let server
/** @type {string[]} */
const errors = []
try {
  server = await createServer({ root, cacheDir: join(root, ".vite"), configFile: false, logLevel: "warn", plugins: [caliper({ wrap: false, ...(values.live ? { agent: { model: "claude-opus-5-5", reasoning: "medium" } } : {}) })], server: { host: "127.0.0.1", port: 0 } })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  assert(url)
  const base = `${url}__caliper/`
  /** @param {string} path @param {object} [body] */
  const post = async (path, body = {}) => {
    const response = await fetch(`${base}takes/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    const result = await response.json()
    assert(response.ok, JSON.stringify(result))
    return result
  }
  const store = createTakeStore(root)
  const integration = createIntegrationReview(store)
  const ask = { part: "src/Chip.atom.part.tsx", state: "default", device: "rg353m" }
  let source
  let take
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } })
  page.on("pageerror", error => errors.push(error.message))
  if (values.live) {
    await page.goto(`${base}#part=${encodeURIComponent(ask.part)}&state=default`)
    await page.locator(".cal-prompt").fill("Make the chip text red. Change only Chip.css. Give this take a short descriptive name.")
    await page.getByRole("button", { name: "New take", exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll(".cal-take").length === 1)
    await page.waitForFunction(() => !document.querySelector('.cal-take[data-run="Running"]'), null, { timeout: 180000 })
    /** @type {import('../src/types').TakesSnapshot} */
    let snapshot = await (await fetch(`${base}takes.json`)).json()
    assert(snapshot.takes[0])
    source = snapshot.takes[0].take
    assert(snapshot.takes[0].name, "live agent generated a name")
    assert.equal(snapshot.takes[0].run._tag, "Idle")
    await page.getByRole("button", { name: "Add an alternate", exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll(".cal-take").length === 2)
    await page.waitForFunction(() => !document.querySelector('.cal-take[data-run="Running"]'), null, { timeout: 300000 })
    snapshot = await (await fetch(`${base}takes.json`)).json()
    const proposal = snapshot.takes.find(value => value.integration)
    assert(proposal)
    assert.equal(proposal.integration?._tag, "Review", JSON.stringify(snapshot))
    take = proposal.take
    writeFileSync(join(out, "live-proposal.json"), JSON.stringify(proposal, null, 2))
  } else {
    source = store.create({ ...ask, name: "Red chip" })
    store.write(source, "src/Chip.css", '.chip { color: red; font-size: 16px; }')
    take = integration.begin(source)
    store.write(take, "src/Chip.css", `${files["src/Chip.css"]}\n.chip.alternate { color: red; }`)
    const preview = values.component ? { part: "src/RedChip.atom.part.tsx", state: "default" } : { part: ask.part, state: "Alternate" }
    if (values.component) {
      store.write(take, "src/RedChip.tsx", 'import { Chip } from "./Chip"; export const RedChip = () => <Chip tone="alternate" />')
      store.write(take, preview.part, 'import { RedChip } from "./RedChip"; export default function Part() { return <RedChip /> }')
    } else store.write(take, ask.part, `${part}\nexport const Alternate = () => <Chip tone="alternate" />`)
    integration.submit(take, { strategy: values.component ? "component" : "variant", summary: "An opt-in red chip", shared: "Counter behavior and focus remain shared.", preserved: "Existing callers still use blue.", usage: values.component ? "<RedChip />" : '<Chip tone="alternate" />', preview })
  }
  assert.equal(readFileSync(join(root, "src/Chip.css"), "utf8"), files["src/Chip.css"])
  await page.goto(`${base}#part=${encodeURIComponent(ask.part)}&state=takes:default&take=${take}`)
  await page.reload()
  await page.getByRole("button", { name: "Review changes", exact: true }).click()
  await page.locator(".cal-integration details").first().waitFor()
  assert(await page.locator(".cal-integration").innerText().then(text => text.includes("Existing callers")))
  const checkResponse = page.waitForResponse(response => response.url().endsWith(`/takes/${take}/check`), { timeout: 180000 })
  await page.getByRole("button", { name: "Check original and alternate", exact: true }).click()
  const checkedResponse = await (await checkResponse).json()
  console.log("render checks", JSON.stringify(checkedResponse.checks ?? checkedResponse))
  await page.screenshot({ path: join(out, "checks.png") })
  const checked = await post(`${take}/review`)
  assert.equal(checked.checks._tag, "Passed", JSON.stringify(checked.checks))
  await page.getByText(/existing state\/device renders match two stable baselines/).waitFor()
  const apply = page.getByRole("button", { name: "Apply reviewed alternate", exact: true })
  assert(await apply.isDisabled(), "render checks cannot stand in for product behavior review")

  // Typecheck a materialized proposal without touching the running originals.
  const checkRoot = mkdtempSync(join(tmpdir(), "caliper-proposal-types-"))
  try {
    for (const file of store.listFiles(take, "")) {
      const target = join(checkRoot, file)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, store.read(take, file))
    }
    symlinkSync(resolve(values.modules), join(checkRoot, "node_modules"), "dir")
    const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc")
    execFileSync(process.execPath, [tsc, "--noEmit", "--skipLibCheck", "--target", "ES2022", "--moduleResolution", "bundler", "--module", "esnext"], { cwd: checkRoot, stdio: "pipe" })
  } finally { rmSync(checkRoot, { recursive: true, force: true }) }

  // Exercise original and alternate real interaction, before claiming review.
  for (const [preview, proposalTake] of [[{ part: ask.part, state: "default" }, take], [checked.proposal.preview, take]]) {
    const frame = await browser.newPage()
    await frame.goto(`${base}frame?part=${encodeURIComponent(preview.part)}&state=${encodeURIComponent(preview.state)}&take=${proposalTake}`)
    const chip = frame.getByRole("button", { name: "Chip 0", exact: true })
    await chip.click()
    await frame.getByRole("button", { name: "Chip 1", exact: true }).waitFor()
    await frame.close()
  }

  /** @type {Array<[string, number, number]>} */
  const sizes = [["generous", 1800, 1000], ["medium", 1000, 800], ["narrow-tall", 360, 900], ["wide-short", 1400, 350], ["tiny", 320, 480]]
  for (const [name, width, height] of sizes) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(150)
    for (const control of [page.getByRole("button", { name: "Check original and alternate", exact: true }), page.locator(".cal-integration input"), apply]) {
      await control.scrollIntoViewIfNeeded()
      const box = await control.boundingBox()
      assert(box && box.width > 0 && box.height > 0 && box.y >= 0 && box.y + box.height <= height, `review controls reachable at ${name}`)
    }
    await page.screenshot({ path: join(out, `${name}.png`) })
  }
  await page.setViewportSize({ width: 1800, height: 1000 })
  await page.locator(".cal-integration input").check()
  await apply.click()
  await page.waitForFunction(async take => {
    /** @type {import('../src/types').TakesSnapshot} */
    const snapshot = await (await fetch("takes.json")).json()
    return !snapshot.takes.some(item => item.take === take)
  }, take)
  assert(store.record(source), "source experiment stays available")
  assert.equal(store.record(take), null)
  const final = await browser.newPage()
  await final.goto(`${base}frame?part=${encodeURIComponent(checked.proposal.preview.part)}&state=${encodeURIComponent(checked.proposal.preview.state)}`)
  await final.getByRole("button", { name: "Chip 0", exact: true }).click()
  await final.getByRole("button", { name: "Chip 1", exact: true }).waitFor()
  const original = await browser.newPage()
  await original.goto(`${base}frame?part=${encodeURIComponent(ask.part)}`)
  assert.equal(await original.getByRole("button").evaluate(element => getComputedStyle(element).color), "rgb(0, 0, 255)")
  assert.deepEqual(errors, [])
  console.log(`ok: ${values.live ? "live agent" : "deterministic"} alternate, unchanged originals, interactions, review/apply, responsive controls. Screenshots: ${out}`)
} finally {
  await browser.close()
  await server?.close()
  rmSync(root, { recursive: true, force: true })
}
