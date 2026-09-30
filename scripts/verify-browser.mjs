#!/usr/bin/env -S nix shell nixpkgs#nodejs --command node
// @ts-check
/**
 * Check Caliper in a real browser against a running project dev server.
 *
 *   CHROMIUM=/path/to/chromium node scripts/verify-browser.mjs \
 *     --url http://127.0.0.1:5173 --root /path/to/project [--out /tmp/caliper-shots]
 *
 * It checks every part's wrapper, CSS and device viewport, tool/device/calibration
 * preferences, visible errors, source reload, named/all states and the render CLI.
 * Physical layout and fit gates are explicitly deferred on the unstyled reference.
 * It writes one temporary part file into the first part folder and removes it again.
 */
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { parseArgs } from "node:util"
import { chromium } from "playwright-core"
import { cal, deferLayout, reveal, waitFrames } from "./verify-helpers.mjs"

const { values: args } = parseArgs({
  options: {
    url: { type: "string" },
    root: { type: "string" },
    out: { type: "string", default: "/tmp/caliper-verify" },
  },
})
if (!args.url || !args.root) throw new Error("Pass --url and --root.")
const executablePath = process.env.CHROMIUM
if (!executablePath) throw new Error("Set CHROMIUM to a Chromium executable.")

const base = new URL("/__caliper/", args.url).href
const out = args.out ?? "/tmp/caliper-verify"
mkdirSync(out, { recursive: true })
/** @type {import("../src/types").Project} */
const project = await (await fetch(new URL("project.json", base))).json()
assert(project.parts.length > 0, "the project has parts")
const stylesheets = project.css._tag === "Failed" ? [] : project.css.value.stylesheets.map(sheet => sheet.file)
const wrapper = project.wrapper._tag === "Failed" ? [] : project.wrapper.value.elements
const PX_PER_MM = 4

