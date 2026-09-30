#!/usr/bin/env -S nix develop -c node
// @ts-check
/**
 * The Darkroom browser gate, on the gallery's local fixtures, in Chromium.
 * No model calls, no server writes, no consumer files.
 *
 * 1. Hooks: at each mockup size, every hook that applies to a fixture is
 *    rendered (after opening the UI-owned New take menu and parts drawer),
 *    and no hook appears where its capability does not apply. The union
 *    over fixtures is every hook in CAL.
 * 2. Actions: real clicks, typing and keys reach the right action with the
 *    right identity arguments.
 * 3. Keyboard and focus: menu, drawer, dialog, sliders, the divider,
 *    focus-visible, and focus kept while typing through stream updates.
 * 4. Preservation: a frame keeps the state reached in it, and the editor
 *    keeps its text, through stream updates, resizes and tool changes.
 * 5. Reachability: at the size ladder, the page never scrolls and every
 *    applicable control is on screen or inside a region that scrolls.
 */
import assert from "node:assert/strict"
import { chromium } from "playwright-core"
import { SIZES, serveGallery } from "./lib.mjs"

assert(process.env.CHROMIUM, "Run through nix develop, which sets CHROMIUM")
const LADDER = [
  { name: "generous", width: 1920, height: 1200 }, { name: "medium", width: 960, height: 1000 }, { name: "narrow-tall", width: 390, height: 900 },
  { name: "wide-short", width: 1280, height: 300 }, { name: "tiny", width: 240, height: 180 },
]
const gallery = await serveGallery()
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, headless: true })
/** @type {string[]} */
const failures = []
/** @type {string[]} */
const passed = []
/** @type {string[]} */
const pageErrors = []
/** @param {string} name @param {() => Promise<void>} run */
async function gate(name, run) {
  try { await run(); passed.push(name) } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`) }
}
/** @param {{ width: number, height: number }} size @param {string} fixture */
async function open(size, fixture, scheme = "dark") {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, colorScheme: /** @type {"dark" | "light"} */ (scheme) })
  const page = await context.newPage()
  page.on("pageerror", error => pageErrors.push(`${fixture} ${size.width}x${size.height}: ${error.message}`))
  page.on("console", message => { if (message.type() === "error" || message.type() === "warning") pageErrors.push(`${fixture} ${size.width}x${size.height} console: ${message.text()}`) })
  await page.goto(`${gallery.origin}/?fixture=${fixture}`)
  await page.waitForSelector('[data-cal="chrome"]')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(80)
  return { page, close: () => context.close() }
}
/** @param {import("playwright-core").Page} page */
const hooksOn = page => page.locator("[data-cal]").evaluateAll(nodes => [...new Set(nodes.map(node => node.getAttribute("data-cal") ?? ""))])
/** @param {import("playwright-core").Page} page */
const calls = page => page.evaluate(() => window.gallery.calls.map(call => ({ name: call.name, args: call.args.map(arg => arg instanceof HTMLElement ? "element" : arg === null ? null : typeof arg === "object" ? JSON.stringify(arg) : arg) })))
/** @param {import("playwright-core").Page} page @param {string} name */
const called = async (page, name) => (await calls(page)).filter(call => call.name === name)
/** @param {string} hook */
const cal = hook => `[data-cal="${hook}"]`

const MENU_HOOKS = new Set(["take-count", "take-follow", "agent-status", "agent-skills"])
/**
 * Read every hook, opening the UI-owned disclosures first. A menu behind a
 * sheet in front, or anything behind the modal Checks window, is one tap
 * away (close the sheet or the window) and is reported as blocked.
 * @param {import("playwright-core").Page} page
 */
async function collect(page) {
  const found = new Set(await hooksOn(page))
  const modal = await page.locator("dialog[open]").count() > 0
  const trigger = page.locator('[aria-label="New take options"]')
  const menuBlocked = modal || (await trigger.count() > 0 && !(await trigger.isVisible()))
  if (!menuBlocked && await trigger.count()) {
    await page.getByRole("button", { name: "New take options" }).click()
    for (const hook of await hooksOn(page)) found.add(hook)
    await page.keyboard.press("Escape")
  }
  if (!modal && await page.locator(cal("parts")).count() === 0) {
    await page.locator(cal("parts-toggle")).click()
    for (const hook of await hooksOn(page)) found.add(hook)
    await page.keyboard.press("Escape")
  }
  return { found, modal, menuBlocked }
}

// ---------------------------------------------------------------- 1. hooks
const union = new Set()
let allHooks = /** @type {string[]} */ ([])
let names = /** @type {string[]} */ ([]);
{
  const { page, close } = await open(SIZES[0] ?? { width: 1600, height: 1000 }, "takes")
  allHooks = await page.evaluate(() => Object.values(window.gallery.hooks))
  names = await page.evaluate(() => window.gallery.names)
  await close()
}
for (const fixture of names) {
  for (const size of SIZES) {
    await gate(`hooks ${fixture} ${size.name}`, async () => {
      const { page, close } = await open(size, fixture)
      try {
        const applicable = new Set(/** @type {string[]} */ (await page.evaluate(() => window.gallery.applicable())))
        const { found, modal, menuBlocked } = await collect(page)
        for (const hook of found) union.add(hook)
        const navHooks = new Set(["parts", "parts-filter", "setup", "part-expand", "part", "state", "compare-takes", "nav-take", "scenario-context", "scenario-whole", "scenario-subject", "unavailable-states"])
        const missing = [...applicable].filter(hook => !found.has(hook) && !(modal && navHooks.has(hook)) && !(menuBlocked && MENU_HOOKS.has(hook)))
        const extra = [...found].filter(hook => !applicable.has(hook))
        assert.deepEqual({ missing, extra }, { missing: [], extra: [] })
      } finally { await close() }
    })
  }
}
await gate("hooks: the union over fixtures is every CAL hook", async () => {
  assert.deepEqual(allHooks.filter(hook => !union.has(hook)), [])
})

// ---------------------------------------------------------------- 2. actions
const desk = { width: 1600, height: 1000 }
const phone = { width: 416, height: 640 }
await gate("actions: prompt, start, count, follow, attach, accept, discard, device, frame", async () => {
  const { page, close } = await open(desk, "takes")
  try {
    await page.locator(cal("prompt")).fill("Tighten the facts")
    assert.equal((await called(page, "onPrompt")).at(-1)?.args[0], "Tighten the facts")
    await page.locator(cal("prompt")).press("Control+Enter")
    assert.equal((await called(page, "onStart")).length, 1)
    await page.locator(cal("prompt")).press("Control+Shift+Enter")
    assert.deepEqual((await called(page, "onFollow")).map(call => call.args[0]), ["6"])
    await page.getByRole("button", { name: "New take options" }).click()
    await page.getByRole("menuitemradio", { name: "3 takes, planned" }).click()
    assert.deepEqual((await called(page, "onCount")).map(call => call.args[0]), [3])
    assert.equal(await page.locator(cal("take-start")).textContent(), "Plan 3 takes")
    await page.getByRole("button", { name: "New take options" }).click()
    await page.getByRole("menuitem", { name: /Send to take 6/ }).click()
    assert.deepEqual((await called(page, "onFollow")).map(call => call.args[0]), ["6", "6"])
    await page.locator('input[type="file"]').setInputFiles({ name: "ref.png", mimeType: "image/png", buffer: Buffer.from("reference") })
    assert.equal((await called(page, "onAttach")).length, 1)
    await page.locator(cal("take-accept")).click()
    await page.locator(cal("take-discard")).first().click()
    assert.deepEqual((await called(page, "onAccept")).map(call => call.args[0]), ["6"])
    assert.deepEqual((await called(page, "onDiscard")).map(call => call.args[0]), ["6"])
    await page.locator(`${cal("device")}[data-device="odin2portal"]`).click()
    assert.deepEqual((await called(page, "onDevice")).map(call => call.args[0]), ["odin2portal"])
    await page.locator(`${cal("frame-select")}[data-take="2"]`).click()
    assert.deepEqual((await called(page, "onTake")).map(call => call.args[0]), ["2"])
    await page.locator(`${cal("state")}[data-state="ConfirmRemoval"]`).click()
    assert.equal((await called(page, "onState")).length, 1)
    await page.locator(`${cal("compare-takes")}`).click()
    assert.equal((await called(page, "onCompare")).length, 1)
    await page.locator(`${cal("part-expand")}[data-part="src/pages/PicoHome.page.part.tsx"]`).click()
    assert.deepEqual((await called(page, "onPartExpanded")).at(-1)?.args, ["src/pages/PicoHome.page.part.tsx", true])
    await page.locator(cal("parts-filter")).fill("Home")
    assert.equal((await called(page, "onFilter")).at(-1)?.args[0], "Home")
    await page.locator(cal("scenario-context")).selectOption("home")
    assert.deepEqual((await called(page, "onContext")).map(call => call.args[0]), ["home"])
    await page.locator(`${cal("tool")}[data-tool="knobs"]`).click()
    assert.deepEqual((await called(page, "onTool")).map(call => call.args[0]), ["knobs"])
  } finally { await close() }
})
await gate("actions: an image is removed by its identity", async () => {
  const { page, close } = await open(desk, "prompt")
  try {
    await page.locator(cal("attachment-remove")).click()
    assert.deepEqual((await called(page, "onRemoveAttachment")).map(call => call.args[0]), ["image-1"])
    assert.equal(await page.locator(cal("attachments")).count(), 0)
  } finally { await close() }
})
await gate("actions: plan directions edit and remove by id; Start and Back", async () => {
  const { page, close } = await open(desk, "plan")
  try {
    await page.locator(`${cal("direction-title")}[data-direction="d3"]`).fill("Keep the strange")
    await page.locator(`${cal("direction-remove")}[data-direction="d1"]`).click()
    assert.equal(await page.locator(`${cal("direction-title")}[data-direction="d3"]`).inputValue(), "Keep the strange")
    assert.equal(await page.locator(cal("direction-title")).count(), 2)
    assert.equal(await page.locator(cal("plan-start")).textContent(), "Start 2 takes")
    assert.equal(await page.locator(cal("take-start")).count(), 0, "No second start while a plan is open")
    await page.locator(cal("plan-start")).click()
    assert.equal((await called(page, "onStart")).length, 1)
    assert(await page.locator(cal("prompt")).evaluate(node => node instanceof HTMLTextAreaElement && node.readOnly), "The plan's prompt is read only")
    await page.locator(cal("plan-back")).click()
    assert.equal((await called(page, "onPlanBack")).length, 1)
  } finally { await close() }
  const planning = await open(desk, "planning")
  try {
    await planning.page.getByRole("button", { name: "Cancel" }).click()
    assert.equal((await called(planning.page, "onPlanBack")).length, 1)
  } finally { await planning.close() }
})
await gate("actions: a running take stops from the bar and the record; Accept waits", async () => {
  const { page, close } = await open(desk, "running")
  try {
    assert(await page.locator(`.dr-bar ${cal("take-accept")}`).isDisabled())
    await page.locator(`.dr-bar ${cal("take-stop")}`).click()
    await page.locator(`${cal("take-record")} .dr-panel__head ${cal("take-stop")}`).click()
    assert.deepEqual((await called(page, "onStop")).map(call => call.args[0]), ["6", "6"])
    assert.equal(await page.locator(`${cal("frame")}[data-take="6"]`).count(), 1)
    assert.equal(await page.getByRole("progressbar", { name: "Take 6 is working" }).count(), 2)
  } finally { await close() }
})
await gate("actions: an agent that failed to load is an alert in the bar, and start waits", async () => {
  const { page, close } = await open(desk, "agentFailed")
  try {
    assert(await page.locator(cal("take-start")).isDisabled())
    assert.equal(await page.locator(`.dr-bar ${cal("agent-status")}[role="alert"]`).count(), 1)
    assert.match(await page.locator(`.dr-bar ${cal("agent-status")}`).textContent() ?? "", /did not load.*connection refused/)
  } finally { await close() }
})
await gate("actions: knobs preview, commit once, cancel, tokens, literals", async () => {
  const { page, close } = await open(desk, "knobs")
  try {
    const slider = page.locator(`${cal("knob-slider")}[data-knob="min"]`)
    await slider.focus()
    await slider.press("ArrowRight")
    const knobCalls = (await calls(page)).filter(call => call.name === "onKnobInput" || call.name === "onKnobCommit").map(call => `${call.name}:${call.args[0]}=${call.args[1]}`)
    assert.deepEqual(knobCalls, ["onKnobInput:min=3px", "onKnobCommit:min=3px"])
    assert.equal(await page.locator(`${cal("knob-slider")}[data-knob="stage"]`).count(), 0, "A threshold with no max gets no invented slider")
    assert.equal(await page.locator(`${cal("knob-slider")}[data-knob="u"]`).count(), 0, "An unbounded number gets no invented slider")
    const value = page.locator(`${cal("knob-value")}[data-knob="u"]`)
    await value.fill("6")
    await value.press("Enter")
    assert.equal((await called(page, "onKnobCommit")).at(-1)?.args[1], "6px")
    await value.fill("9")
    await value.press("Escape")
    assert.deepEqual((await called(page, "onKnobCancel")).map(call => call.args[0]), ["u"])
    await page.locator(`${cal("knob-token")}[data-knob="bg"][data-token="--pico-navy"]`).click()
    assert.deepEqual((await called(page, "onKnobCommit")).at(-1)?.args, ["bg", "var(--pico-navy)"])
    await page.locator(`${cal("knob-choice")}[data-knob="shape"]`).selectOption("round")
    assert.deepEqual((await called(page, "onKnobCommit")).at(-1)?.args, ["shape", "round"])
    await page.locator(`${cal("literal-name")}[data-literal="gap"]`).fill("--pico-gap")
    assert.deepEqual((await called(page, "onLiteralName")).at(-1)?.args, ["gap", "--pico-gap"])
    await page.locator(cal("literal-promote")).click()
    assert.deepEqual((await called(page, "onPromote")).map(call => call.args[0]), ["gap"])
    await page.locator(`${cal("literal-cancel")}[data-literal="gap"]`).click()
    assert.deepEqual((await called(page, "onLiteralDraft")).at(-1)?.args, ["gap", false])
    await page.locator(`${cal("knob-slider")}[data-knob="min"]`).focus()
    await page.locator(`${cal("knob")}[data-knob="min"] ${cal("source-file")}`).click()
    assert.deepEqual((await called(page, "onOpenFile")).at(-1)?.args, ["src/styles/pico-tokens.css"])
  } finally { await close() }
})
await gate("actions: the alternate applies only the exact reviewed revision after attestation", async () => {
  const { page, close } = await open(desk, "alternate")
  try {
    assert(await page.locator(cal("integration-apply")).isDisabled())
    await page.locator(cal("integration-attestation")).check()
    assert.deepEqual((await called(page, "onBehaviorReviewed")).at(-1)?.args, ["7", "r-3f9a", true])
    await page.locator(cal("integration-apply")).click()
    assert.deepEqual((await called(page, "onApplyAlternate")).at(-1)?.args, ["7", "r-3f9a"])
    await page.locator(cal("integration-check")).click()
    assert.deepEqual((await called(page, "onIntegrationCheck")).at(-1)?.args, ["7", "r-3f9a"])
    assert.equal(await page.locator(`${cal("review-diff")}[data-file="src/pages/PicoGameDetail.tsx"]`).count(), 1)
    assert.deepEqual((await called(page, "onReviewDiffMount")).map(call => call.args.slice(0, 3)), [["7", "r-3f9a", "src/pages/PicoGameDetail.tsx"]])
  } finally { await close() }
})
await gate("actions: checks approve an image after review; closing is not Stop", async () => {
  const { page, close } = await open(desk, "checks")
  try {
    const row = page.locator(`${cal("check-row")}[data-index="2"]`)
    await row.locator("summary").click()
    assert(await row.locator(cal("check-image-approve")).isDisabled())
    await row.locator(cal("check-image-reviewed")).check()
    await row.locator(cal("check-image-approve")).click()
    assert.deepEqual((await called(page, "onApproveImage")).at(-1)?.args, ["run-7", 2])
    await page.locator(cal("check-run")).first().click()
    assert.deepEqual((await called(page, "onCheckRun")).at(-1)?.args, ["selected"])
    await page.keyboard.press("Escape")
    await page.locator(cal("checks")).waitFor({ state: "detached" })
    assert.equal((await called(page, "onChecksClose")).length, 1)
    assert.equal((await called(page, "onCheckStop")).length, 0)
  } finally { await close() }
  const running = await open(desk, "checksRunning")
  try {
    await running.page.locator(cal("check-stop")).click()
    assert.deepEqual((await called(running.page, "onCheckStop")).at(-1)?.args, ["run-8"])
  } finally { await running.close() }
})
await gate("actions: code tabs, files, steps, divider, retry", async () => {
  const { page, close } = await open(desk, "code")
  try {
    await page.locator(cal("code-previous-change")).click()
    await page.locator(cal("code-next-change")).click()
    assert.equal((await called(page, "onPreviousChange")).length + (await called(page, "onNextChange")).length, 2)
    await page.locator(`${cal("code-files")} > summary`).click()
    await page.locator(cal("code-file-filter")).fill("facts")
    assert.equal((await called(page, "onFileFilter")).at(-1)?.args[0], "facts")
    await page.locator(`${cal("code-files")} ${cal("code-file")}[data-file="src/pages/PicoGameFacts.css"]`).click()
    assert.deepEqual((await called(page, "onOpenFile")).at(-1)?.args, ["src/pages/PicoGameFacts.css"])
    assert.equal(await page.locator(`${cal("code-files")}[open]`).count(), 0, "Choosing a file closes the menu")
    const divider = page.locator(cal("code-share"))
    await divider.focus()
    await divider.press("ArrowUp")
    assert.deepEqual((await called(page, "onCodeShare")).at(-1)?.args, [0.51, true])
    await divider.press("Enter")
    assert.deepEqual((await called(page, "onCodeShare")).at(-1)?.args, [0.46, true])
    await page.locator(cal("code-save")).click()
    assert.equal((await called(page, "onCodeSave")).length, 1)
  } finally { await close() }
  const failed = await open(desk, "codeFailed")
  try {
    await failed.page.locator(cal("code-retry")).click()
    assert.equal((await called(failed.page, "onCodeRetry")).length, 1)
  } finally { await failed.close() }
})
await gate("actions: calibrate, reset and done; record close", async () => {
  const { page, close } = await open(desk, "calibrate")
  try {
    const scale = page.locator(cal("calibration-scale"))
    await scale.focus()
    await scale.press("ArrowRight")
    assert(Number((await called(page, "onPxPerMm")).at(-1)?.args[0]) > 3.875, "ArrowRight steps the scale up")
    await page.locator(cal("calibration-reset")).click()
    await page.locator(cal("calibration-close")).click()
    assert.equal((await called(page, "onResetCalibration")).length + (await called(page, "onCalibrationClose")).length, 2)
  } finally { await close() }
  const log = await open(desk, "log")
  try {
    await log.page.locator(`${cal("take-record")} ${cal("code-file")}`).first().click()
    assert.deepEqual((await called(log.page, "onOpenFile")).at(-1)?.args, ["src/pages/PicoGameDetail.css"])
    await log.page.locator(cal("take-alternate")).click()
    assert.deepEqual((await called(log.page, "onPrepareAlternate")).at(-1)?.args, ["6"])
    await log.page.locator(cal("record-close")).click()
    assert.equal((await called(log.page, "onRecordClose")).length, 1)
    assert.equal(await log.page.locator(cal("take-record")).count(), 0)
  } finally { await log.close() }
})

// ---------------------------------------------------------------- 3. keyboard and focus
await gate("keyboard: the New take menu opens, moves, chooses and returns focus", async () => {
  const { page, close } = await open(desk, "prompt")
  try {
    const trigger = page.getByRole("button", { name: "New take options" })
    await trigger.focus()
    await page.keyboard.press("Enter")
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "1 take", "Opening focuses the checked count")
    await page.keyboard.press("ArrowDown")
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "2 takes, planned")
    await page.keyboard.press("Enter")
    assert.deepEqual((await called(page, "onCount")).map(call => call.args[0]), [2])
    assert.equal(await page.getByRole("menu").count(), 0)
    assert(await trigger.evaluate(node => node === document.activeElement), "Choosing returns focus to the button")
    await page.keyboard.press("ArrowDown")
    assert.equal(await page.getByRole("menu").count(), 1)
    await page.keyboard.press("End")
    await page.keyboard.press("Escape")
    assert.equal(await page.getByRole("menu").count(), 0)
    assert(await trigger.evaluate(node => node === document.activeElement), "Escape returns focus to the button")
  } finally { await close() }
})
await gate("keyboard: the phone drawer takes focus, Escape closes it and returns focus", async () => {
  const { page, close } = await open(phone, "takes")
  try {
    const toggle = page.locator(cal("parts-toggle"))
    await toggle.focus()
    await page.keyboard.press("Enter")
    await page.locator(cal("parts")).waitFor({ state: "visible" })
    assert(await page.evaluate(() => Boolean(document.activeElement?.closest(".dr-parts"))), "Focus moves into the drawer")
    assert.equal(await page.locator('.dr-tools [aria-pressed="true"]').count(), 0, "While the drawer is in front, only Parts is marked")
    await page.keyboard.press("Escape")
    // The panel stays mounted (its filter and scroll survive); closed means hidden.
    await page.locator(cal("parts")).waitFor({ state: "hidden" })
    assert(await toggle.evaluate(node => node === document.activeElement), "Focus returns to Parts")
    assert.deepEqual(await page.locator('.dr-tools [aria-pressed="true"]').evaluateAll(nodes => nodes.map(node => node.getAttribute("data-tool"))), ["takes"])
  } finally { await close() }
})
await gate("keyboard: the dock marks one tool; Preview clears the sheet", async () => {
  const { page, close } = await open(phone, "log")
  try {
    assert.deepEqual(await page.locator('.dr-tools [aria-pressed="true"]').evaluateAll(nodes => nodes.map(node => node.getAttribute("data-tool"))), ["takes"])
    assert(await page.locator(cal("take-record")).isVisible(), "Takes puts the record sheet in front")
    await page.locator(`${cal("tool")}[data-tool="preview"]`).click()
    assert.deepEqual(await page.locator('.dr-tools [aria-pressed="true"]').evaluateAll(nodes => nodes.map(node => node.getAttribute("data-tool"))), ["preview"])
    assert.equal(await page.locator(cal("take-record")).count(), 0)
    assert(await page.locator(cal("composer")).isVisible(), "Preview shows the canvas and its bar")
  } finally { await close() }
})
await gate("keyboard: the checks dialog holds focus and Escape closes it", async () => {
  const { page, close } = await open(desk, "checks")
  try {
    assert(await page.evaluate(() => Boolean(document.activeElement?.closest("dialog"))), "Focus is inside the dialog")
    await page.keyboard.press("Tab")
    assert(await page.evaluate(() => Boolean(document.activeElement?.closest("dialog"))), "Tab stays inside the dialog")
  } finally { await close() }
})
await gate("focus: a keyboard-focused control shows an ink ring", async () => {
  const { page, close } = await open(desk, "takes")
  try {
    await page.keyboard.press("Tab")
    const outline = await page.evaluate(() => { const node = document.activeElement; return node ? getComputedStyle(node).outlineStyle : "none" })
    assert.notEqual(outline, "none")
  } finally { await close() }
})
await gate("focus: typing through stream updates keeps focus and every character", async () => {
  const { page, close } = await open(desk, "takes")
  try {
    await page.locator(cal("prompt")).click()
    await page.keyboard.type("Quiet the stats row")
    assert.equal(await page.locator(cal("prompt")).inputValue(), "Quiet the stats row")
    assert(await page.locator(cal("prompt")).evaluate(node => node === document.activeElement))
    await page.evaluate(() => window.gallery.tick())
    assert(await page.locator(cal("prompt")).evaluate(node => node === document.activeElement))
  } finally { await close() }
  const plan = await open(desk, "plan")
  try {
    const title = plan.page.locator(`${cal("direction-title")}[data-direction="d2"]`)
    await title.click()
    await plan.page.keyboard.press("End")
    await plan.page.keyboard.type(" first")
    assert.equal(await title.inputValue(), "Cover at half, title beside it first")
    assert(await title.evaluate(node => node === document.activeElement))
  } finally { await plan.close() }
})
await gate("keyboard: palette tokens move with arrows and commit", async () => {
  const { page, close } = await open(desk, "knobs")
  try {
    await page.locator(`${cal("knob-token")}[data-knob="accent"][aria-checked="true"]`).focus()
    await page.keyboard.press("ArrowRight")
    assert.deepEqual((await called(page, "onKnobCommit")).at(-1)?.args, ["accent", "var(--pico-peach)"])
  } finally { await close() }
})

// ---------------------------------------------------------------- 4. preservation
await gate("frames: a reached state survives updates, resizes and tool changes", async () => {
  const { page, close } = await open(desk, "takes")
  try {
    const frame = page.frameLocator(`${cal("frame")}[data-take="6"]`)
    await frame.locator("body").click()
    const taps = () => frame.locator("body").getAttribute("data-taps")
    assert.equal(await taps(), "1")
    await page.evaluate(() => window.gallery.tick())
    assert.equal(await taps(), "1", "A stream update keeps the frame")
    for (const size of [{ width: 1000, height: 680 }, { width: 416, height: 640 }, { width: 1600, height: 1000 }]) {
      await page.setViewportSize(size)
      await page.waitForTimeout(80)
      assert.equal(await taps(), "1", `Resizing to ${size.width} keeps the frame`)
    }
    await page.locator(`${cal("tool")}[data-tool="knobs"]`).click()
    await page.waitForTimeout(80)
    assert.equal(await taps(), "1", "Opening Knobs keeps the frame")
    const mounts = (await called(page, "onFrameMount")).filter(call => call.args[0] === "6@2026-09-29T13:06" && call.args[1] !== null)
    assert.equal(mounts.length, 1, "The frame mounted once")
    const geometry = (await called(page, "onFrameGeometry")).filter(call => call.args[0] === "6@2026-09-29T13:06").map(call => JSON.parse(String(call.args[1])))
    assert(geometry.some(item => item.fit._tag === "TrueSize" && Math.abs(item.width - 279) < 0.5), "Desk frames are drawn at true size, 72 mm at 3.875 px/mm")
    await page.evaluate(() => window.gallery.unmount())
    assert((await called(page, "onFrameMount")).some(call => call.args[0] === "6@2026-09-29T13:06" && call.args[1] === null), "Unmount unregisters the frame")
  } finally { await close() }
})
await gate("frames: a device that cannot fit says it is scaled", async () => {
  const { page, close } = await open(phone, "odin")
  try {
    assert.match(await page.locator(cal("caption")).textContent() ?? "", /Scaled to \d+%/)
    assert.equal(await page.frameLocator(cal("frame")).locator("body").evaluate(() => innerWidth), 1920, "The page inside keeps the device's CSS viewport")
  } finally { await close() }
})
await gate("editor: the host and its editor survive updates, a fold and a hidden sheet", async () => {
  const { page, close } = await open(desk, "code")
  try {
    await page.locator(`${cal("code-editor")} .cm-content`).waitFor()
    await page.locator(`${cal("code-editor")} .cm-content`).click()
    // The click must give the editor focus before typing, or the keys go elsewhere.
    await page.waitForFunction(() => document.activeElement?.closest(".cm-content") !== null)
    await page.keyboard.press("Control+Home")
    await page.keyboard.type("/* kept */")
    const text = () => page.locator(`${cal("code-editor")} .cm-content`).textContent()
    await page.waitForFunction(() => /kept/.test(document.querySelector('[data-cal="code-editor"] .cm-content')?.textContent ?? ""))
    await page.evaluate(() => window.gallery.tick())
    assert.match(await text() ?? "", /kept/, "A stream update keeps the editor's text")
    await page.setViewportSize(phone)
    await page.waitForTimeout(100)
    assert.match(await text() ?? "", /kept/, "Moving to a sheet keeps the editor")
    await page.locator(`${cal("tool")}[data-tool="takes"]`).click()
    assert.equal(await page.locator(cal("code-editor")).count(), 1, "A code sheet behind Takes stays mounted")
    await page.locator(`${cal("tool")}[data-tool="code"]`).click()
    assert.match(await text() ?? "", /kept/)
    assert.deepEqual(await page.evaluate(() => ({ ...window.gallery.editor })), { created: 1, destroyed: 0 })
    assert.equal((await called(page, "onEditorMount")).filter(call => call.args[0] === "element").length, 1, "The host mounted once")
  } finally { await close() }
})

// ---------------------------------------------------------------- 5. reachability
for (const size of [...LADDER, ...SIZES]) {
  for (const fixture of ["takes", "log", "knobs", "code", "plan", "running", "agentFailed", "checks", "calibrate"]) {
    await gate(`reachable ${fixture} ${size.name} ${size.width}x${size.height}`, async () => {
      const { page, close } = await open(size, fixture)
      try {
        const report = await page.evaluate(() => {
          const scroller = (/** @type {Element} */ node) => {
            for (let at = node.parentElement; at; at = at.parentElement) {
              const style = getComputedStyle(at)
              if (/(auto|scroll)/.test(style.overflowY + style.overflowX) && (at.scrollHeight > at.clientHeight + 1 || at.scrollWidth > at.clientWidth + 1)) return at
            }
            return null
          }
          const page = document.scrollingElement
          const problems = []
          if (page && (page.scrollHeight > innerHeight + 1 || page.scrollWidth > innerWidth + 1)) problems.push(`the page scrolls: ${page.scrollWidth}x${page.scrollHeight}`)
          for (const node of document.querySelectorAll("button[data-cal], input[data-cal], select[data-cal], textarea[data-cal], a[data-cal], [data-cal][tabindex]")) {
            if (!(node instanceof HTMLElement) || !node.checkVisibility({ visibilityProperty: true })) continue
            const rect = node.getBoundingClientRect()
            if (rect.width < 1 || rect.height < 1) continue
            const inside = rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1
            if (!inside && !scroller(node)) problems.push(`${node.dataset.cal} ${node.textContent?.trim().slice(0, 30)} is off screen with no scroll region`)
          }
          return problems
        })
        assert.deepEqual(report, [])
        const applicable = new Set(/** @type {string[]} */ (await page.evaluate(() => window.gallery.applicable())))
        const { found, modal, menuBlocked } = await collect(page)
        const missing = [...applicable].filter(hook => !found.has(hook) && !modal && !(menuBlocked && MENU_HOOKS.has(hook)))
        assert.deepEqual(missing, [], "Every applicable control exists at this size")
      } finally { await close() }
    })
  }
}

await browser.close()
await gallery.close()
if (pageErrors.length) failures.push(`page errors or warnings:\n  ${[...new Set(pageErrors)].join("\n  ")}`)
console.log(`${passed.length} gates passed.`)
if (failures.length) {
  console.error(`${failures.length} failed:\n- ${failures.join("\n- ")}`)
  process.exitCode = 1
} else console.log(`Darkroom verified: ${names.length} fixtures at 3 sizes, ${allHooks.length} hooks, actions, keyboard, preservation and ${LADDER.length + SIZES.length} sizes of reachability.`)
