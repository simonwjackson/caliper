#!/usr/bin/env -S nix shell nixpkgs#nodejs --command node
/**
 * Exercise the Knobs panel with real React, Vite and Chromium, in a temporary
 * project shaped like Pico's tokens. No product source is changed. Pass a
 * React project's node_modules:
 *
 *   CHROMIUM=/path/to/chromium node scripts/verify-knobs.mjs --modules /path/to/node_modules
 *
 * It checks discovery and its refusals, a live drag that writes the file once
 * on release, the token picker, a knob in a take's frame, a conflicting save
 * during a drag, and the panel at five window sizes. Screenshots go to
 * /tmp/caliper-verify-knobs.
 */
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { createServer } from "vite"
import { chromium } from "playwright-core"
import { caliper } from "../src/plugin.js"
import { createTakeStore } from "../src/takes/store.js"

const { values } = parseArgs({ options: { modules: { type: "string" }, keep: { type: "boolean" } } })
assert(values.modules && process.env.CHROMIUM, "Pass --modules and set CHROMIUM")
const SHOTS = "/tmp/caliper-verify-knobs"
rmSync(SHOTS, { recursive: true, force: true })
mkdirSync(SHOTS, { recursive: true })
const root = mkdtempSync(join(tmpdir(), "caliper-knobs-"))
/** @param {string} file @param {string} code */
const write = (file, code) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), code)
}
/** @param {string} file */
const read = file => readFileSync(join(root, file), "utf8")

const tokens = [
  '@import "./palette.css";',
  "",
  "/* The ground everything stands on. */",
  "@property --bg {",
  '  syntax: "<color>";',
  "  inherits: true;",
  "  initial-value: #000000;",
  "}",
  "",
  "@property --accent {",
  '  syntax: "<color>";',
  "  inherits: true;",
  "  initial-value: #ff77a8;",
  "}",
  "",
  "/** How many virtual pixels the short side holds. @label Pixel rows @min 180 @max 720 @step 10 */",
  "@property --rows {",
  '  syntax: "<number>";',
  "  inherits: true;",
  "  initial-value: 360;",
  "}",
  "",
  "@property --px {",
  '  syntax: "<length>";',
  "  inherits: true;",
  "  initial-value: 2px;",
  "}",
  "",
  "@property --cycle {",
  '  syntax: "<color>";',
  "  inherits: true;",
  "  initial-value: #ff004d;",
  "}",
  "",
  "/** @knob ignore */",
  "@property --hidden {",
  '  syntax: "<number>";',
  "  inherits: true;",
  "  initial-value: 1;",
  "}",
  "",
  ".theme {",
  "  --bg: var(--p8-black);",
  "  --accent: var(--p8-pink);",
  "}",
  "",
  ".theme > * {",
  "  --px: max(2px, calc(100cqh / var(--rows)));",
  "}",
  "",
  "@keyframes cycle {",
  "  to { --cycle: #ffa300; }",
  "}",
  "",
].join("\n")

const card = [
  ".card {",
  "  background: var(--bg);",
  "  color: var(--accent);",
  "  width: calc(var(--rows) * 1px);",
  "  height: 40px;",
  "  animation: cycle 1s paused;",
  "  opacity: var(--hidden);",
  "  --pad: 6px;",
  "  padding: var(--pad);",
  "  --unused: 3px;",
  "}",
  "",
  ".stage {",
  "  container: stage / inline-size;",
  "  width: 300px;",
  "}",
  "",
  "/** @label Narrow stage */",
  "@container stage (width < 280px) {",
  "  .card { height: 80px; }",
  "}",
  "",
  "/* A rule for a part that is not on the stage. */",
  "@container stage (width < 100px) {",
  "  .absent { height: 80px; }",
  "}",
  "",
].join("\n")