const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
/** @type {string[]} */
const failures = []
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.on("pageerror", error => failures.push(`chrome page error: ${error.message}`))
  await page.goto(base)
  await page.evaluate(pxPerMm => {
    localStorage.clear()
    localStorage.setItem("caliper:px-per-mm", String(pxPerMm))
    localStorage.setItem("caliper:device", "rg353m")
    // This check measures the stage; the Takes panel has its own check.
    localStorage.setItem("caliper:takes-open", "false")
  }, PX_PER_MM)
  await page.goto(base)
  await page.locator(`${cal.nav} ${cal.part}`).first().waitFor()
  assert.equal(await page.locator(`${cal.nav} ${cal.part}`).count(), project.parts.length, "the list shows every part")

  deferLayout([
    "Closed/open/reloaded Takes panel hidden/display agreement and preview space recovery (Takes now lives on canvas)",
    "Zero page/root overflow and noncollapsed drawn preview at 12 sizes including both sides of 44rem and 72rem",
    "Tool/composer viewport containment at those sizes",
    "72mm calibrated frame width; True size/Scaled labels and ODIN fit under height budgets",
    "85.6mm drawn calibration outline",
    "All-state frames equal true-size widths and one row at 1600px; one scrolling column at 700px",
  ])
  const rem = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).fontSize))
  const sizes = [{ width:1600,height:1000 }, { width:1000,height:750 }, { width:755,height:1000 }, { width:412,height:620 }, { width:320,height:480 }, { width:1280,height:300 }, ...[44,72].flatMap(limit => [-1,0,1].map(offset => ({ width:Math.round(limit*rem)+offset,height:900 })))]
  for (const size of sizes) {
    await page.setViewportSize(size)
    for (const tool of ["takes", "preview"]) {
      // The desk rail has no Preview: nothing covers the canvas there (decision 34).
      if (tool === "preview" && await page.locator('.dr-root[data-tools="rail"]').count()) continue
      const control = await reveal(page, page.locator(`${cal.tool}[data-tool="${tool}"]`))
      await control.click()
      assert.equal(await control.getAttribute("aria-pressed"), "true", `${tool} remains selectable at ${size.width}x${size.height}`)
      await page.reload()
      await page.locator(`${cal.tool}[data-tool="${tool}"][aria-pressed="true"]`).waitFor()
      const selected = await page.locator(`${cal.nav} ${cal.part}[aria-current="true"]`).getAttribute("data-part")
      assert(selected)
      assert.equal((await frameResult(page, selected)).state, "Rendered")
      await page.screenshot({ path:join(out,`behavior-${size.width}x${size.height}-${tool}.png`) })
    }
  }
  await page.setViewportSize({ width:1600,height:1000 })
  console.log(`tool selection and reload checked at ${sizes.length} sizes; layout NOT PROVEN`)

  // Every part renders, inside the wrapper, with the global CSS loaded.
  for (const part of project.parts) {
    await page.locator(`${cal.nav} ${cal.part}[data-part="${part.file}"]`).click()
    await page.locator(`${cal.nav} ${cal.state}[data-part="${part.file}"][data-state="default"]`).click()
    const result = await frameResult(page, part.file)
    if (result.state !== "Rendered") failures.push(`${part.file}: ${result.state} ${JSON.stringify(result.problems)}`)
    if (!result.wrapperOk) failures.push(`${part.file}: wrapper elements missing`)
    if (result.missingCss.length) failures.push(`${part.file}: stylesheets not loaded: ${result.missingCss.join(", ")}`)
    if (result.innerWidth !== 640) failures.push(`${part.file}: frame viewport ${result.innerWidth}px, expected 640`)
  }
  console.log(`rendered ${project.parts.length} parts`)
  await page.locator(`${cal.nav} ${cal.part}[data-part="${project.parts[0]?.file}"]`).click()
  await page.locator(`${cal.nav} ${cal.state}[data-part="${project.parts[0]?.file}"][data-state="default"]`).click()
  await frameResult(page, project.parts[0]?.file ?? "")
  await page.screenshot({ path: join(out, "rg353m-true-size.png") })

  // Device viewport truth and saved calibration remain behavioral gates.
  await page.locator(`${cal.device}[data-device="odin2portal"]`).click()
  await page.waitForFunction(selector => /** @type {HTMLIFrameElement | null} */ (document.querySelector(selector))?.contentWindow?.innerWidth === 1920, cal.frame)
  assert.match(page.url(), /device=odin2portal/)
  await page.reload()
  await page.locator(`${cal.device}[data-device="odin2portal"][aria-pressed="true"]`).waitFor()
  await page.locator(`${cal.tool}[data-tool="calibrate"]`).click()
  const scale = page.locator(cal.calibrationScale)
  await scale.press("ArrowRight")
  const calibrated = await scale.inputValue()
  assert.equal(Number(calibrated), PX_PER_MM + 0.01, "keyboard input changes calibration by one step")
  assert.equal(await page.evaluate(() => localStorage.getItem("caliper:px-per-mm")), calibrated)
  await page.locator(cal.calibrationClose).click()
  await page.reload()
  await page.locator(`${cal.tool}[data-tool="calibrate"]`).click()
  assert.equal(await scale.inputValue(), calibrated, "calibration survives reload")
  await page.locator(cal.calibrationReset).click()
  assert.equal(await page.evaluate(() => localStorage.getItem("caliper:px-per-mm")), null)
  // The canvas and its caption hide behind the calibration card; the card states the scale is assumed.
  assert.match(await page.locator(cal.calibration).innerText(), /no calibration/i)
  await scale.press("Home")
  await scale.press("ArrowRight")
  assert.equal(await scale.inputValue(), "2.01", "reset leaves calibration editable")
  await page.screenshot({ path: join(out, "calibration.png") })
  await page.locator(cal.calibrationClose).click()
  await page.locator(`${cal.device}[data-device="rg353m"]`).click()

  // A part that throws shows its error; a save reloads the frame.
  const folder = dirname(project.parts[0]?.file ?? "src/x")
  const probe = `${folder}/CaliperProbe.verify.part.tsx`
  const probePath = join(args.root, probe)
  writeFileSync(probePath, 'export const name = "Caliper probe"\nexport default function Probe(): never { throw new Error("probe exploded") }\n')
  try {
    const probeButton = page.locator(`${cal.nav} ${cal.part}[data-part="${probe}"]`)
    await probeButton.waitFor({ timeout: 5000 })
    await probeButton.click()
    const thrown = await frameResult(page, probe)
    assert.equal(thrown.state, "Failed", "a throwing part fails visibly")
    assert.match(await page.locator(`${cal.frameProblem}[role="alert"]`).first().innerText(), /probe exploded/)
    await page.screenshot({ path: join(out, "error.png") })

    writeFileSync(probePath, 'export const name = "Caliper probe"\nexport default function Probe() { return <p>probe fixed</p> }\n')
    await page.waitForFunction(() => {
      const doc = /** @type {HTMLIFrameElement} */ (document.querySelector('[data-cal="frame"]')).contentDocument
      return doc?.documentElement?.dataset.caliperState === "Rendered" && doc.body?.innerText.includes("probe fixed")
    }, undefined, { timeout: 10_000 })
    assert.equal(await page.locator(`${cal.frameProblem}[role="alert"]`).count(), 0, "the error clears after the fix")
    console.log("a save reloaded the frame")

    // A save that adds a named state shows it under the part, and picking it renders it.
    writeFileSync(probePath, [
      'export const name = "Caliper probe"',
      "export default function Probe() { return <p>probe fixed</p> }",
      "export const NoResults = () => <p>probe empty state</p>",
      "",
    ].join("\n"))
    const probeStates = page.locator(cal.nav)
    const stateButton = probeStates.locator(`${cal.state}[data-part="${probe}"][data-state="NoResults"]`)
    await stateButton.waitFor({ timeout: 5000 })
    assert.equal(await stateButton.innerText(), "No results", "the state label comes from the export name")
    await stateButton.click()
    await page.waitForFunction(() => {
      const doc = /** @type {HTMLIFrameElement} */ (document.querySelector('[data-cal="frame"]')).contentDocument
      return doc?.documentElement?.dataset.caliperState === "Rendered" && doc.body?.innerText.includes("probe empty state")
    }, undefined, { timeout: 10_000 })
    // The heading names the part; the state sits beside it in the same header.
    assert.match(await page.locator(cal.canvas).getByRole("heading", { level:1 }).innerText(), /^Caliper probe$/)
    assert.match(await page.locator(cal.canvas).locator("header").first().innerText(), /Caliper probe\s+No results/)
    assert.match(page.url(), /state=NoResults/, "the URL keeps the state")
    await page.screenshot({ path: join(out, "state.png") })
    console.log("a named state rendered")

    // "All states" shows every state side by side, at one size, and a failing
    // state fails in its own cell only.
    writeFileSync(probePath, [
      'export const name = "Caliper probe"',
      "export default function Probe() { return <p>probe fixed</p> }",
      "export const NoResults = () => <p>probe empty state</p>",
      'export function Broken(): never { throw new Error("broken state exploded") }',
      "",
    ].join("\n"))
    await probeStates.locator(`${cal.state}[data-part="${probe}"][data-state="Broken"]`).waitFor({ timeout: 5000 })
    assert.equal(await page.locator(`${cal.state}[data-state="*"]`).count(), 0, "there is no separate All states row")
    await probeButton.click()
    await waitFrames(page, 3, "settled")
    const cells = await page.locator(cal.frame).evaluateAll(nodes => nodes.map(node => {
      const iframe = /** @type {HTMLIFrameElement} */ (node)
      return { state:iframe.dataset.state, frame:iframe.contentDocument?.documentElement.dataset.caliperState, label:iframe.title }
    }))
    assert.deepEqual(cells.map(cell => [cell.state, cell.frame, cell.label]), [["default","Rendered","Default"],["NoResults","Rendered","No results"],["Broken","Failed","Broken"]])
    assert.match(page.url(), /state=\*/, "the URL keeps the grid")
    assert.match(await page.locator(`${cal.frameProblem}[role="alert"]`).first().innerText(), /broken state exploded/)
    await page.screenshot({ path: join(out, "grid.png") })

    // A narrow window puts the frames in one column that scrolls. They shrink only
    // as far as one frame must to fit the stage, never because there are many.
    await page.setViewportSize({ width: 700, height: 700 })
    await page.waitForTimeout(200)
    await waitFrames(page, 3, "settled")
    assert.equal(await page.locator(cal.frame).count(), 3, "all states remain available at narrow width; column layout deferred")
    await page.screenshot({ path: join(out, "grid-narrow.png") })
    await page.setViewportSize({ width: 1600, height: 1000 })

    // A cell's label opens that state alone.
    await page.locator(cal.frameSelect).filter({ hasText: /^No results$/ }).click()
    await waitFrames(page, 1)
    assert.equal(await page.locator(cal.frame).getAttribute("data-state"), "NoResults", "the label selects this state alone")
    console.log("all states rendered and frame selection works; grid layout deferred")

    // caliper-render reports each state's verdict, problems and spill, and writes a PNG.
    writeFileSync(probePath, [
      'export const name = "Caliper probe"',
      "export default function Probe() { return <p>probe fixed</p> }",
      'export function Broken(): never { throw new Error("broken state exploded") }',
      "export const Nothing = () => null",
      "export const Wide = () => <div style={{ width: 2000, height: 10 }} />",
      // An entry animation that starts above the screen and lands inside it.
      "export const Landing = () => <><style>{'@keyframes cal-probe-drop { from { translate: 0 -200px } }'}</style><p style={{ animation: 'cal-probe-drop 10s steps(4, end)' }}>probe landed</p></>",
      "",
    ].join("\n"))
    await probeStates.locator(`${cal.state}[data-part="${probe}"][data-state="Wide"]`).waitFor({ timeout: 5000 })
    const cli = spawnSync(process.execPath, [
      join(dirname(fileURLToPath(import.meta.url)), "../bin/caliper-render.mjs"),
      "--url", args.url, "--part", probe, "--state", "*", "--out", join(out, "render"),
    ], { encoding: "utf8", env: process.env })
    assert.equal(cli.status, 1, `caliper-render exits 1 when a frame fails: ${cli.stderr}`)
    /** @type {{ results: Array<{ state: string, frame: string, png: string, problems: Array<{ title: string, detail: string }>, console: string[], spill: { right: number, elements: Array<{ element: string }> } | null, viewport: { width: number } }> }} */
    const rendered = JSON.parse(cli.stdout)
    assert.deepEqual(rendered.results.map(result => [result.state, result.frame]), [
      ["default", "Rendered"],
      ["Broken", "Failed"],
      ["Nothing", "Empty"],
      ["Wide", "Rendered"],
      ["Landing", "Rendered"],
    ])
    const [fine, broken, , wide, landing] = rendered.results
    assert.equal(fine?.viewport.width, 640, "the default device is the RG353M")
    assert.equal(fine?.spill, null)
    assert.deepEqual(fine?.console, [], "a clean frame has no browser errors")
    assert.match(broken?.problems[0]?.detail ?? "", /broken state exploded/)
    assert.equal(wide?.spill?.right, 2000, "the wide state reaches 2000 px")
    assert.match(wide?.spill?.elements[0]?.element ?? "", /^div/, "the spill names the wide element")
    assert.equal(landing?.spill, null, "an entry animation is measured where it ends, not at its first frame")
    for (const result of rendered.results) {
      const size = pngSize(result.png)
      assert.deepEqual(size, { width: 640, height: 480 }, `${result.state} PNG is the device's CSS viewport`)
    }
    console.log("caliper-render reported every state")
  } finally {
    rmSync(probePath, { force: true })
  }
  await page.locator(`${cal.nav} ${cal.part}[data-part="${probe}"]`).waitFor({ state: "detached", timeout: 5000 })
} finally {
  await browser.close()
}

