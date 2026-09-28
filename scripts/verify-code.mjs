#!/usr/bin/env node
// @ts-check
/**
 * Check the code pane in a real browser, against a running project dev server.
 * It needs no model: every step is a hand edit.
 *
 *   CHROMIUM=/path/to/chromium node scripts/verify-code.mjs \
 *     --url http://127.0.0.1:5173 --root /path/to/project \
 *     --part src/ui/atoms/Button.atom.part.tsx [--out /tmp/caliper-code]
 *
 * It types in a real file and checks that the file on disk changes and the
 * frame renders it, then undoes the edit and checks the file is back. It
 * starts a take in the project's take folder, edits it in the pane, checks the
 * diff and Revert, follows a state lens to the stage, and takes screenshots at
 * four window sizes. It writes the real file back and discards its takes, even
 * when a step fails.
 */
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { chromium } from "playwright-core"
import { createTakeStore } from "../src/takes/store.js"

const { values: args } = parseArgs({
  options: {
    url: { type: "string" },
    root: { type: "string" },
    part: { type: "string" },
    out: { type: "string", default: "/tmp/caliper-code" },
  },
})
if (!args.url || !args.part || !args.root) throw new Error("Pass --url, --root and --part.")
const store = createTakeStore(resolve(args.root))
const executablePath = process.env.CHROMIUM
if (!executablePath) throw new Error("Set CHROMIUM to a Chromium executable.")
const out = /** @type {string} */ (args.out)
const part = /** @type {string} */ (args.part)
mkdirSync(out, { recursive: true })
const base = new URL("/__caliper/", args.url).href
// A comment is valid on its own line in TypeScript, JavaScript and CSS.
const MARK = "/* caliper verify */"

