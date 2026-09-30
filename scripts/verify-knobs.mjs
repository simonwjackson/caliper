#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 --command node
// @ts-check
/** Real Vite/Chromium knob behavior through CAL hooks. No product source changes. */
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

const { values } = parseArgs({ options: { modules: { type: "string" }, keep: { type: "boolean" } } })
assert(values.modules && process.env.CHROMIUM, "Pass --modules and set CHROMIUM")
const SHOTS = "/tmp/caliper-verify-knobs"
rmSync(SHOTS, { recursive: true, force: true })
mkdirSync(SHOTS, { recursive: true })
const root = mkdtempSync(join(tmpdir(), "caliper-knobs-"))
/** @param {string} file @param {string} code */
const write = (file, code) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), code) }
/** @param {string} file */
const read = file => readFileSync(join(root, file), "utf8")
const tokens = [
  '@import "./palette.css";', "", "/* The ground everything stands on. */", "@property --bg {", '  syntax: "<color>";', "  inherits: true;", "  initial-value: #000000;", "}", "",
  "@property --accent {", '  syntax: "<color>";', "  inherits: true;", "  initial-value: #ff77a8;", "}", "",
  "/** How many virtual pixels the short side holds. @label Pixel rows @min 180 @max 720 @step 10 */", "@property --rows {", '  syntax: "<number>";', "  inherits: true;", "  initial-value: 360;", "}", "",
  "@property --px {", '  syntax: "<length>";', "  inherits: true;", "  initial-value: 2px;", "}", "",
  "@property --cycle {", '  syntax: "<color>";', "  inherits: true;", "  initial-value: #ff004d;", "}", "",
  "/** @knob ignore */", "@property --hidden {", '  syntax: "<number>";', "  inherits: true;", "  initial-value: 1;", "}", "",
  ".theme {", "  --bg: var(--p8-black);", "  --accent: var(--p8-pink);", "}", "",
  ".theme > * {", "  --px: max(2px, calc(100cqh / var(--rows)));", "}", "",
  "@keyframes cycle {", "  to { --cycle: #ffa300; }", "}", "",
].join("\n")
const card = [
  ".card {", "  background: var(--bg);", "  color: var(--accent);", "  width: calc(var(--rows) * 1px);", "  height: 40px;", "  animation: cycle 1s paused;", "  opacity: var(--hidden);", "  --pad: 6px;", "  padding: var(--pad);", "  --unused: 3px;", "}", "",
  ".stage {", "  container: stage / inline-size;", "  width: 300px;", "}", "",
  "/** @label Narrow stage */", "@container stage (width < 280px) {", "  .card { height: 80px; }", "}", "",
  "/* A rule for a part that is not on the stage. */", "@container stage (width < 100px) {", "  .absent { height: 80px; }", "}", "",
].join("\n")
const files = {
  "package.json": JSON.stringify({ name: "knobs-consumer", type: "module", exports: { ".": "./src/index.ts" } }),
  "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
  "src/index.ts": 'import "./tokens.css"\nexport { App } from "./App"\n',
  "src/App.tsx": 'export const App = () => <main className="theme" />\n',
  "src/palette.css": ".theme {\n  --p8-black: #000000;\n  --p8-navy: #1d2b53;\n  --p8-pink: #ff77a8;\n}\n",
  "src/tokens.css": tokens, "src/card.css": card,
  "src/Card.tsx": 'import "./card.css"\nexport const Card = ({ label }: { label: string }) => <div className="stage"><div className="card">{label}</div></div>\n',
  "src/Card.part.tsx": 'import { Card } from "./Card"\nexport default function Part() { return <Card label="Hello" /> }\nexport const Loud = () => <Card label="HELLO" />\n',
}
for (const [file, code] of Object.entries(files)) write(file, code)
symlinkSync(resolve(values.modules), join(root, "node_modules"), "dir")
const server = await createServer({ root, cacheDir: join(root, ".vite"), configFile: false, logLevel: "silent", plugins: [caliper({ wrap: "theme" })], server: { host: "127.0.0.1", port: 0 } })
await server.listen()
const url = server.resolvedUrls?.local[0] ?? ""
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
/** @type {string[]} */
const errors = []
page.on("pageerror", error => errors.push(error.message))
/** @type {string[]} */
const writes = []
page.on("request", request => { if (request.url().includes("/knobs/write")) writes.push(request.postData() ?? "") })
/** @type {string[]} */
const passed = []
/** @type {string[]} */
const locateResponses = []
page.on("response", response => { if (response.url().includes("/knobs/locate")) void response.text().then(text => locateResponses.push(`${response.status()} ${text.slice(0, 1000)}`)) })
/** @param {string} name @param {() => Promise<void>} check */
async function step(name, check) {
  try { await check() } catch (error) {
    await page.screenshot({ path: join(SHOTS, "failed.png") }).catch(() => {})
    console.log(await page.locator(cal.knobs).textContent().catch(() => "Knobs not present"))
    console.log("Browser errors:", errors)
    console.log("Locate responses:", locateResponses.slice(-5))
    throw error
  }
  passed.push(name); console.log(`ok  ${name}`)
}
/** @param {string} label */
const row = label => page.locator(cal.knobs).locator(cal.knob).filter({ has: page.getByRole("spinbutton", { name: label, exact: true }) })
/** @param {() => boolean} condition */
async function disk(condition) { for (let attempt = 0; attempt < 100; attempt++) { if (condition()) return; await page.waitForTimeout(100) } assert(condition(), "disk did not reach expected source") }
const frame = async () => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const found = page.frames().find(candidate => candidate.url().includes("/__caliper/frame") && !candidate.url().includes("take="))
    if (found) { await found.waitForFunction(() => document.documentElement.dataset.caliperState === "Rendered"); return found }
    await page.waitForTimeout(100)
  }
  throw new Error("The real frame did not load.")
}
/** @param {string} selector @param {string} property */
const computed = async (selector, property) => (await frame()).evaluate(([selector, property]) => getComputedStyle(/** @type {Element} */ (document.querySelector(selector))).getPropertyValue(property), [selector, property])
try {
  await page.goto(`${url}__caliper/#part=src/Card.part.tsx&state=default`)
  await frame()
  await step("discovery preserves registered, plain and threshold inputs, and exclusions", async () => {
    const toggle = page.locator(`${cal.tool}[data-tool="knobs"]`)
    if (await page.locator(cal.knobs).count() === 0) await (await reveal(page, toggle)).click()
    await row("Pixel rows").waitFor()
    const knobs = page.locator(cal.knobs).locator(cal.knob)
    assert.equal(await knobs.count(), 7)
    for (const label of ["Pad", "Narrow stage", "Black", "Pink", "Pixel rows", "Bg", "Accent"]) assert((await knobs.filter({ hasText: label }).count()) > 0, label)
    const text = await page.locator(cal.knobs).textContent()
    assert.match(text ?? "", /--cycle.*@keyframes cycle animates it/)
    assert.match(text ?? "", /--hidden.*Hidden by @knob ignore/)
    assert.match(text ?? "", /--px.*Computed with max\(\)/)
    assert(!text?.includes("--unused"))
    assert(!text?.includes("width < 100px"))
    assert.equal(writes.length, 0)
  })
  await step("source links and hints retain declaration provenance and bounded slider", async () => {
    const rows = row("Pixel rows")
    assert.match(await rows.textContent() ?? "", /--rows.*@property/)
    assert.match(await rows.locator(cal.sourceFile).textContent() ?? "", /tokens\.css:20/)
    assert.match(await rows.textContent() ?? "", /How many virtual pixels the short side holds\./)
    assert.equal(await rows.locator(cal.knobSlider).getAttribute("max"), "720")
    assert.equal(await row("Pad").locator(cal.knobSlider).count(), 0, "unbounded input has no invented maximum")
  })
  await step("number input previews live, writes once on commit, and clears Saved", async () => {
    const input = row("Pixel rows").locator(cal.knobValue)
    await (await reveal(page, input)).fill("560")
    assert.equal(await computed(".card", "width"), "560px")
    assert.equal(read("src/tokens.css"), tokens)
    assert.equal(writes.length, 0)
    await input.blur()
    await disk(() => read("src/tokens.css").includes("initial-value: 560;"))
    assert.equal(writes.length, 1)
    assert.equal(read("src/tokens.css"), tokens.replace("initial-value: 360;", "initial-value: 560;"))
    await page.waitForTimeout(2000)
    assert.equal(await computed(".card", "width"), "560px")
    assert.match(await row("Pixel rows").locator(cal.knobStatus).textContent() ?? "", /^(Idle)?$/)
  })
  await step("threshold previews its rule and writes only the length", async () => {
    const input = row("Narrow stage").locator(cal.knobValue)
    const count = writes.length
    assert.equal(await computed(".card", "height"), "40px")
    await (await reveal(page, input)).fill("310")
    assert.equal(await computed(".card", "height"), "80px")
    assert.equal(read("src/card.css"), card)
    assert.equal(writes.length, count)
    await input.blur()
    await disk(() => read("src/card.css") !== card)
    assert.equal(writes.length, count + 1)
    assert.equal(read("src/card.css"), card.replace("(width < 280px)", "(width < 310px)"))
    await page.waitForTimeout(800)
    const conditions = await (await frame()).evaluate(() => [...document.styleSheets].filter(sheet => /** @type {Element | null} */ (sheet.ownerNode)?.getAttribute("data-vite-dev-id")?.endsWith("card.css")).flatMap(sheet => [...sheet.cssRules].flatMap(rule => "conditionText" in rule ? [String(rule.conditionText)] : [])))
    assert.deepEqual(conditions, ["stage (width < 310px)", "stage (width < 100px)"])
  })
  await step("plain custom property previews and commits once", async () => {
    const input = row("Pad").locator(cal.knobValue)
    const before = read("src/card.css")
    const count = writes.length
    await (await reveal(page, input)).fill("16")
    assert.equal(await computed(".card", "padding-top"), "16px")
    assert.equal(read("src/card.css"), before)
    assert.equal(writes.length, count)
    await input.blur()
    await disk(() => read("src/card.css") !== before)
    assert.equal(writes.length, count + 1)
    assert.equal(read("src/card.css"), before.replace("--pad: 6px;", "--pad: 16px;"))
  })
  await step("literal promotion requires a reviewed free name/home and preserves appearance", async () => {
    await reveal(page, page.locator(cal.literals))
    await page.locator(cal.literals).locator("summary").first().click()
    const literal = page.locator(cal.literal).filter({ hasText: "width: 300px" })
    await literal.waitFor()
    assert.equal(await page.locator(cal.literal).filter({ hasText: "height: 40px" }).count(), 0)
    await literal.locator(cal.literalOpen).click()
    const name = literal.locator(cal.literalName)
    assert.equal(await name.inputValue(), "--p8-stage-width")
    const homes = await literal.locator(cal.literalHome).locator("option").allTextContents()
    assert(homes.some(home => /^\.theme · tokens\.css:\d+$/.test(home)))
    assert(!homes.some(home => home.startsWith(".card")))
    await name.fill("--pad")
    assert.equal(await literal.locator(cal.promote).isDisabled(), true)
    assert.match(await literal.getByRole("alert").textContent() ?? "", /already a custom property here/)
    await name.fill("--stage-width")
    await literal.locator(cal.literalHome).selectOption({ label: /** @type {string} */ (homes.find(home => home.includes("tokens.css"))) })
    assert.match(await literal.textContent() ?? "", /Adds --stage-width: 300px; to \.theme/)
    const beforeCard = read("src/card.css"), beforeTokens = read("src/tokens.css")
    await literal.locator(cal.promote).click()
    await disk(() => read("src/card.css") !== beforeCard)
    assert.equal(read("src/card.css"), beforeCard.replace("width: 300px;", "width: var(--stage-width);"))
    assert.equal(read("src/tokens.css"), beforeTokens.replace("  --accent: var(--p8-pink);\n", "  --accent: var(--p8-pink);\n  --stage-width: 300px;\n"))
    await page.locator(cal.knob).filter({ hasText: "--stage-width" }).waitFor()
    assert.equal(await computed(".stage", "width"), "300px")
    assert.match(await page.locator(cal.literals).textContent() ?? "", /Made --stage-width in \.theme/)
    await page.locator(cal.literals).locator("summary").first().click()
  })
  await step("token choices retain sibling values and write a reference, not a color", async () => {
    const tokens = page.locator(cal.knob).filter({ has: page.locator(`${cal.knobToken}[data-token="--p8-navy"]`) }).filter({ hasText: "--bg" })
    const options = tokens.locator(cal.knobToken)
    assert.deepEqual(await options.evaluateAll(nodes => nodes.map(node => [node.getAttribute("data-token"), node.getAttribute("title")])), [["--p8-black", "#000000"], ["--p8-navy", "#1d2b53"], ["--p8-pink", "#ff77a8"]])
    await (await reveal(page, tokens.locator(`${cal.knobToken}[data-token="--p8-navy"]`))).click()
    await disk(() => read("src/tokens.css").includes("--bg: var(--p8-navy);"))
    await page.waitForTimeout(800)
    assert.equal(await computed(".card", "background-color"), "rgb(29, 43, 83)")
  })
  await step("HMR during input retains live preview and release refuses a stale source version", async () => {
    const input = row("Pixel rows").locator(cal.knobValue)
    await (await reveal(page, input)).fill("460")
    const external = read("src/tokens.css").replace("/* The ground everything stands on. */", "/* The ground, edited elsewhere. */")
    write("src/tokens.css", external)
    await page.waitForTimeout(700)
    assert.equal(await computed(".card", "width"), "460px")
    await input.blur()
    await row("Pixel rows").locator(cal.knobStatus).filter({ hasText: /changed/i }).waitFor()
    assert.equal(read("src/tokens.css"), external)
    await page.waitForTimeout(800)
    assert.equal(await computed(".card", "width"), "560px")
  })
  await step("take-scoped input writes only the take copy", async () => {
    const take = createTakeStore(root).create({ part: "src/Card.part.tsx", state: "default", device: "rg353m" })
    await page.goto(`${url}__caliper/#part=src/Card.part.tsx&state=takes:default&take=${take}`)
    await page.reload()
    await row("Pixel rows").waitFor()
    assert.match(await page.locator(cal.knobs).textContent() ?? "", new RegExp(`Take ${take}`))
    const before = read("src/tokens.css")
    const input = row("Pixel rows").locator(cal.knobValue)
    await (await reveal(page, input)).fill("400")
    await input.blur()
    const copy = join(root, ".caliper/takes", take, "src/tokens.css")
    await disk(() => { try { return readFileSync(copy, "utf8").includes("initial-value: 400;") } catch { return false } })
    assert.equal(read("src/tokens.css"), before)
    await page.waitForFunction(({ selector, take }) => [...document.querySelectorAll(selector)].some(node => {
      const iframe = /** @type {HTMLIFrameElement} */ (node)
      const card = iframe.getAttribute("src")?.includes(`take=${take}`) ? iframe.contentDocument?.querySelector(".card") : null
      return card && iframe.contentWindow?.getComputedStyle(card).width === "400px"
    }), { selector: cal.frame, take })
    assert.equal(await computed(".card", "width"), "560px")
  })
  await step("controls remain reachable at five sizes and resizing writes nothing", async () => {
    await page.goto(`${url}__caliper/#part=src/Card.part.tsx&state=default`)
    const count = writes.length, before = read("src/tokens.css")
    for (const [width, height] of [[1600, 1000], [1030, 572], [800, 900], [1280, 300], [412, 660]]) {
      await page.setViewportSize({ width, height })
      await (await reveal(page, row("Pixel rows").locator(cal.knobValue))).focus()
      assert.equal(await row("Pixel rows").locator(cal.knobValue).isVisible(), true)
      await page.screenshot({ path: join(SHOTS, `size-${width}x${height}.png`) })
    }
    assert.equal(writes.length, count)
    assert.equal(read("src/tokens.css"), before)
  })
  deferLayout(["Knobs dock beside the canvas; sheet placement below the preview", "Side-sheet height budget and preview minimum height", "No overlay, page-level hidden scroll or Takes-panel bleed-through", "Label pointer scrubbing and focus/capture in the final UI; reference tests input/commit actions instead"])
  assert.deepEqual(errors, [], "the chrome threw no errors")
  console.log(`\n${passed.length} behavior checks passed. Screenshots: ${SHOTS}`)
} finally {
  await browser.close(); await server.close()
  if (!values.keep) rmSync(root, { recursive: true, force: true }); else console.log(`Kept ${root}`)
}
