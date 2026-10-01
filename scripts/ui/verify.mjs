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
/** `verify.mjs <text>` runs only the gates whose name contains the text. */
const only = process.argv[2]
/** @param {string} name @param {() => Promise<void>} run */
async function gate(name, run) {
  if (only && !name.includes(only)) return
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

/**
 * In the New take menu. While the draft holds marks the menu also holds New take (take-start),
 * and while marks on the real files go with a typed prompt it holds Send (marks-send).
 */
const MENU_HOOKS = new Set(["take-count", "take-follow", "agent-status", "agent-models", "agent-skills", "take-start", "marks-send"])
/**
 * Read every hook, opening the UI-owned disclosures first. A menu behind a
 * sheet in front, or anything behind the modal Checks window, is one tap
 * away (close the sheet or the window) and is reported as blocked.
 * @param {import("playwright-core").Page} page
 */
async function collect(page) {
  const found = new Set(await hooksOn(page))
  /** Hooks one more press inside a disclosure shows: they count for the union, not for the fixture's own set. */
  const deeper = new Set()
  const modal = await page.locator("dialog[open]").count() > 0
  const trigger = page.locator('[aria-label="New take options"]')
  const menuBlocked = modal || (await trigger.count() > 0 && !(await trigger.isVisible()))
  if (!menuBlocked && await trigger.count()) {
    await page.getByRole("button", { name: "New take options" }).click()
    for (const hook of await hooksOn(page)) found.add(hook)
    // The model chooser unfolds inside the menu (decision 43).
    const chooser = page.locator(`${cal("agent-models")} > ${cal("agent-status")}`)
    if (await chooser.count() && await chooser.isVisible()) {
      await chooser.click()
      for (const hook of await hooksOn(page)) deeper.add(hook)
    }
    await page.keyboard.press("Escape")
  }
  // Answering a question unfolds its fields and Save answer (decision 45).
  const answer = page.locator(`${cal("questions")} .ws-q__actions button`).first()
  if (!modal && await answer.count() && await answer.isVisible() && await answer.isEnabled()) {
    await answer.click()
    for (const hook of await hooksOn(page)) deeper.add(hook)
    await page.keyboard.press("Escape")
  }
  for (const hook of deeper) union.add(hook)
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
await gate("actions: workspace list, pin, idea, prompt, follow, questions, answer, ask, discard", async () => {
  const { page, close } = await open(desk, "workspaceBoard")
  try {
    await page.locator(`${cal("workspace")}[data-workspace="2"]`).click()
    assert.deepEqual((await called(page, "onWorkspace")).map(call => call.args[0]), ["2"])
    await page.locator(cal("workspace-new")).click()
    assert.equal((await called(page, "onWorkspaceNew")).length, 1)
    const pin = page.locator(`${cal("state-pin")}[data-part="src/pages/PicoSettings.page.part.tsx"][data-state="S1"]`)
    await pin.click()
    assert.deepEqual((await called(page, "onPin")).at(-1)?.args, [JSON.stringify({ part: "src/pages/PicoSettings.page.part.tsx", state: "S1" }), true])
    assert.equal(await pin.getAttribute("aria-pressed"), "true")
    await page.locator(`${cal("board-idea")}[data-take="3"]`).click()
    assert.deepEqual((await called(page, "onIdea")).map(call => call.args[0]), ["3"])
    await page.locator(cal("prompt")).fill("Count only the games")
    await page.locator(cal("prompt")).press("Control+Enter")
    assert.deepEqual((await called(page, "onIdeaFollow")).map(call => call.args[0]), ["3"])
    await page.locator(`${cal("idea-discard")}[data-take="3"]`).click()
    assert.deepEqual((await called(page, "onIdeaDiscard")).map(call => call.args[0]), ["3"])
    await page.locator(`${cal("questions")} .ws-q__actions button`).first().click()
    await page.getByLabel("Answer", { exact: true }).fill("No")
    await page.getByLabel("Reason", { exact: true }).fill("The bar has no room")
    await page.locator(cal("question-answer")).click()
    assert.deepEqual((await called(page, "onAnswer")).at(-1)?.args, ["2", "No", "The bar has no room"])
    await page.locator(cal("question-ask")).fill("Does B leave Settings?")
    await page.locator(cal("question-ask")).press("Enter")
    assert.deepEqual((await called(page, "onAsk")).map(call => call.args[0]), ["Does B leave Settings?"])
    await page.locator(cal("workspace-discard")).click()
    assert.equal(await page.locator("dialog[open]").count(), 1, "Discard asks first")
    await page.getByRole("button", { name: "Discard 3 ideas" }).click()
    assert.deepEqual((await called(page, "onWorkspaceDiscard")).map(call => call.args[0]), ["4"])
    await page.locator(cal("questions-open")).click()
    assert.deepEqual((await called(page, "onQuestions")).map(call => call.args[0]), [false])
  } finally { await close() }
})
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
    await page.getByRole("menuitemradio", { name: "3 takes" }).click()
    assert.deepEqual((await called(page, "onCount")).map(call => call.args[0]), [3])
    assert.equal(await page.locator(cal("take-start")).textContent(), "3 new takes")
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
    // On the ODIN 2 PORTAL a desk shows one frame per chain; take 3 is a chain of one, so its name shows.
    await page.locator(`${cal("frame-select")}[data-take="3"]`).click()
    assert.deepEqual((await called(page, "onTake")).map(call => call.args[0]), ["3"])
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
await gate("actions: planning shows blank slots, one status line and Cancel; no review step", async () => {
  const { page, close } = await open(desk, "planning")
  try {
    assert.equal(await page.locator(".dr-slot").count(), 3)
    assert.equal(await page.locator(".dr-slot__plate, .dr-slot__caption").evaluateAll(nodes => nodes.map(node => node.textContent ?? "").join("").trim()), "", "A slot being planned shows no words")
    assert.equal(await page.locator(".dr-canvas__title q").count(), 0, "The prompt shows once, in the composer")
    assert.equal(await page.locator(cal("take-start")).count(), 0, "No second start while takes are planned")
    assert.equal(await page.getByRole("status").filter({ hasText: "Planning 3 takes" }).count(), 1)
    assert(await page.locator(cal("prompt")).evaluate(node => node instanceof HTMLTextAreaElement && node.readOnly), "The prompt is read only while planning")
    await page.locator(cal("plan-cancel")).click()
    assert.equal((await called(page, "onPlanCancel")).length, 1)
  } finally { await close() }
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
    // A token opens as a list from its field; a click writes it once.
    await page.locator(`${cal("knob")}[data-knob="bg"] .dr-token__trigger`).click()
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
await gate("layout: the editor fills the code pane, which spans the stage, not the frame", async () => {
  const fold = { width: 1000, height: 680 }
  for (const size of [desk, fold, phone]) {
    for (const fixture of ["code", "codeWatching"]) {
      const { page, close } = await open(size, fixture)
      try {
        // On a phone the code pane is a sheet; both fixtures have Code in front, so a press would close it.
        await page.locator(`${cal("code-editor")} .cm-content`).waitFor()
        const boxes = await page.evaluate(() => {
          const box = (/** @type {string} */ selector) => { const node = document.querySelector(selector); if (!node) throw new Error(`No ${selector}`); const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom, width: r.width } }
          return { ready: box(".dr-code__ready"), editor: box(".dr-code__editor"), pane: box(".dr-code"), stage: box(".dr-stage"), frame: box(".dr-frame__screen") }
        })
        const where = `${fixture} at ${size.width}x${size.height}`
        assert.ok(Math.abs(boxes.editor.bottom - boxes.ready.bottom) <= 1, `${where}: the editor ends ${Math.round(boxes.ready.bottom - boxes.editor.bottom)} px above the pane's foot`)
        if (size !== phone) {
          assert.ok(Math.abs(boxes.pane.left - boxes.stage.left) <= 1 && Math.abs(boxes.pane.right - boxes.stage.right) <= 1, `${where}: the pane spans ${Math.round(boxes.pane.width)} px of a ${Math.round(boxes.stage.width)} px stage`)
          assert.ok(boxes.pane.width > boxes.frame.width, `${where}: the pane (${Math.round(boxes.pane.width)} px) is no wider than the frame (${Math.round(boxes.frame.width)} px)`)
        }
      } finally { await close() }
    }
  }
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

// ---------------------------------------------------------------- 2b. take markup
/** @param {import("playwright-core").Page} page @param {string} take */
const surfaceOf = (page, take) => page.locator(`${cal("mark-surface")}[data-frame-key^="${take}@"]`)
/** Press, move and release on a frame's surface, at fractions of its drawn box. @param {import("playwright-core").Page} page @param {string} take @param {[number, number]} from @param {[number, number] | null} to */
async function gesture(page, take, from, to = null) {
  await surfaceOf(page, take).scrollIntoViewIfNeeded()
  const box = await surfaceOf(page, take).boundingBox()
  assert(box, `Take ${take} has a mark surface`)
  const at = (/** @type {[number, number]} */ [x, y]) => ({ x: box.x + box.width * x, y: box.y + box.height * y })
  await page.mouse.move(at(from).x, at(from).y)
  await page.mouse.down()
  if (to) await page.mouse.move(at(to).x, at(to).y, { steps: 6 })
  await page.mouse.up()
}
/** @param {unknown} value */
const parsed = value => JSON.parse(String(value))
/** @param {number} actual @param {number} expected @param {string} what */
const near = (actual, expected, what) => assert(Math.abs(actual - expected) <= 2, `${what}: ${actual} is not ${expected}`)

await gate("markup: mark mode, a click is a pin and a drag a box in device px, notes, the draft and Send", async () => {
  const { page, close } = await open(desk, "takes")
  try {
    assert.equal(await page.locator(cal("mark-surface")).count(), 0, "No surface until mark mode is on")
    await page.locator(cal("mark-mode")).click()
    assert.deepEqual((await called(page, "onMarkMode")).map(call => call.args[0]), [true])
    assert.equal(await page.locator(cal("mark-mode")).getAttribute("aria-pressed"), "true")
    assert.match(await page.locator(".dr-canvas__marking").textContent() ?? "", /M leaves/)
    assert.equal(await page.locator(cal("mark-surface")).count(), 6, "Every take takes marks, and so do the real files (phase 6)")
    assert.equal(await page.locator(`${cal("mark-surface")}[data-frame-key="real"]`).count(), 1)
    await gesture(page, "6", [0.25, 0.5])
    const point = (await called(page, "onMarkPoint")).at(-1)
    assert.equal(point?.args[0], "6@2026-09-29T13:06")
    near(parsed(point?.args[1]).x, 160, "x"); near(parsed(point?.args[1]).y, 240, "y")
    const note = page.locator(cal("mark-note"))
    await note.waitFor()
    assert(await note.evaluate(node => node === document.activeElement), "The note editor takes focus at the new mark")
    await page.keyboard.type("Tighter")
    assert.equal((await called(page, "onMarkNote")).at(-1)?.args[1], "Tighter")
    await page.evaluate(() => window.gallery.tick())
    assert(await note.evaluate(node => node === document.activeElement), "A stream update keeps the note's focus")
    await page.keyboard.press("Enter")
    assert.deepEqual((await called(page, "onMarkEdit")).at(-1)?.args, [null])
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-cal") === "mark-pin")
    assert.equal(await page.locator(cal("mark-mode")).getAttribute("aria-pressed"), "true", "Closing a note does not leave mark mode")
    await gesture(page, "5", [0.1, 0.1], [0.4, 0.3])
    const region = parsed((await called(page, "onMarkRegion")).at(-1)?.args[1])
    near(region.x, 64, "left"); near(region.y, 48, "top"); near(region.width, 192, "width"); near(region.height, 96, "height")
    await gesture(page, "2", [0.6, 0.6], [0.5, 0.4])
    const reverse = parsed((await called(page, "onMarkRegion")).at(-1)?.args[1])
    near(reverse.x, 320, "a reverse drag's left"); near(reverse.width, 64, "a reverse drag's width")
    await page.keyboard.press("Escape")
    assert.equal(await page.locator(cal("mark-mode")).getAttribute("aria-pressed"), "true", "Escape in a note closes the note, not mark mode")
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
    await page.keyboard.press("m")
    assert.deepEqual((await called(page, "onMarkMode")).map(call => call.args[0]).slice(-1), [false], "M leaves mark mode")
    await page.locator(cal("draft-open")).click()
    assert.equal(await page.locator(`${cal("mark-draft")} .dr-dmark`).count(), 3)
    const send = page.locator(cal("marks-send"))
    assert.equal(await send.textContent(), "Send · 3 new takes")
    assert.equal(await page.locator(cal("take-start")).count(), 0, "New take moves into the menu while the draft holds marks")
    const revision = Number(await send.getAttribute("data-revision"))
    await send.click()
    assert.deepEqual((await called(page, "onSend")).map(call => call.args[0]), [revision])
    assert.equal(await send.isDisabled(), true, "Sending locks Send")
  } finally { await close() }
})
await gate("markup: marking keeps the frame's reached state; the press never reaches the page", async () => {
  const { page, close } = await open(desk, "takes")
  try {
    const frame = page.frameLocator(`${cal("frame")}[data-take="6"]`)
    await frame.locator("body").click()
    const taps = () => frame.locator("body").getAttribute("data-taps")
    assert.equal(await taps(), "1")
    await page.locator(cal("mark-mode")).click()
    await gesture(page, "6", [0.5, 0.5])
    await gesture(page, "6", [0.2, 0.2], [0.3, 0.3])
    assert.equal(await taps(), "1", "The page did not get the marking presses and was not reloaded")
    const mounts = (await called(page, "onFrameMount")).filter(call => call.args[0] === "6@2026-09-29T13:06" && call.args[1] !== null)
    assert.equal(mounts.length, 1, "The frame mounted once")
    await page.locator(cal("mark-mode")).click()
    // Away from the new marks: a pin sits over the page and takes its own press.
    const screen = await page.locator(`${cal("frame")}[data-take="6"]`).boundingBox()
    assert(screen)
    await page.mouse.click(screen.x + screen.width * 0.94, screen.y + screen.height * 0.92)
    assert.equal(await taps(), "2", "With mark mode off the page takes clicks again")
  } finally { await close() }
})
await gate("markup: a phone-sized frame converts a press to device px", async () => {
  const { page, close } = await open(phone, "mark")
  try {
    // Take 3 is a chain of one, so it shows at phone width; a parent such as take 1 is behind its chain's swap there.
    await gesture(page, "3", [0.5, 0.5])
    const point = parsed((await called(page, "onMarkPoint")).at(-1)?.args[1])
    near(point.x, 320, "x at 416 px"); near(point.y, 240, "y at 416 px")
  } finally { await close() }
})
await gate("markup: pins open their note; the keyboard places a pin and an area", async () => {
  const { page, close } = await open(desk, "mark")
  try {
    assert.equal(await page.locator(`${cal("mark-note")}[data-mark-id="m-6b"]`).count(), 1, "The editor opens under take 6 at 6B")
    await page.locator(`${cal("mark-pin")}[data-mark-id="m-6a"]`).click()
    assert.deepEqual((await called(page, "onMarkEdit")).at(-1)?.args, ["m-6a"])
    assert.equal(await page.locator(`${cal("mark-pin")}[data-mark-id="m-3a"]`).getAttribute("data-location"), "Lost")
    const pin = page.locator(`${cal("mark-point")}[data-frame-key^="1@"]`)
    await pin.focus()
    assert(await pin.isVisible(), "The key controls show while one has focus")
    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")
    const point = (await called(page, "onMarkPoint")).at(-1)
    assert.equal(point?.args[0], "1@2026-09-29T13:01")
    assert.deepEqual(parsed(point?.args[1]), { x: 340, y: 260 }, "Arrows move the target by a 32nd of the width")
    const area = page.locator(`${cal("mark-region")}[data-frame-key^="2@"]`)
    await area.focus()
    await page.keyboard.press("Shift+ArrowRight")
    await page.keyboard.press("Shift+ArrowDown")
    await page.keyboard.press("Enter")
    assert.deepEqual(parsed((await called(page, "onMarkRegion")).at(-1)?.args[1]), { x: 320, y: 240, width: 20, height: 20 })
  } finally { await close() }
})
await gate("markup: a lost mark blocks Send, says why, and Re-place moves it", async () => {
  const { page, close } = await open(desk, "draft")
  try {
    const send = page.locator(cal("marks-send"))
    assert.equal(await send.isDisabled(), true)
    assert.match(await send.getAttribute("title") ?? "", /Element not found/)
    assert.match(await page.locator(`.dr-dmark[data-mark-id="m-3a"]`).textContent() ?? "", /Element not found after the restart/)
    assert.equal(await page.locator(cal("draft-open")).getAttribute("data-blocked"), "true")
    await page.locator(`${cal("mark-replace")}[data-mark-id="m-3a"]`).click()
    assert.deepEqual((await called(page, "onMarkReplace")).at(-1)?.args, ["m-3a"])
    assert.match(await page.locator(".dr-canvas__marking").textContent() ?? "", /Re-place 3A/)
    assert.equal(await page.locator(cal("mark-surface")).count() > 0, true)
    // The open draft covers the lower part of the second band of frames; press where take 3 shows above it.
    await gesture(page, "3", [0.3, 0.2])
    assert.equal((await called(page, "onMarkPoint")).at(-1)?.args[0], "3@2026-09-29T13:03")
    assert.equal(await send.isDisabled(), false, "With every mark found, Send is ready")
    await page.locator(`${cal("mark-edit")}[data-mark-id="m-5a"]`).click()
    await page.locator(`${cal("mark-note")}[data-mark-id="m-5a"]`).fill("Keep this row")
    assert.deepEqual((await called(page, "onMarkNote")).at(-1)?.args, ["m-5a", "Keep this row"])
    await page.locator(cal("mark-editor-close")).click()
    await page.locator(`${cal("mark-remove")}[data-mark-id="m-2a"]`).click()
    assert.deepEqual((await called(page, "onMarkRemove")).at(-1)?.args, ["m-2a"])
    assert.equal(await send.textContent(), "Send · 3 new takes")
    await page.locator(cal("draft-open")).click()
    assert.deepEqual((await called(page, "onDraftOpen")).at(-1)?.args, [false])
  } finally { await close() }
})
await gate("markup: while Send runs nothing in the draft changes; a refused Send is an alert", async () => {
  const { page, close } = await open(desk, "sending")
  try {
    assert.equal(await page.locator(cal("marks-send")).isDisabled(), true)
    for (const hook of ["mark-edit", "mark-remove"]) assert.equal(await page.locator(`${cal(hook)}:not([disabled])`).count(), 0, `${hook} waits`)
    assert.equal(await page.locator(cal("mark-mode")).isDisabled(), true, "No frame takes marks while Send runs")
  } finally { await close() }
  const failed = await open(desk, "sendFailed")
  try {
    assert.match(await failed.page.locator('.dr-bar [role="alert"]').textContent() ?? "", /Take 5 changed/)
    assert.equal(await failed.page.locator(cal("marks-send")).isDisabled(), false, "Send can be tried again")
  } finally { await failed.close() }
  const running = await open(desk, "markRunning")
  try {
    assert.equal(await running.page.locator(cal("marks-send")).isDisabled(), true, "A running take stops the whole pass")
    assert.match(await running.page.locator('.dr-dtake[data-take="5"]').textContent() ?? "", /still running/)
  } finally { await running.close() }
})

// ---------------------------------------------------------------- 2c. chains
/**
 * The chains as drawn: each group's heading, its frames in DOM order, the
 * frames that show, and its swap. Hidden frames stay mounted, so `frames`
 * lists both sides of a pair that does not fit.
 * @param {import("playwright-core").Page} page
 */
const drawnChains = page => page.evaluate(() => [...document.querySelectorAll('[data-cal="chain"]')].map(node => ({
  id: node.getAttribute("data-chain") ?? "",
  heading: node.querySelector("h2")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
  frames: [...node.querySelectorAll('[data-cal="frame"]')].map(frame => frame.getAttribute("data-frame-key")),
  showing: [...node.querySelectorAll(".dr-frame")].filter(frame => frame.checkVisibility()).map(frame => frame.getAttribute("data-frame-key")),
  solo: node.querySelector('[data-cal="chain-solo"]')?.getAttribute("data-solo") ?? null,
})))
/** @param {import("playwright-core").Page} page */
const viewChains = page => page.evaluate(() => { const canvas = window.gallery.view().canvas; return canvas._tag === "Frames" ? canvas.chains : [] })
/**
 * The fit rule, from what the canvas measures: two frames at true size and a gap
 * against the canvas's content width (decision 35).
 * @param {import("playwright-core").Page} page
 */
const pairRule = page => page.evaluate(() => {
  const canvas = /** @type {HTMLElement} */ (document.querySelector('[data-cal="canvas"]'))
  const scroll = /** @type {HTMLElement} */ (canvas.querySelector(".dr-canvas__scroll"))
  const style = getComputedStyle(scroll)
  const width = scroll.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  const gap = parseFloat(style.getPropertyValue("--dr-gap-now"))
  const view = window.gallery.view()
  const frame = view.device.widthMm * view.pxPerMm
  return { pairs: canvas.dataset.pairs ?? "", width, gap, frame, need: 2 * frame + gap, device: view.device.id }
})
/** Mount calls with a node, per frame key. @param {import("playwright-core").Page} page */
const mounts = async page => {
  /** @type {Record<string, number>} */
  const count = {}
  for (const call of await called(page, "onFrameMount")) if (call.args[1] !== null) count[String(call.args[0])] = (count[String(call.args[0])] ?? 0) + 1
  return count
}

await gate("chains: each chain is its heading, then the parent at 78 % and the shown take; every frame key once", async () => {
  const { page, close } = await open(desk, "takes")
  try {
    const rule = await pairRule(page)
    assert.equal(rule.pairs, "fit", `A desk canvas holds an RG353M pair: ${JSON.stringify(rule)}`)
    const chains = await viewChains(page)
    const drawn = await drawnChains(page)
    assert.deepEqual(drawn.map(chain => chain.id), chains.map(chain => chain.id), "One group per chain, in the view's order")
    for (const chain of chains) {
      const group = drawn.find(item => item.id === chain.id)
      assert.equal(group?.heading, chain.label)
      const pair = [chain.parent, chain.shown].filter(Boolean)
      assert.deepEqual(group?.frames, pair, `Chain ${chain.label}: the parent, then the shown take`)
      assert.deepEqual(group?.showing, pair, `Chain ${chain.label}: both frames show when the pair fits`)
      assert.equal(group?.solo, null, "No swap while the pair fits")
    }
    assert.deepEqual(chains.map(chain => chain.label), ["6 ← from 1 (1 discarded)", "5 ← from 2", "3"])
    const keys = await page.evaluate(() => { const canvas = window.gallery.view().canvas; return canvas._tag === "Frames" ? canvas.frames.map(frame => frame.key) : [] })
    for (const key of keys) assert.equal(await page.locator(`${cal("frame")}[data-frame-key="${key}"]`).count(), 1, `Frame ${key} is drawn once`)
    assert.equal(await page.locator(cal("frame")).count(), keys.length, "No frame is drawn that the view does not have")
    assert.equal(await page.locator(`${cal("chain")} [data-frame-key="real"]`).count(), 0, "The real files are in no chain")
    const look = await page.evaluate(() => {
      const screen = (/** @type {string} */ key) => /** @type {HTMLElement} */ (document.querySelector(`.dr-frame[data-frame-key="${key}"] .dr-frame__screen`))
      const top = (/** @type {string} */ key) => screen(key).getBoundingClientRect().top
      const heads = [...document.querySelectorAll(".dr-chain__head")].map(node => Math.round(node.getBoundingClientRect().top))
      const real = document.querySelector('[data-frame-key="real"]')
      const first = document.querySelector('[data-cal="chain"]')
      return {
        parent: getComputedStyle(screen("1@2026-09-29T13:01")).opacity, shown: getComputedStyle(screen("6@2026-09-29T13:06")).opacity,
        flagged: getComputedStyle(screen("3@2026-09-29T13:03")).opacity,
        tops: [top("real"), top("1@2026-09-29T13:01"), top("6@2026-09-29T13:06")], heads,
        realFirst: !!real && !!first && Boolean(real.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING),
      }
    })
    assert.equal(look.parent, "0.78", "The parent's page is drawn at 78 %")
    assert.equal(look.shown, "1")
    assert.equal(look.flagged, "0.6", "A flagged chain is dimmer still")
    assert(Math.max(...look.tops) - Math.min(...look.tops) < 1, `The real files and the first pair start on one line: ${look.tops}`)
    assert.equal(look.heads[1], look.heads[2], "Heads of one band line up")
    assert(look.realFirst, "The real files come before the chains")
  } finally { await close() }
})
await gate("chains: the history opens and folds with its frames kept; a discarded step is inert; a present step opens its take", async () => {
  const { page, close } = await open(desk, "takes")
  try {
    const [first] = await viewChains(page)
    assert(first)
    const frame = page.frameLocator(`${cal("frame")}[data-take="6"]`)
    await frame.locator("body").click()
    const taps = () => frame.locator("body").getAttribute("data-taps")
    const parent = await page.locator(`${cal("frame")}[data-take="1"]`).elementHandle()
    const toggle = page.locator(`${cal("chain-history")}[data-chain="${first.id}"]`)
    assert.equal(await toggle.getAttribute("aria-expanded"), "false")
    assert.equal(await toggle.textContent(), "3 in chain")
    await toggle.click()
    assert.deepEqual((await called(page, "onChainHistory")).at(-1)?.args, [first.id, true])
    assert.equal(await toggle.getAttribute("aria-expanded"), "true")
    const steps = page.locator(`${cal("chain-step")}[data-chain="${first.id}"]`)
    assert.deepEqual(await steps.allTextContents(), ["Take 1", "Take 4, discarded", "Take 6"])
    assert(await parent?.evaluate(node => node.isConnected), "Opening the history keeps the pair's frames")
    assert.equal(await taps(), "1", "Opening the history keeps the state reached in a frame")
    const gone = page.locator(`${cal("chain-step")}[data-take="4"]`)
    assert.equal(await gone.getAttribute("aria-disabled"), "true")
    assert.equal(await gone.evaluate(node => node.tagName), "SPAN", "A discarded step is not a control")
    assert.equal(await gone.locator("s").count(), 1, "A discarded step is struck through")
    const before = (await called(page, "onTake")).length
    await gone.click({ force: true })
    assert.equal((await called(page, "onTake")).length, before, "A discarded step selects nothing")
    await toggle.click()
    assert.deepEqual((await called(page, "onChainHistory")).at(-1)?.args, [first.id, false])
    assert.equal(await steps.count(), 0)
    assert(await parent?.evaluate(node => node.isConnected), "Folding keeps the frames")
    assert.equal(await taps(), "1")
    assert.equal((await mounts(page))["6@2026-09-29T13:06"], 1, "The shown take mounted once")
  } finally { await close() }
  const branch = await open(desk, "chainHistory")
  try {
    const [first] = await viewChains(branch.page)
    assert(first)
    const steps = branch.page.locator(`${cal("chain-step")}[data-chain="${first.id}"]`)
    assert.deepEqual(await steps.allTextContents(), ["Take 1", "Take 4, discarded", "Take 6", "Take 7"], "A branch stays in the history")
    assert.equal(await branch.page.locator(`${cal("chain-step")}[aria-current="true"]`).textContent(), "Take 6")
    await branch.page.locator(`${cal("chain-step")}[data-chain="${first.id}"][data-take="7"]`).click()
    assert.deepEqual((await called(branch.page, "onTake")).at(-1)?.args, ["7"])
    const [after] = await drawnChains(branch.page)
    assert.equal(after?.heading, "7 ← from 1", "The picked take opens in the pair beside its own parent (choice 16)")
    assert.deepEqual(after?.frames, ["1@2026-09-29T14:01", "7@2026-09-29T14:07"])
    assert.match(await branch.page.locator(".dr-bar").textContent() ?? "", /Take 7/, "The bar follows the picked take")
  } finally { await branch.close() }
})
await gate("chains: the flag shows with its reason; the record writes it out; the bar has no accept note", async () => {
  const { page, close } = await open(desk, "takes")
  try {
    const flag = page.locator(cal("chain-flag"))
    assert.equal(await flag.count(), 1, "Only take 3 was made before an accept that touched its files")
    assert(await flag.isVisible())
    const summary = flag.locator("summary")
    assert.equal(await summary.textContent(), "made before take 8 was accepted")
    assert.match(await summary.getAttribute("title") ?? "", /Take 8 changed src\/atoms\/PicoButton\.css/)
    assert.equal(await page.locator(`${cal("chain")}[data-chain="${(await viewChains(page))[2]?.id}"] ${cal("chain-flag")}`).count(), 1, "The flag is in its chain's head")
    assert.equal(await flag.locator(".dr-flag__detail").isVisible(), false)
    await summary.focus()
    await page.keyboard.press("Enter")
    assert(await flag.locator(".dr-flag__detail").isVisible(), "The reason opens from the keyboard")
    assert.match(await flag.locator(".dr-flag__detail").textContent() ?? "", /Accepting this take can undo that/)
    const colours = await page.evaluate(() => ({
      flag: getComputedStyle(/** @type {Element} */ (document.querySelector('[data-cal="chain-flag"] summary'))).color,
      warn: getComputedStyle(/** @type {Element} */ (document.querySelector('[data-cal="chrome"]'))).getPropertyValue("--dr-warn").trim(),
    }))
    assert.equal(colours.flag, colours.warn, "The flag is in the warn colour")
  } finally { await close() }
  const record = await open(desk, "chainsAccepted")
  try {
    assert.equal(await record.page.locator(cal("chain-flag")).count(), 3, "After an accept of this part every chain is flagged")
    assert.equal(await record.page.locator(`${cal("take-record")} .dr-record__lineage`).textContent(), "Chain: 7 ← from 3 (1 discarded)")
    const full = record.page.locator(`${cal("take-record")} .dr-flag--full`)
    assert.match(await full.textContent() ?? "", /made before take 8 was accepted.*Take 8 changed src\/pages\/PicoGameDetail\.css in this part/)
    assert(await full.isVisible(), "The record writes the reason out")
    assert.doesNotMatch(await record.page.locator(".dr-bar").textContent() ?? "", /also removes|made before/, "No accept note and no flag in the bar (choice 20)")
  } finally { await record.close() }
})
await gate("chains: at RG353M widths a pair that does not fit shows one frame and swaps through core", async () => {
  const fold = await open({ width: 1000, height: 680 }, "takes")
  try {
    const rule = await pairRule(fold.page)
    assert.equal(rule.pairs, "fit", `The unfolded Fold holds an RG353M pair: ${JSON.stringify(rule)}`)
    assert.equal(await fold.page.locator(cal("chain-solo")).count(), 0)
  } finally { await fold.close() }
  const { page, close } = await open(phone, "takes")
  try {
    const rule = await pairRule(page)
    assert.equal(rule.pairs, "solo", `A phone does not hold an RG353M pair: ${JSON.stringify(rule)}`)
    const [first] = await viewChains(page)
    assert(first?.parent)
    let [drawn] = await drawnChains(page)
    assert.deepEqual(drawn?.showing, [first.shown], "The shown take, named by core's `solo`")
    assert.deepEqual(drawn?.frames, [first.parent, first.shown], "The parent stays mounted, hidden")
    const swap = page.locator(`${cal("chain-solo")}[data-chain="${first.id}"]`)
    assert.equal(await swap.getAttribute("data-solo"), "Shown")
    assert.equal(await swap.textContent(), "Show take 1")
    assert.equal(await page.locator(`${cal("chain")}[data-chain="${(await viewChains(page))[2]?.id}"] ${cal("chain-solo")}`).count(), 0, "A chain of one has nothing to swap")
    const shown = await page.locator(`${cal("frame")}[data-frame-key="${first.shown}"]`).elementHandle()
    await swap.click()
    assert.deepEqual((await called(page, "onChainSolo")).at(-1)?.args, [first.id, "Parent"], "The swap goes through core (choice 19)")
    ;[drawn] = await drawnChains(page)
    assert.deepEqual(drawn?.showing, [first.parent])
    assert.equal(await swap.getAttribute("data-solo"), "Parent")
    assert.equal(await swap.textContent(), "Show take 6")
    assert(await shown?.evaluate(node => node.isConnected), "Swapping keeps the other frame mounted")
    await swap.click()
    assert.deepEqual((await called(page, "onChainSolo")).at(-1)?.args, [first.id, "Shown"])
    const count = await mounts(page)
    assert.deepEqual([count[first.parent], count[first.shown]], [1, 1], "No frame remounted")
  } finally { await close() }
  const parent = await open(phone, "chainsAccepted")
  try {
    const chains = await viewChains(parent.page)
    const gap = chains.find(chain => chain.parent)
    assert.equal(gap?.label, "7 ← from 3 (1 discarded)")
    const drawn = (await drawnChains(parent.page)).find(chain => chain.id === gap?.id)
    assert.deepEqual(drawn?.showing, [gap?.parent], "Core's remembered side: the parent")
    assert.equal(drawn?.solo, "Parent")
  } finally { await parent.close() }
})
await gate("chains: at ODIN 2 PORTAL widths a desk shows one frame of each chain, a wider screen the pair", async () => {
  const { page, close } = await open(desk, "takes")
  try {
    assert.equal((await pairRule(page)).pairs, "fit")
    await page.locator(`${cal("device")}[data-device="odin2portal"]`).click()
    await page.waitForFunction(() => document.querySelector('[data-cal="canvas"]')?.getAttribute("data-pairs") === "solo")
    const rule = await pairRule(page)
    assert(rule.need > rule.width, `The rule is per device: ${JSON.stringify(rule)}`)
    assert.equal(await page.locator(cal("chain-solo")).count(), 2, "Both chains with a parent get the swap")
  } finally { await close() }
  const wide = await open({ width: 1920, height: 1200 }, "chainsOdin")
  try {
    const rule = await pairRule(wide.page)
    assert.equal(rule.pairs, "fit", `A 1920 px chrome holds an ODIN pair: ${JSON.stringify(rule)}`)
    const [drawn] = await drawnChains(wide.page)
    assert.equal(drawn?.showing.length, 2)
  } finally { await wide.close() }
})
for (const fixture of ["takes", "chainHistory", "chainsAccepted", "chainsOdin"]) {
  await gate(`chains: every take reachable in ${fixture} at every size`, async () => {
    for (const size of [...LADDER, ...SIZES]) {
      const { page, close } = await open(size, fixture)
      const where = `${fixture} ${size.width}x${size.height}`
      try {
        const rule = await pairRule(page)
        assert.equal(rule.pairs, rule.need <= rule.width + 0.01 ? "fit" : "solo", `${where}: the fit follows two frames and a gap: ${JSON.stringify(rule)}`)
        /** Visible, with a box, and on screen or inside a region that scrolls. @param {import("playwright-core").Locator} node */
        const reachable = node => node.evaluate(element => {
          if (!(element instanceof HTMLElement) || !element.checkVisibility({ visibilityProperty: true })) return false
          const rect = element.getBoundingClientRect()
          if (rect.width < 1 || rect.height < 1) return false
          if (rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1) return true
          for (let at = element.parentElement; at; at = at.parentElement) {
            const style = getComputedStyle(at)
            if (/(auto|scroll)/.test(style.overflowY + style.overflowX) && (at.scrollHeight > at.clientHeight + 1 || at.scrollWidth > at.clientWidth + 1)) return true
          }
          return false
        })
        for (const chain of await viewChains(page)) {
          // Unfold every history, so every take the chain has is a step.
          const toggle = page.locator(`${cal("chain-history")}[data-chain="${chain.id}"]`)
          if (chain.history._tag !== "None") {
            assert(await reachable(toggle), `${where}: chain ${chain.label}'s history is in reach`)
            if (chain.history._tag === "Folded") await toggle.evaluate(node => /** @type {HTMLElement} */ (node).click())
          }
          for (const key of [chain.parent, chain.shown]) {
            if (!key) continue
            const name = page.locator(`${cal("frame-select")}[data-frame-key="${key}"]`)
            if (await reachable(name)) continue
            const swap = page.locator(`${cal("chain-solo")}[data-chain="${chain.id}"]`)
            assert(await swap.count() && await reachable(swap), `${where}: frame ${key} is neither drawn nor one swap away`)
            await swap.evaluate(node => /** @type {HTMLElement} */ (node).click())
            assert(await reachable(name), `${where}: after the swap frame ${key} shows`)
          }
        }
        const steps = await page.evaluate(() => { const canvas = window.gallery.view().canvas; return canvas._tag === "Frames" ? canvas.chains.flatMap(chain => chain.history._tag === "Open" ? chain.history.steps.filter(step => step._tag === "Present").map(step => ({ chain: chain.id, take: step.take })) : []) : [] })
        for (const step of steps) assert(await reachable(page.locator(`${cal("chain-step")}[data-chain="${step.chain}"][data-take="${step.take}"]`)), `${where}: take ${step.take} is in reach in its history`)
        const takes = await page.evaluate(() => window.gallery.view().navigation.parts.flatMap(part => part.states.flatMap(state => state.takes.map(take => take.id))))
        const onCanvas = new Set([...steps.map(step => step.take), ...(await viewChains(page)).map(chain => chain.take)])
        assert.deepEqual(takes.filter(take => !onCanvas.has(take)), [], `${where}: every take of the state is on the canvas or a step of its chain`)
      } finally { await close() }
    }
  })
}

// ---------------------------------------------------------------- 2d. references and marks on the original (phase 6)
/** The type-ahead's options, as mark ids, in order. @param {import("playwright-core").Page} page */
const offered = page => page.locator(cal("mark-reference")).evaluateAll(nodes => nodes.map(node => node.getAttribute("data-mark-id")))
/** @param {import("playwright-core").Page} page */
const activeOption = page => page.locator(`${cal("mark-reference")}[aria-selected="true"]`).getAttribute("data-mark-id")
/** @param {import("playwright-core").Page} page */
const noteFocused = page => page.locator(cal("mark-note")).evaluate(node => node === document.activeElement)
const TYPED = "Too heavy. Thin the border to one pixel, like 0"

await gate("references: typing a take number offers its marks; arrows, then Enter or Tab, put the name into the note", async () => {
  const { page, close } = await open(desk, "typeahead")
  try {
    const field = page.locator(cal("mark-note"))
    assert(await noteFocused(page), "The note has focus when it opens")
    assert.equal(await field.inputValue(), TYPED)
    assert.deepEqual(await offered(page), ["m-0a", "m-0b"], "A note ending in 0 offers the marks on the real files")
    assert.equal(await field.getAttribute("aria-expanded"), "true")
    assert.equal(await activeOption(page), "m-0a")
    assert.equal(await page.locator(`${cal("mark-reference")} iframe`).count(), 2, "One crop page for each option drawn")
    await page.keyboard.press("ArrowDown")
    assert.equal(await activeOption(page), "m-0b")
    assert.equal(await field.getAttribute("aria-activedescendant"), await page.locator(`${cal("mark-reference")}[aria-selected="true"]`).getAttribute("id"))
    await page.keyboard.press("ArrowDown")
    assert.equal(await activeOption(page), "m-0a", "Arrows wrap")
    await page.keyboard.press("ArrowUp")
    await page.keyboard.press("Enter")
    assert.deepEqual((await called(page, "onMarkNote")).at(-1)?.args, ["m-6b", `${TYPED}B `], "Enter writes the name in place of what was typed")
    assert.equal(await page.locator(cal("mark-reference")).count(), 0, "Picking closes the list")
    assert.equal(await field.count(), 1, "and keeps the note open")
    assert.equal((await called(page, "onMarkEdit")).length, 0)
    assert(await noteFocused(page))
    await page.keyboard.type("and 5")
    assert.deepEqual(await offered(page), ["m-5a"])
    await page.keyboard.press("Tab")
    assert.equal(await field.inputValue(), `${TYPED}B and 5A `, "Tab picks too")
    assert(await noteFocused(page), "Tab keeps focus in the note")
    await page.keyboard.press("Enter")
    assert.deepEqual((await called(page, "onMarkEdit")).at(-1)?.args, [null], "With the list closed, Enter closes the note")
  } finally { await close() }
})
await gate("references: the list filters by what is typed; a lost mark has no picture; a note never offers its own take", async () => {
  const { page, close } = await open(desk, "typeahead")
  try {
    assert.deepEqual(await offered(page), ["m-0a", "m-0b"])
    await page.keyboard.type("b")
    assert.deepEqual(await offered(page), ["m-0b"], "0b narrows the list to 0B")
    await page.keyboard.press("Backspace")
    assert.deepEqual(await offered(page), ["m-0a", "m-0b"])
    await page.keyboard.press("Backspace")
    assert.equal(await page.locator(cal("mark-reference")).count(), 0, "No take number, no list")
    await page.keyboard.type("3")
    assert.deepEqual(await offered(page), ["m-3a"])
    const lost = page.locator(`${cal("mark-reference")}[data-mark-id="m-3a"]`)
    assert.equal(await lost.getAttribute("data-picture"), "none")
    assert.equal(await lost.locator("iframe").count(), 0, "A lost mark loads no page")
    assert.match(await lost.textContent() ?? "", /No picture/)
    await page.keyboard.type("Z")
    assert.equal(await page.locator(cal("mark-reference")).count(), 0, "3Z matches nothing")
    await page.keyboard.press("Backspace")
    await page.keyboard.press("Backspace")
    await page.keyboard.type("6")
    assert.equal(await page.locator(cal("mark-reference")).count(), 0, "6B's note does not point to take 6")
    await page.keyboard.press("Backspace")
    await page.keyboard.type("2")
    const other = page.locator(`${cal("mark-reference")}[data-mark-id="m-2a"]`)
    assert.match(await other.textContent() ?? "", /2A.*Take 2/)
    assert.equal(await other.locator("iframe").getAttribute("width"), "1920", "A crop keeps the viewport of the device the mark was placed on")
  } finally { await close() }
})
await gate("references: Escape closes the list and keeps the note and mark mode; typing on opens it again", async () => {
  const { page, close } = await open(desk, "typeahead")
  try {
    assert.equal(await page.locator(cal("mark-reference")).count(), 2)
    await page.keyboard.press("Escape")
    assert.equal(await page.locator(cal("mark-reference")).count(), 0, "Escape closes the list")
    assert.equal(await page.locator(cal("mark-note")).count(), 1, "and not the note")
    assert(await noteFocused(page))
    assert.equal(await page.locator(cal("mark-note")).inputValue(), TYPED, "The note is as it was")
    assert.equal((await called(page, "onMarkEdit")).length, 0)
    assert.equal(await page.locator(cal("mark-mode")).getAttribute("aria-pressed"), "true", "and not mark mode")
    assert.equal(await page.locator(cal("mark-note")).getAttribute("aria-expanded"), "false")
    await page.keyboard.press("ArrowDown")
    assert.equal(await page.locator(cal("mark-reference")).count(), 2, "ArrowDown opens it again")
    await page.keyboard.press("Escape")
    await page.keyboard.type("A")
    assert.deepEqual(await offered(page), ["m-0a"], "Typing on opens it again")
    await page.keyboard.press("Escape")
    await page.keyboard.press("Escape")
    assert.deepEqual((await called(page, "onMarkEdit")).at(-1)?.args, [null], "Escape with the list closed closes the note")
    assert.equal(await page.locator(cal("mark-mode")).getAttribute("aria-pressed"), "true")
  } finally { await close() }
})
await gate("references: a press on an option picks it and keeps focus in the note", async () => {
  const { page, close } = await open(desk, "typeahead")
  try {
    await page.locator(`${cal("mark-reference")}[data-mark-id="m-0b"]`).click()
    assert.deepEqual((await called(page, "onMarkNote")).at(-1)?.args, ["m-6b", `${TYPED}B `])
    assert(await noteFocused(page), "The press did not take focus from the note")
    assert.equal(await page.locator(cal("mark-reference")).count(), 0)
  } finally { await close() }
})
await gate("references: each draft group says what Send does with it; names in notes are set apart, never rewritten", async () => {
  const { page, close } = await open(desk, "references")
  try {
    const groups = await page.evaluate(() => {
      const markup = window.gallery.view().markup
      return markup._tag === "Ready" ? markup.groups.map(group => ({ take: group.source.take, label: group.label, outcome: group.outcome, marks: group.marks.map(mark => ({ id: mark.id, note: mark.note, references: mark.references })) })) : []
    })
    assert.deepEqual(groups.map(group => [group.take, group.outcome._tag]), [["0", "PointedTo"], ["6", "NewTake"], ["5", "NewTake"], ["3", "PointedTo"], ["2", "NewTake"]])
    for (const group of groups) {
      const row = page.locator(`.dr-dtake[data-take="${group.take}"]`)
      const outcome = row.locator(cal("draft-outcome"))
      assert.equal(await outcome.getAttribute("data-outcome"), group.outcome._tag)
      assert.equal(await outcome.textContent(), group.outcome.label, `Group ${group.take} reads core's sentence`)
      assert.equal(await row.getAttribute("aria-label"), group.label)
      for (const mark of group.marks) {
        const note = page.locator(`${cal("mark-edit")}[data-mark-id="${mark.id}"]`)
        assert.equal(await note.textContent(), mark.note, `${mark.id}'s note is not rewritten`)
        assert.deepEqual(await note.locator(".dr-ref").allTextContents(), mark.references, `${mark.id}'s names are set apart`)
      }
    }
    assert.deepEqual(await page.locator(`.dr-dtake[data-take="0"] ${cal("draft-outcome")} .dr-ref`).allTextContents(), ["6B", "5A"], "The names in the outcome are set apart too")
    assert.match(await page.locator('.dr-dtake[data-take="0"] .dr-dtake__head').textContent() ?? "", /^Original\s*the real files$/)
    assert.equal(await page.locator(cal("marks-send")).textContent(), "Send · 3 new takes")
    assert.equal(await page.locator('.dr-dtake[data-take="3"] .dr-dtake__thumb').evaluate(node => getComputedStyle(node).opacity), "0.78", "Material for another take is drawn as a pair's parent is")
    assert.equal(await page.locator('.dr-dtake[data-take="6"] .dr-dtake__thumb').evaluate(node => getComputedStyle(node).opacity), "1")
    assert.match(await page.locator(`${cal("mark-pin")}[data-mark-id="m-6b"]`).getAttribute("title") ?? "", /^Mark 6B: .*like 0A\. Points to 0A\.$/, "A pin's title reads its note and what it points to")
    // A reference typed in the draft's own editor changes what Send does.
    await page.locator(`${cal("mark-edit")}[data-mark-id="m-6a"]`).click()
    await page.locator(`${cal("mark-note")}[data-mark-id="m-6a"]`).waitFor()
    await page.keyboard.type(" 0")
    assert.deepEqual(await offered(page), ["m-0a"])
    await page.keyboard.press("Enter")
    assert.deepEqual((await called(page, "onMarkNote")).at(-1)?.args, ["m-6a", "Love this 0A "])
    await page.keyboard.press("Enter")
    assert.deepEqual(await page.locator(`${cal("mark-edit")}[data-mark-id="m-6a"] .dr-ref`).allTextContents(), ["0A"])
    assert.equal(await page.locator(`.dr-dtake[data-take="0"] ${cal("draft-outcome")}`).textContent(), "Pointed to by 6A, 6B and 5A; makes no take.")
  } finally { await close() }
})
await gate("references: marks on the real files go with a typed prompt; the line says so and New take stays the main button", async () => {
  const { page, close } = await open(desk, "withPrompt")
  try {
    const line = page.locator(cal("prompt-marks"))
    const main = page.locator(".dr-split__main")
    const outcome = page.locator(`.dr-dtake[data-take="0"] ${cal("draft-outcome")}`)
    assert.equal(await line.textContent(), "0A and 0B go with this prompt.")
    assert.deepEqual(await line.locator(".dr-ref").allTextContents(), ["0A", "0B"])
    assert(await line.evaluate(node => node.closest(".dr-well") !== null), "The line is in the well, with the prompt")
    assert.equal(await main.getAttribute("data-cal"), "take-start", "New take is the main half")
    assert.equal(await outcome.getAttribute("data-outcome"), "WithPrompt")
    await page.getByRole("button", { name: "New take options" }).click()
    assert.equal(await page.getByRole("menuitem", { name: "Send · 1 new take" }).getAttribute("data-cal"), "marks-send", "Send is at the top of the menu")
    await page.keyboard.press("Escape")
    await page.locator(cal("prompt")).fill("")
    assert.equal(await line.count(), 0, "No prompt, no marks with it")
    assert.equal(await outcome.getAttribute("data-outcome"), "NewTake")
    assert.equal(await main.getAttribute("data-cal"), "marks-send", "Without a prompt Send is the main half again")
    await page.locator(cal("prompt")).fill("Tidy the actions")
    assert.equal(await line.textContent(), "0A and 0B go with this prompt.")
    await page.locator(cal("prompt")).press("Control+Enter")
    assert.equal((await called(page, "onStart")).length, 1)
    assert.equal(await line.count(), 0, "The marks left the draft with New take")
    assert.equal(await page.locator(cal("draft-open")).count(), 0)
  } finally { await close() }
})
await gate("references: the real files take marks in mark mode, by pointer and by keyboard, named 0A, 0B and on", async () => {
  const { page, close } = await open(desk, "original")
  try {
    const real = page.locator('.dr-frame[data-frame-key="real"]')
    assert.equal(await real.getAttribute("data-marking"), "true", "The real files get the dashed edge")
    assert.deepEqual(await real.locator(cal("mark-pin")).evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label"))),
      ["Mark 0A: The old actions list was clearer.", "Mark 0B: The title's size was right."])
    const surface = page.locator(`${cal("mark-surface")}[data-frame-key="real"]`)
    const box = await surface.boundingBox()
    assert(box)
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.25)
    const point = (await called(page, "onMarkPoint")).at(-1)
    assert.equal(point?.args[0], "real")
    near(parsed(point?.args[1]).x, 480, "x"); near(parsed(point?.args[1]).y, 120, "y")
    await page.locator(`${cal("mark-note")}`).waitFor()
    assert.equal(await page.locator(".dr-note__name").textContent(), "0C")
    await page.keyboard.type("Quieter")
    await page.keyboard.press("Enter")
    const key = page.locator(`${cal("mark-point")}[data-frame-key="real"]`)
    await key.focus()
    await page.keyboard.press("Enter")
    assert.deepEqual(parsed((await called(page, "onMarkPoint")).at(-1)?.args[1]), { x: 320, y: 240 }, "Pin places a mark from the keyboard")
    await page.keyboard.press("Escape")
    await page.locator(cal("draft-open")).click()
    const group = page.locator('.dr-dtake[data-take="0"]')
    assert.equal(await group.getAttribute("aria-label"), "Original · the real files")
    assert.equal(await group.locator(".dr-dmark").count(), 4)
    assert.equal(await group.locator(cal("draft-outcome")).textContent(), "Send makes a new take.")
    assert.equal(await page.locator(cal("marks-send")).textContent(), "Send · 1 new take")
    assert.match(await page.locator(".dr-draft__head").textContent() ?? "", /4 marks\s*on the real files/)
  } finally { await close() }
})
await gate("references: the type-ahead, its options and its note are in reach at every size", async () => {
  for (const size of [...LADDER, ...SIZES]) {
    const { page, close } = await open(size, "typeahead")
    const where = `${size.width}x${size.height}`
    try {
      await page.locator(cal("mark-reference")).first().waitFor({ state: "attached" })
      await page.waitForTimeout(60)
      const report = await page.evaluate(() => {
        const inside = (/** @type {DOMRect} */ rect, /** @type {{ top: number, bottom: number, left: number, right: number }} */ box) => rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1 && rect.left >= box.left - 1 && rect.right <= box.right + 1
        const screen = { top: 0, left: 0, bottom: innerHeight, right: innerWidth }
        const list = /** @type {HTMLElement} */ (document.querySelector(".dr-refs"))
        const field = /** @type {HTMLElement} */ (document.querySelector('[data-cal="mark-note"]'))
        const problems = []
        if (!list.matches(":popover-open") || getComputedStyle(list).visibility === "hidden") problems.push("the list is not shown")
        if (!inside(field.getBoundingClientRect(), screen)) problems.push(`the note is off screen: ${JSON.stringify(field.getBoundingClientRect())}`)
        const box = list.getBoundingClientRect()
        if (!inside(box, screen)) problems.push(`the list leaves the window: ${JSON.stringify(box)}`)
        const scrolls = list.scrollHeight > list.clientHeight + 1
        for (const option of list.querySelectorAll('[data-cal="mark-reference"]')) {
          const rect = option.getBoundingClientRect()
          if (rect.width < 1 || rect.height < 1) problems.push(`${option.getAttribute("data-mark-id")} has no box`)
          else if (!inside(rect, box) && !scrolls) problems.push(`${option.getAttribute("data-mark-id")} is cut off in a list that does not scroll`)
        }
        const overlap = field.getBoundingClientRect()
        if (overlap.bottom > box.top + 1 && overlap.top < box.bottom - 1) problems.push("the list covers the note")
        return problems
      })
      assert.deepEqual(report, [], where)
    } finally { await close() }
  }
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
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "2 takes")
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
    // A sheet that is not in front stays mounted behind (react-chrome-ui-notes.md); Preview hides it.
    assert.equal(await page.locator(cal("take-record")).isVisible(), false, "The record sheet goes behind")
    assert(await page.locator(cal("composer")).isVisible(), "Preview shows the canvas and its bar")
  } finally { await close() }
})
// The tool rule (src/client/tool-rule.ts): closing brings back the most recent tool still open, else Preview.
/** @param {import("playwright-core").Page} page */
const pressedTools = page => page.locator('.dr-tools [aria-pressed="true"]').evaluateAll(nodes => nodes.map(node => node.getAttribute("data-tool")))
await gate("tools: closing Checks brings back the tool that was in front", async () => {
  const { page, close } = await open(desk, "code")
  try {
    assert.deepEqual(await pressedTools(page), ["code"])
    await page.locator(`${cal("tool")}[data-tool="checks"]`).click()
    await page.locator(cal("checks")).waitFor({ state: "visible" })
    assert.deepEqual(await pressedTools(page), ["checks"])
    await page.keyboard.press("Escape")
    await page.locator(cal("checks")).waitFor({ state: "detached" })
    assert.deepEqual(await pressedTools(page), ["code"], "Code is pressed again, not Takes and not Checks")
    assert(await page.locator(cal("code")).isVisible(), "The code pane is still open")
  } finally { await close() }
})
await gate("tools: Close Knobs closes the panel on a desk", async () => {
  const { page, close } = await open(desk, "knobs")
  try {
    await page.locator(cal("knobs")).waitFor({ state: "visible" })
    await page.getByRole("button", { name: "Close Knobs" }).click()
    await page.locator(cal("knobs")).waitFor({ state: "detached" })
    assert.equal((await called(page, "onKnobsClose")).length, 1)
    assert.equal((await called(page, "onTool")).length, 0, "Close is not a tool press")
  } finally { await close() }
})
await gate("tools: Close Code on a phone brings back Preview when nothing else is open", async () => {
  const { page, close } = await open(phone, "code")
  try {
    assert.deepEqual(await pressedTools(page), ["code"])
    await page.getByRole("button", { name: "Close Code" }).click()
    assert.equal((await called(page, "onCodeClose")).length, 1)
    await page.locator(cal("code")).waitFor({ state: "detached" })
    assert.deepEqual(await pressedTools(page), ["preview"])
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
})
await gate("keyboard: token lists preview with arrows, write on Enter, restore on Escape", async () => {
  const { page, close } = await open(desk, "knobs")
  try {
    const trigger = page.locator(`${cal("knob")}[data-knob="accent"] .dr-token__trigger`)
    await trigger.focus()
    await page.keyboard.press("ArrowDown")
    await page.locator(`${cal("knob-token")}[data-knob="accent"][aria-selected="true"]`).waitFor({ state: "visible" })
    // The list moves focus in the next animation frame; under load that frame can come after the list shows.
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-token") === "--pico-pink", undefined, { timeout: 2000 })
      .catch(() => assert.fail("The list opens on the chosen token"))
    await page.keyboard.press("ArrowDown")
    assert.deepEqual((await called(page, "onKnobInput")).at(-1)?.args, ["accent", "var(--pico-peach)"], "An arrow previews the next token")
    assert.equal((await called(page, "onKnobCommit")).filter(call => call.args[0] === "accent").length, 0, "An arrow writes nothing")
    await page.keyboard.press("Enter")
    assert.deepEqual((await called(page, "onKnobCommit")).at(-1)?.args, ["accent", "var(--pico-peach)"], "Enter writes the previewed token")
    assert(await trigger.evaluate(node => node === document.activeElement), "Focus returns to the field")
    await page.keyboard.press("ArrowDown")
    await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "option")
    await page.keyboard.press("ArrowUp")
    await page.keyboard.press("Escape")
    assert.deepEqual((await called(page, "onKnobCancel")).at(-1)?.args, ["accent"], "Escape puts the value back")
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
  for (const fixture of ["takes", "log", "knobs", "code", "planning", "running", "agentFailed", "checks", "calibrate", "mark", "draft", "sendFailed", "chainHistory", "chainsAccepted", "chainsOdin",
    "references", "typeahead", "original", "withPrompt",
    // Decision 45: a workspace's board, at the same ladder.
    "workspaceNew", "workspaceFrame", "workspacePlanning", "workspaceRunning", "workspaceBoard", "workspaceClosed"]) {
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