const files = {
  "package.json": JSON.stringify({ name: "knobs-consumer", type: "module", exports: { ".": "./src/index.ts" } }),
  "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
  "src/index.ts": 'import "./tokens.css"\nexport { App } from "./App"\n',
  "src/App.tsx": "export const App = () => <main className=\"theme\" />\n",
  "src/palette.css": ".theme {\n  --p8-black: #000000;\n  --p8-navy: #1d2b53;\n  --p8-pink: #ff77a8;\n}\n",
  "src/tokens.css": tokens,
  "src/card.css": card,
  "src/Card.tsx": 'import "./card.css"\nexport const Card = ({ label }: { label: string }) => <div className="stage"><div className="card">{label}</div></div>\n',
  "src/Card.part.tsx": 'import { Card } from "./Card"\nexport default function Part() { return <Card label="Hello" /> }\nexport const Loud = () => <Card label="HELLO" />\n',
}
for (const [file, code] of Object.entries(files)) write(file, code)
symlinkSync(resolve(values.modules), join(root, "node_modules"), "dir")

const server = await createServer({
  root, cacheDir: join(root, ".vite"), configFile: false, logLevel: "silent",
  plugins: [caliper({ wrap: "theme" })], server: { host: "127.0.0.1", port: 0 },
})
await server.listen()
const url = server.resolvedUrls?.local[0] ?? ""
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
/** @type {string[]} */
const passed = []
/** @type {import("playwright-core").Page | null} */
let shown = null
/** @param {string} name @param {() => Promise<void>} check */
async function step(name, check) {
  try {
    await check()
  } catch (error) {
    if (shown) {
      await shown.screenshot({ path: join(SHOTS, "failed.png") }).catch(() => {})
      console.log(`Knobs panel at the failure:\n${await shown.locator(".cal-knobs").evaluate(node => [...node.querySelectorAll("p, li")].map(line => line.textContent).join("\n")).catch(() => "(none)")}`)
    }
    throw error
  }
  passed.push(name)
  console.log(`ok  ${name}`)
}

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  shown = page
  /** @type {string[]} */
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  // Start with the panel closed, once: later loads keep what the checks chose.
  await page.addInitScript(() => {
    if (sessionStorage.getItem("knobs-verify")) return
    sessionStorage.setItem("knobs-verify", "started")
    localStorage.setItem("caliper:knobs-open", "false")
  })
  await page.goto(`${url}__caliper/#part=src/Card.part.tsx&state=default`)
  const frame = async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const found = page.frames().find(candidate => candidate.url().includes("/__caliper/frame") && !candidate.url().includes("take="))
      if (found) {
        await found.waitForFunction(() => document.documentElement.dataset.caliperState === "Rendered")
        return found
      }
      await page.waitForTimeout(100)
    }
    throw new Error("The real frame did not load.")
  }
  const cardWidth = async () => (await frame()).evaluate(() => getComputedStyle(/** @type {Element} */ (document.querySelector(".card"))).width)
  const cardBackground = async () => (await frame()).evaluate(() => getComputedStyle(/** @type {Element} */ (document.querySelector(".card"))).backgroundColor)
  await frame()

  await step("the Knobs button opens the panel beside the stage, and finds the design inputs the part uses", async () => {
    await page.getByRole("button", { name: "Knobs" }).click()
    await page.locator(".cal-knob").nth(2).waitFor()
    const labels = await page.locator(".cal-knob-label").allInnerTexts()
    // In source order, by file. The threshold of a rule for no element on the stage is not a knob,
    // and neither are --unused and --p8-navy, which the part does not read.
    assert.deepEqual(labels, ["Pad", "Narrow stage", "Black", "Pink", "Pixel rows", "Bg", "Accent"])
    const box = await page.locator(".cal-knobs").boundingBox()
    const stage = await page.locator(".cal-stage").boundingBox()
    assert(box && stage && box.x >= stage.x + stage.width - 1, "the panel sits right of the stage")
    assert.equal(await page.locator(".cal-knobs-target").innerText(), "Real files")
    await page.screenshot({ path: join(SHOTS, "1-docked.png") })
  })

  await step("outputs, animated values and ignored ones are listed as not knobs, with the reason", async () => {
    await page.locator(".cal-knobs-skipped summary").click()
    const text = await page.locator(".cal-knobs-skipped").innerText()
    assert.match(text, /--cycle[^\n]*@keyframes cycle animates it/)
    assert.match(text, /--hidden[^\n]*Hidden by @knob ignore/)
    assert.match(text, /--px[^\n]*Computed with max\(\)/)
  })

  await step("a knob names its declaration and the file it lives in, with the hint's range", async () => {
    const rows = page.locator(".cal-knob", { hasText: "Pixel rows" })
    assert.match(await rows.locator(".cal-knob-site").innerText(), /--rows @property · tokens\.css:20/)
    assert.equal(await rows.locator(".cal-knob-note").innerText(), "How many virtual pixels the short side holds.")
    assert.equal(await rows.locator(".cal-knob-range").getAttribute("max"), "720")
    assert.match(await page.locator(".cal-knob", { hasText: "Bg" }).locator(".cal-knob-site").innerText(), /--bg in \.theme · tokens\.css:43/)
  })

  await step("dragging the label changes every frame live, and writes the file once, on release", async () => {
    const label = page.locator(".cal-knob-label", { hasText: "Pixel rows" })
    const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await label.boundingBox())
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + 10, y)
    await page.mouse.down()
    for (let dx = 4; dx <= 40; dx += 4) await page.mouse.move(box.x + 10 + dx, y)
    await page.waitForTimeout(100)
    assert.equal(await cardWidth(), "560px", "the frame shows the dragged value")
    assert.match(read("src/tokens.css"), /initial-value: 360;/, "no write during the drag")
    await page.mouse.up()
    await page.waitForFunction(() => document.querySelector(".cal-knob[data-status='Saved']") !== null || document.querySelector(".cal-knob-number[value='560']") !== null)
    for (let attempt = 0; attempt < 50 && !read("src/tokens.css").includes("initial-value: 560;"); attempt++) await page.waitForTimeout(100)
    assert.equal(read("src/tokens.css"), tokens.replace("initial-value: 360;", "initial-value: 560;"), "only the one value changed")
    await page.waitForTimeout(800)
    assert.equal(await cardWidth(), "560px", "the reloaded stylesheet holds the value")
    assert.equal(await page.locator(".cal-knob", { hasText: "Pixel rows" }).locator(".cal-knob-number").inputValue(), "560")
    await page.waitForTimeout(2000)
    assert.equal(await page.locator(".cal-knob", { hasText: "Pixel rows" }).locator(".cal-knob-status").textContent(), "", "Saved goes away")
  })

  await step("a @container threshold previews live by replacing its rule, and writes the one length on release", async () => {
    const cardHeight = async () => (await frame()).evaluate(() => getComputedStyle(/** @type {Element} */ (document.querySelector(".card"))).height)
    const row = page.locator(".cal-knob", { hasText: "Narrow stage" })
    assert.match(await row.locator(".cal-knob-site").innerText(), /@container stage \(width < 280px\) · card\.css:19/)
    assert.equal(await row.locator(".cal-knob-number").inputValue(), "280")
    assert.equal(await row.locator(".cal-knob-unit").innerText(), "px")
    assert.equal(await cardHeight(), "40px", "the stage is wider than the threshold")
    const label = row.locator(".cal-knob-label")
    const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await label.boundingBox())
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + 10, y)
    await page.mouse.down()
    for (let dx = 4; dx <= 60; dx += 4) await page.mouse.move(box.x + 10 + dx, y)
    await page.waitForTimeout(100)
    assert.equal(await cardHeight(), "80px", "the 300px stage is now narrower than the threshold")
    assert.equal(read("src/card.css"), card, "no write during the drag")
    await page.mouse.up()
    for (let attempt = 0; attempt < 50 && read("src/card.css") === card; attempt++) await page.waitForTimeout(100)
    assert.equal(read("src/card.css"), card.replace("(width < 280px)", "(width < 310px)"), "only the one length changed")
    await page.waitForTimeout(800)
    assert.equal(await cardHeight(), "80px", "the reloaded stylesheet holds the threshold")
    const conditions = await (await frame()).evaluate(() => [...document.styleSheets]
      .filter(sheet => /** @type {Element | null} */ (sheet.ownerNode)?.getAttribute("data-vite-dev-id")?.endsWith("card.css"))
      .flatMap(sheet => [...sheet.cssRules].flatMap(rule => ("conditionText" in rule ? [String(rule.conditionText)] : []))))
    assert.deepEqual(conditions, ["stage (width < 310px)", "stage (width < 100px)"], "one rule per condition, in its place")
  })

  await step("a plain custom property the part reads is a knob, with the control its value asks for", async () => {
    const cardPadding = async () => (await frame()).evaluate(() => getComputedStyle(/** @type {Element} */ (document.querySelector(".card"))).paddingTop)
    const pad = page.locator(".cal-knob", { hasText: "Pad" })
    assert.match(await pad.locator(".cal-knob-site").innerText(), /--pad in \.card · card\.css:8/)
    assert.equal(await pad.locator(".cal-knob-unit").innerText(), "px")
    const black = page.locator('.cal-knob[data-knob$="#--p8-black"]')
    assert.equal(await black.getAttribute("data-control"), "Color")
    assert.equal(await black.getAttribute("data-origin"), "Plain")
    const label = pad.locator(".cal-knob-label")
    const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await label.boundingBox())
    const y = box.y + box.height / 2
    const before = read("src/card.css")
    await page.mouse.move(box.x + 10, y)
    await page.mouse.down()
    for (let dx = 4; dx <= 20; dx += 4) await page.mouse.move(box.x + 10 + dx, y)
    await page.waitForTimeout(100)
    assert.equal(await cardPadding(), "16px", "the frame shows the dragged value")
    assert.equal(read("src/card.css"), before, "no write during the drag")
    await page.mouse.up()
    for (let attempt = 0; attempt < 50 && read("src/card.css") === before; attempt++) await page.waitForTimeout(100)
    assert.equal(read("src/card.css"), before.replace("--pad: 6px;", "--pad: 16px;"), "only the one value changed")
    await page.waitForTimeout(800)
    assert.equal(await cardPadding(), "16px")
  })

  await step("a literal becomes a token after you confirm its name and rule, and then has a knob", async () => {
    const stageWidth = async () => (await frame()).evaluate(() => getComputedStyle(/** @type {Element} */ (document.querySelector(".stage"))).width)
    await page.locator(".cal-knobs-literals > summary").click()
    const row = page.locator(".cal-literal", { hasText: "width: 300px" })
    await row.waitFor()
    assert.match(await row.locator(".cal-knob-site").innerText(), /in \.stage · card\.css:15/)
    // A literal that another rule overrides here, or that changes nothing, is not offered.
    assert.equal(await page.locator(".cal-literal", { hasText: "height: 40px" }).count(), 0)
    await row.getByRole("button", { name: "Make a token" }).click()
    const name = row.locator("input.cal-literal-name")
    assert.equal(await name.inputValue(), "--p8-stage-width", "the suggestion uses the namespace of the first rule's tokens")
    const homes = await row.locator("select.cal-literal-home option").allInnerTexts()
    assert(homes.some(home => /^\.theme · tokens\.css:\d+$/.test(home)), `the tokens' rule is a home: ${homes.join(", ")}`)
    assert(!homes.some(home => home.startsWith(".card")), "a rule that does not reach .stage is not a home")
    await name.fill("--pad")
    assert.match(await row.locator(".cal-knob-problem").innerText(), /--pad is already a custom property here/)
    await name.fill("--stage-width")
    await row.locator("select.cal-literal-home").selectOption({ label: /** @type {string} */ (homes.find(home => home.includes("tokens.css"))) })
    assert.match(await row.locator(".cal-literal-preview").innerText(), /^Adds --stage-width: 300px; to \.theme \(tokens\.css:\d+\), and writes var\(--stage-width\) in its place \(card\.css:15\)\.$/)
    await page.screenshot({ path: join(SHOTS, "3-promote.png") })
    const card = read("src/card.css")
    const tokens = read("src/tokens.css")
    await row.getByRole("button", { name: "Create token" }).click()
    for (let attempt = 0; attempt < 50 && read("src/card.css") === card; attempt++) await page.waitForTimeout(100)
    assert.equal(read("src/card.css"), card.replace("width: 300px;", "width: var(--stage-width);"))
    assert.equal(read("src/tokens.css"), tokens.replace("  --accent: var(--p8-pink);\n", "  --accent: var(--p8-pink);\n  --stage-width: 300px;\n"))
    await page.locator('.cal-knob[data-knob$="#--stage-width"]').waitFor()
    assert.equal(await page.locator('.cal-knob[data-knob$="#--stage-width"]').getAttribute("data-origin"), "Plain")
    assert.equal(await stageWidth(), "300px", "the part looks the same")
    await page.locator(".cal-literal-notice").waitFor()
    assert.match(await page.locator(".cal-literal-notice").innerText(), /Made --stage-width in \.theme/)
    await page.locator(".cal-knobs-literals > summary").click()
  })

  await step("the token picker offers the sibling tokens and writes a reference, never a raw colour", async () => {
    await page.locator(".cal-knob", { hasText: "Bg" }).locator(".cal-knob-token").click()
    const choices = page.locator(".cal-knob", { hasText: "Bg" }).locator(".cal-knob-choice")
    assert.deepEqual(await choices.evaluateAll(nodes => nodes.map(node => node.getAttribute("title"))), ["--p8-black: #000000", "--p8-navy: #1d2b53", "--p8-pink: #ff77a8"])
    await page.screenshot({ path: join(SHOTS, "2-palette.png") })
    await choices.nth(1).click()
    for (let attempt = 0; attempt < 50 && !read("src/tokens.css").includes("--bg: var(--p8-navy);"); attempt++) await page.waitForTimeout(100)
    assert.match(read("src/tokens.css"), /--bg: var\(--p8-navy\);/)
    await page.waitForTimeout(800)
    assert.equal(await cardBackground(), "rgb(29, 43, 83)")
  })

  await step("a save to the same file during a drag keeps the live value, and release then refuses to write", async () => {
    await page.waitForTimeout(500)
    const label = page.locator(".cal-knob-label", { hasText: "Pixel rows" })
    const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await label.boundingBox())
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + 10, y)
    await page.mouse.down()
    for (let dx = -4; dx >= -20; dx -= 4) await page.mouse.move(box.x + 10 + dx, y)
    await page.waitForTimeout(100)
    assert.equal(await cardWidth(), "460px")
    const external = read("src/tokens.css").replace("/* The ground everything stands on. */", "/* The ground, edited elsewhere. */")
    write("src/tokens.css", external)
    await page.waitForTimeout(700)
    assert.equal(await cardWidth(), "460px", "the observer put the live value back after Vite reloaded the sheet")
    await page.mouse.up()
    await page.locator(".cal-knob[data-status='Conflict']").waitFor()
    assert.equal(read("src/tokens.css"), external, "the other save stays, and the knob wrote nothing")
    await page.waitForTimeout(800)
    assert.equal(await cardWidth(), "560px", "the frame shows the file's value again")
    await page.screenshot({ path: join(SHOTS, "3-conflict.png") })
  })

  await step("in a take's frame, a knob writes the take's copy and leaves the real file", async () => {
    const take = createTakeStore(root).create({ part: "src/Card.part.tsx", state: "default", device: "rg353m" })
    await page.goto(`${url}__caliper/#part=src/Card.part.tsx&state=takes:default&take=${take}`)
    await page.reload()
    await page.locator(".cal-knobs-target", { hasText: `Take ${take}` }).waitFor()
    await page.locator(".cal-knob", { hasText: "Pixel rows" }).waitFor()
    const before = read("src/tokens.css")
    const input = page.locator(".cal-knob", { hasText: "Pixel rows" }).locator(".cal-knob-number")
    await input.fill("400")
    await input.press("Enter")
    await input.blur()
    const copy = join(root, ".caliper/takes", take, "src/tokens.css")
    for (let attempt = 0; attempt < 50; attempt++) {
      try { if (readFileSync(copy, "utf8").includes("initial-value: 400;")) break } catch { /* not yet */ }
      await page.waitForTimeout(100)
    }
    assert.match(readFileSync(copy, "utf8"), /initial-value: 400;/)
    assert.equal(read("src/tokens.css"), before)
    // The first write to a take makes its copy, so the take's frame may reload.
    await page.waitForFunction(take => [...document.querySelectorAll("iframe.cal-frame")].some(iframe => {
      const frame = /** @type {HTMLIFrameElement} */ (iframe)
      const card = frame.getAttribute("src")?.includes(`take=${take}`) ? frame.contentDocument?.querySelector(".card") : null
      return card ? frame.contentWindow?.getComputedStyle(card).width === "400px" : false
    }), take, { timeout: 10000 })
    assert.equal(await cardWidth(), "560px", "the original frame keeps the real value")
    await page.waitForTimeout(2500)
    assert.equal(await page.locator(".cal-knob", { hasText: "Pixel rows" }).locator(".cal-knob-status").textContent(), "", "Saved goes away in a take too")
    await page.screenshot({ path: join(SHOTS, "4-take.png") })
  })

  await step("every size keeps the knobs one tap away, and the tabs keep the preview above them", async () => {
    await page.goto(`${url}__caliper/#part=src/Card.part.tsx&state=default`)
    const before = read("src/tokens.css")
    /** @type {string[]} */
    const writes = []
    page.on("request", request => { if (request.url().includes("/knobs/write")) writes.push(request.url()) })
    for (const [width, height] of [[1600, 1000], [1030, 572], [800, 900], [1280, 300], [412, 660]]) {
      await page.setViewportSize({ width, height })
      await page.waitForTimeout(300)
      const tabs = await page.locator(".cal").evaluate(node => node.hasAttribute("data-tabs"))
      const toggle = page.locator(".cal-knobs-toggle")
      assert(await toggle.isVisible(), `the Knobs button shows at ${width}×${height}`)
      if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
      await page.locator(".cal-knob").first().waitFor()
      const panel = await page.locator(".cal-knobs").boundingBox()
      const stage = await page.locator(".cal-stage").boundingBox()
      assert(panel && panel.height > 60 && panel.width > 200, `the panel is usable at ${width}×${height}`)
      assert(stage && stage.height > 80, `the stage shows at ${width}×${height}`)
      if (tabs) assert(panel.y >= stage.y + stage.height - 1, "in tabs, the knobs sit under the preview")
      assert.equal(await page.locator(".cal-takes").evaluate(node => getComputedStyle(node).display), "none", `the Takes panel does not show through at ${width}×${height}`)
      await page.screenshot({ path: join(SHOTS, `5-size-${width}x${height}.png`) })
    }
    assert.deepEqual(writes, [], "opening and resizing the panel writes nothing")
    assert.equal(read("src/tokens.css"), before)
  })

  assert.deepEqual(errors, [], "the chrome threw no errors")
  console.log(`\n${passed.length} checks passed. Screenshots: ${SHOTS}`)
} finally {
  await browser.close()
  await server.close()
  if (!values.keep) rmSync(root, { recursive: true, force: true })
  else console.log(`Kept ${root}`)
}