if (failures.length) {
  console.error(failures.join("\n"))
  process.exit(1)
}
console.log(`all behavioral checks passed; layout NOT PROVEN; screenshots in ${out}`)

/**
 * Wait for the frame of `partFile` to settle, and read what it shows.
 *
 * @param {import("playwright-core").Page} page
 * @param {string} partFile
 */
async function frameResult(page, partFile) {
  // Vite can reload the frame once, for example after it optimizes a new
  // dependency. Read again when that happens.
  for (let attempt = 1; ; attempt++) {
    try {
      return await readFrame(page, partFile)
    } catch (error) {
      if (attempt >= 3 || !String(error).includes("Execution context was destroyed")) throw error
      console.log(`${partFile}: the frame reloaded while being read; reading again`)
    }
  }
}

/**
 * @param {import("playwright-core").Page} page
 * @param {string} partFile
 */
async function readFrame(page, partFile) {
  await page.waitForFunction(file => {
    const iframe = /** @type {HTMLIFrameElement | null} */ (document.querySelector('[data-cal="frame"]'))
    const doc = iframe?.contentDocument
    const state = doc?.documentElement?.dataset.caliperState
    // The document, not the src attribute: after a click the old document
    // stays until the new one commits.
    const shown = new URLSearchParams(doc?.location.search ?? "").get("part")
    return shown === file && doc?.readyState === "complete" && state && state !== "Loading"
  }, partFile, { timeout: 15_000 })
  const frame = page.frame({ url: /\/__caliper\/frame\?/ })
  assert(frame, "the device frame exists")
  return frame.evaluate(({ stylesheets, wrapper }) => {
    let node = document.getElementById("caliper-host")
    let wrapperOk = true
    for (const element of wrapper) {
      const child = node?.firstElementChild
      if (!child || child.tagName.toLowerCase() !== element.tag || child.className !== element.className) wrapperOk = false
      node = /** @type {HTMLElement | null} */ (child ?? null)
    }
    const loaded = [...document.querySelectorAll("style[data-vite-dev-id]")].map(style => style.getAttribute("data-vite-dev-id") ?? "")
    return {
      state: document.documentElement.dataset.caliperState,
      problems: [...document.querySelectorAll("#caliper-problem, #caliper-warning")].map(panel => /** @type {HTMLElement} */ (panel).innerText),
      wrapperOk,
      missingCss: stylesheets.filter(file => !loaded.some(id => id.endsWith(`/${file}`))),
      innerWidth: window.innerWidth,
    }
  }, { stylesheets, wrapper })
}

/**
 * Width and height from a PNG file's IHDR chunk.
 *
 * @param {string} file
 */
function pngSize(file) {
  const bytes = readFileSync(file)
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}