/** @param {string} path */
const api = async path => (await fetch(new URL(path, base))).json()
/** @param {string} path @param {object} body */
const post = (path, body) => fetch(new URL(path, base), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
/** @param {() => Promise<boolean>} check @param {string} what */
const until = async (check, what) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out: ${what}`)
}
/** The real file this run edits, and its content before, to write back. @type {{ file: string, content: string } | null} */
let restore = null

const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
/** @type {string[]} */
const failures = []
/** @type {string | null} */
let take = null
/** Takes that existed before this run; the run discards every other take. */
const before = new Set((await api("takes.json")).takes.map((/** @type {any} */ view) => view.take))
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } })
try {
  page.on("pageerror", error => failures.push(`chrome page error: ${error.message}`))
  page.on("console", message => { if (message.type() === "error") failures.push(`chrome console: ${message.text()}`) })
  // Set the preferences before the chrome's script runs, and open the deep link
  // once. A first visit without the hash would race: the chrome writes its
  // first part into the URL when the project arrives.
  await page.addInitScript(() => {
    if (sessionStorage.getItem("caliper-verify")) return
    sessionStorage.setItem("caliper-verify", "1")
    localStorage.setItem("caliper:code-open", "true")
    localStorage.setItem("caliper:takes-open", "true")
    localStorage.removeItem("caliper:code-share")
  })
  const started = Date.now()
  await page.goto(`${base}#part=${encodeURIComponent(part)}&device=rg353m`)

  // 1. The pane opens the part's own component, as the real file.
  await page.locator(".cal-code .cm-editor").waitFor({ timeout: 20_000 })
  await page.locator(".cal-code-tab[aria-current='true']").waitFor()
  const editorMs = Date.now() - started
  const opened = /** @type {string} */ (await page.locator(".cal-code-path").getAttribute("title"))
  console.log(`editor ready in ${editorMs} ms, opened ${opened}`)
  assert.equal(await page.locator(".cal-code-chip-real").textContent(), "Real file")
  const real = await api(`code/file?file=${encodeURIComponent(opened)}`)
  restore = { file: opened, content: real.content }
  /** Read the real file on disk. */
  const onDisk = async () => /** @type {string} */ ((await api(`code/file?file=${encodeURIComponent(opened)}`)).content)

  // 2. Typing in a real file saves it, as any editor does, and starts no take.
  await page.locator(".cal-code .cm-content").click()
  // Insert a line after line 2: a change inside the file, not at its end.
  await page.keyboard.press("Control+Home")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("End")
  await page.keyboard.type(`\n${MARK}`)
  await page.locator(".cal-code-status", { hasText: /^Saved$/ }).waitFor({ timeout: 10_000 })
  assert.ok((await onDisk()).includes(`\n${MARK}\n`), "the real file has the edit")
  assert.equal(await page.locator(".cal-code-chip-real").textContent(), "Real file", "no take started")
  assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("take"), null)
  assert.deepEqual((await api("takes.json")).takes.map((/** @type {any} */ view) => view.take).filter((/** @type {string} */ id) => !before.has(id)), [])
  // Vite reloads the frame with the saved file, and it renders.
  await page.locator(".cal-stage [data-frame-state='Rendered']").first().waitFor({ timeout: 15_000 })

  // 3. Undo takes the edit back, and the save puts the file back as it was.
  await page.keyboard.press("Control+z")
  await until(async () => (await onDisk()) === real.content, "undo saves the real file back")
  await page.locator(".cal-code-status", { hasText: /^Saved$/ }).waitFor()
  restore = null

  // 4. A take's file shows against the real file, and edits save to the take.
  take = store.create({ part, state: "default", device: "rg353m" })
  const edited = real.content.replace(/\n/, `\n${MARK}\n`)
  // The same save the pane makes; it tells every open chrome about the take.
  assert.equal((await post(`takes/${take}/file`, { file: opened, content: edited })).status, 200)
  await page.goto(`${base}#part=${encodeURIComponent(part)}&state=takes%3Adefault&device=rg353m&take=${take}`)
  await page.reload()
  await page.locator(".cal-code-chip-take").waitFor({ timeout: 10_000 })
  await page.locator(`.cal-grid .cal-cell[data-key='take-${take}'][data-frame-state='Rendered']`).waitFor({ timeout: 15_000 })
  assert.equal(await onDisk(), real.content, "a take never changes the real file")

  // 5. The diff shows one change, and the tab counts its lines.
  await page.locator(".cal-code .cm-changedLine").first().waitFor()
  await page.getByText("1 change", { exact: true }).waitFor()
  const stat = await page.locator(".cal-code-tab[aria-current='true'] .cal-code-stat").textContent()
  console.log(`tab stat: ${stat}`)
  assert.match(stat ?? "", /\+1\s+−0/)
  await page.locator(".cal-log-edit").first().waitFor()
  await page.screenshot({ path: join(out, "take-1800x1000.png") })

  // 6. Revert puts the real lines back; the take then changes nothing.
  await page.locator(".cal-code .cm-cal-revert").first().dispatchEvent("mousedown")
  await page.getByText("Same as the real file").waitFor({ timeout: 10_000 })
  await until(async () => (await api("takes.json")).takes.find((/** @type {any} */ view) => view.take === take)?.files.length === 0, "the reverted take changes no file")

  // 7. A lens in the part file shows its state on the stage.
  const project = await api("project.json")
  const states = project.parts.find((/** @type {any} */ candidate) => candidate.file === part)?.states ?? []
  if (states.length > 1) {
    await page.locator(`.cal-code-tab[title='${part}']`).click()
    await page.locator(".cm-cal-lens").first().waitFor()
    assert.equal(await page.locator(".cm-cal-lens").count(), states.length, "one lens per state")
    const target = states[1]
    await page.locator(".cm-cal-lens button", { hasText: `Show ${target.label}` }).dispatchEvent("mousedown")
    await page.waitForFunction(exportName => new URLSearchParams(location.hash.slice(1)).get("state")?.endsWith(exportName), target.export)
    await page.locator(".cm-cal-lens button[data-current='true']", { hasText: target.label }).waitFor()
  } else {
    console.log("skipped lenses: the part has one state")
  }

  // 8. The pane and the stage share the room at every size.
  for (const [width, height] of [[1800, 1000], [1280, 900], [900, 1000], [700, 1100]]) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(300)
    const layout = await page.evaluate(() => {
      const box = (/** @type {string} */ selector) => document.querySelector(selector)?.getBoundingClientRect()
      const stage = box(".cal-stage")
      const code = box(".cal-code")
      return {
        beside: getComputedStyle(/** @type {Element} */ (document.querySelector(".cal-work"))).getPropertyValue("--cal-code-beside").trim(),
        stage: stage && { width: Math.round(stage.width), height: Math.round(stage.height) },
        code: code && { width: Math.round(code.width), height: Math.round(code.height) },
        scrolls: document.scrollingElement ? document.scrollingElement.scrollHeight > innerHeight : false,
      }
    })
    console.log(`${width}x${height}: ${JSON.stringify(layout)}`)
    assert.ok(layout.stage && layout.stage.width > 100 && layout.stage.height > 100, `the stage keeps room at ${width}x${height}`)
    assert.ok(layout.code && layout.code.width > 200 && layout.code.height > 120, `the code pane keeps room at ${width}x${height}`)
    assert.equal(layout.scrolls, false, "the page itself never scrolls")
    await page.screenshot({ path: join(out, `pane-${width}x${height}.png`) })
  }
} catch (error) {
  failures.push(error instanceof Error ? error.stack ?? error.message : String(error))
  await page.screenshot({ path: join(out, "failure.png") }).catch(() => {})
  failures.push(`screenshot of the failure: ${join(out, "failure.png")}`)
} finally {
  // Close the chrome first, so the pane cannot save again after the restore.
  await browser.close()
  if (restore !== null) {
    const restored = await post("code/file", restore)
    if (!restored.ok) failures.push(`could not write ${restore.file} back: ${(await restored.json()).error}`)
  }
  for (const view of (await api("takes.json")).takes) {
    if (before.has(view.take)) continue
    await post(`takes/${view.take}/discard`, {})
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"))
  process.exit(1)
}
console.log(`code pane verified; screenshots in ${out}`)
