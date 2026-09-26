#!/usr/bin/env node
// @ts-check
/**
 * Check Caliper in a real browser against a running project dev server.
 *
 *   CHROMIUM=/path/to/chromium node scripts/verify-browser.mjs \
 *     --url http://127.0.0.1:5173 --root /path/to/project [--out /tmp/caliper-shots]
 *
 * It renders every part, and checks that each one renders inside the wrapper
 * with the global CSS loaded; that the frame is drawn at true size after
 * calibration and labelled when scaled; that a part which throws shows its
 * error; and that a save reloads the frame. It writes one temporary part file
 * into the project's first part folder and removes it again.
 */
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { parseArgs } from "node:util"
import { chromium } from "playwright-core"

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
  }, PX_PER_MM)
  await page.goto(base)
  await page.locator(".cal-part").first().waitFor()
  assert.equal(await page.locator(".cal-part").count(), project.parts.length, "the list shows every part")

  // Every part renders, inside the wrapper, with the global CSS loaded.
  for (const part of project.parts) {
    await page.locator(`.cal-part[title="${part.file}"]`).click()
    const result = await frameResult(page, part.file)
    if (result.state !== "Rendered") failures.push(`${part.file}: ${result.state} ${JSON.stringify(result.problems)}`)
    if (!result.wrapperOk) failures.push(`${part.file}: wrapper elements missing`)
    if (result.missingCss.length) failures.push(`${part.file}: stylesheets not loaded: ${result.missingCss.join(", ")}`)
    if (result.innerWidth !== 640) failures.push(`${part.file}: frame viewport ${result.innerWidth}px, expected 640`)
  }
  console.log(`rendered ${project.parts.length} parts`)
  await page.locator(`.cal-part[title="${project.parts[0]?.file}"]`).click()
  await frameResult(page, project.parts[0]?.file ?? "")
  await page.screenshot({ path: join(out, "rg353m-true-size.png") })

  // True size: the screen box is the device's width in millimetres.
  const screen = await page.locator(".cal-screen").boundingBox()
  assert(screen, "the screen box is visible")
  assert(Math.abs(screen.width - 72 * PX_PER_MM) < 1, `RG353M drawn ${screen.width}px wide, expected ${72 * PX_PER_MM}`)
  assert.match(await page.locator(".cal-caption").innerText(), /True size/)

  // A small window scales the frame down and says so.
  await page.getByRole("radio", { name: "ODIN 2 PORTAL" }).click()
  await page.setViewportSize({ width: 800, height: 600 })
  await page.waitForTimeout(200)
  assert.match(await page.locator(".cal-caption").innerText(), /Scaled to \d+%/)
  await page.screenshot({ path: join(out, "odin-scaled.png") })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.waitForTimeout(200)
  assert.match(await page.locator(".cal-caption").innerText(), /True size/)
  await page.screenshot({ path: join(out, "odin-true-size.png") })

  // Calibration draws a credit card at the calibrated size.
  await page.getByRole("button", { name: "Calibrate" }).click()
  const card = await page.locator(".cal-card").boundingBox()
  assert(card && Math.abs(card.width - 85.6 * PX_PER_MM) < 1, "the card outline is 85.6 mm wide")
  await page.screenshot({ path: join(out, "calibration.png") })
  await page.getByRole("button", { name: "Done" }).click()
  await page.getByRole("radio", { name: "RG353M" }).click()

  // A part that throws shows its error; a save reloads the frame.
  const folder = dirname(project.parts[0]?.file ?? "src/x")
  const probe = `${folder}/CaliperProbe.verify.part.tsx`
  const probePath = join(args.root, probe)
  writeFileSync(probePath, 'export const name = "Caliper probe"\nexport default function Probe(): never { throw new Error("probe exploded") }\n')
  try {
    const probeButton = page.locator(`.cal-part[title="${probe}"]`)
    await probeButton.waitFor({ timeout: 5000 })
    await probeButton.click()
    const thrown = await frameResult(page, probe)
    assert.equal(thrown.state, "Failed", "a throwing part fails visibly")
    assert.match(await page.locator(".cal-problem-error").first().innerText(), /probe exploded/)
    await page.screenshot({ path: join(out, "error.png") })

    writeFileSync(probePath, 'export const name = "Caliper probe"\nexport default function Probe() { return <p>probe fixed</p> }\n')
    await page.waitForFunction(() => {
      const doc = /** @type {HTMLIFrameElement} */ (document.querySelector(".cal-frame")).contentDocument
      return doc?.documentElement?.dataset.caliperState === "Rendered" && doc.body?.innerText.includes("probe fixed")
    }, undefined, { timeout: 10_000 })
    assert.equal(await page.locator(".cal-problem-error").count(), 0, "the error clears after the fix")
    console.log("a save reloaded the frame")

    // A save that adds a named state shows it under the part, and picking it renders it.
    writeFileSync(probePath, [
      'export const name = "Caliper probe"',
      "export default function Probe() { return <p>probe fixed</p> }",
      "export const NoResults = () => <p>probe empty state</p>",
      "",
    ].join("\n"))
    const stateButton = page.locator('.cal-state[data-state="NoResults"]')
    await stateButton.waitFor({ timeout: 5000 })
    assert.equal(await stateButton.innerText(), "No results", "the state label comes from the export name")
    await stateButton.click()
    await page.waitForFunction(() => {
      const doc = /** @type {HTMLIFrameElement} */ (document.querySelector(".cal-frame")).contentDocument
      return doc?.documentElement?.dataset.caliperState === "Rendered" && doc.body?.innerText.includes("probe empty state")
    }, undefined, { timeout: 10_000 })
    assert.match(await page.locator(".cal-part-name").innerText(), /Caliper probe · No results/)
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
    const allButton = page.locator('.cal-state[data-state="*"]')
    await page.locator('.cal-state[data-state="Broken"]').waitFor({ timeout: 5000 })
    assert.equal(await allButton.innerText(), "All 3 states")
    await allButton.click()
    await page.waitForFunction(() => {
      const cells = [...document.querySelectorAll(".cal-cell")]
      return cells.length === 3 && cells.every(cell => /** @type {HTMLElement} */ (cell).dataset.frameState !== "Loading")
    }, undefined, { timeout: 15_000 })
    const cells = await page.locator(".cal-cell").evaluateAll(nodes => nodes.map(node => {
      const element = /** @type {HTMLElement} */ (node)
      const box = element.querySelector(".cal-screen")?.getBoundingClientRect()
      return { state: element.dataset.state, frame: element.dataset.frameState, label: element.querySelector(".cal-cell-label")?.textContent, width: box?.width, top: box?.top }
    }))
    assert.deepEqual(cells.map(cell => [cell.state, cell.frame, cell.label]), [
      ["default", "Rendered", "Default"],
      ["NoResults", "Rendered", "No results"],
      ["Broken", "Failed", "Broken"],
    ])
    for (const cell of cells) assert(Math.abs((cell.width ?? 0) - 72 * PX_PER_MM) < 1, `${cell.state} is drawn at true size`)
    assert.equal(new Set(cells.map(cell => cell.top)).size, 1, "three RG353M frames fit in one row at 1600 px")
    assert.match(page.url(), /state=\*/, "the URL keeps the grid")
    assert.match(await page.locator(".cal-problem-error").first().innerText(), /^Broken: /)
    assert.match(await page.locator(".cal-grid-caption").innerText(), /3 states side by side.*True size/)
    await page.screenshot({ path: join(out, "grid.png") })

    // A narrow window puts the frames in one column that scrolls. They shrink only
    // as far as one frame must to fit the stage, never because there are many.
    await page.setViewportSize({ width: 700, height: 700 })
    await page.waitForTimeout(200)
    const narrow = await page.locator(".cal-cell .cal-screen").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().left))
    assert.equal(new Set(narrow).size, 1, "one column in a narrow window")
    assert(await page.locator(".cal-grid").evaluate(grid => grid.scrollHeight > grid.clientHeight), "the grid scrolls")
    await page.screenshot({ path: join(out, "grid-narrow.png") })
    await page.setViewportSize({ width: 1600, height: 1000 })

    // A cell's label opens that state alone.
    await page.locator('.cal-cell[data-state="NoResults"] .cal-cell-label').click()
    await page.waitForFunction(() => {
      const doc = /** @type {HTMLIFrameElement} */ (document.querySelector(".cal-device .cal-frame")).contentDocument
      return doc?.body?.innerText.includes("probe empty state")
    }, undefined, { timeout: 10_000 })
    assert.equal(await page.locator(".cal-cell").count(), 0, "the grid frames are gone in the single view")
    console.log("all states rendered side by side")

    // caliper-render reports each state's verdict, problems and spill, and writes a PNG.
    writeFileSync(probePath, [
      'export const name = "Caliper probe"',
      "export default function Probe() { return <p>probe fixed</p> }",
      'export function Broken(): never { throw new Error("broken state exploded") }',
      "export const Nothing = () => null",
      "export const Wide = () => <div style={{ width: 2000, height: 10 }} />",
      "",
    ].join("\n"))
    await page.locator('.cal-state[data-state="Wide"]').waitFor({ timeout: 5000 })
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
    ])
    const [fine, broken, , wide] = rendered.results
    assert.equal(fine?.viewport.width, 640, "the default device is the RG353M")
    assert.equal(fine?.spill, null)
    assert.deepEqual(fine?.console, [], "a clean frame has no browser errors")
    assert.match(broken?.problems[0]?.detail ?? "", /broken state exploded/)
    assert.equal(wide?.spill?.right, 2000, "the wide state reaches 2000 px")
    assert.match(wide?.spill?.elements[0]?.element ?? "", /^div/, "the spill names the wide element")
    for (const result of rendered.results) {
      const size = pngSize(result.png)
      assert.deepEqual(size, { width: 640, height: 480 }, `${result.state} PNG is the device's CSS viewport`)
    }
    console.log("caliper-render reported every state")
  } finally {
    rmSync(probePath, { force: true })
  }
  await page.locator(`.cal-part[title="${probe}"]`).waitFor({ state: "detached", timeout: 5000 })
} finally {
  await browser.close()
}

if (failures.length) {
  console.error(failures.join("\n"))
  process.exit(1)
}
console.log(`all checks passed; screenshots in ${out}`)

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
    const iframe = /** @type {HTMLIFrameElement | null} */ (document.querySelector(".cal-frame"))
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
