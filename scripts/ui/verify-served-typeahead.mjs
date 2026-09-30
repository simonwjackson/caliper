#!/usr/bin/env -S nix develop -c node
// @ts-check
/**
 * The Darkroom type-ahead on the served chrome (phase 6), with no model: a
 * live subject, real frames, the real app wiring and the event stream in
 * Chromium. Marks go through Alt-click and notes through the keyboard. It
 * proves what the gallery cannot: the crop page loads from core's frame URL,
 * and a pick written through core's onMarkNote comes back with the caret
 * after the name, so typing and picking go on in one note.
 *
 *   nix develop -c node scripts/ui/verify-served-typeahead.mjs [screenshot folder]
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { chromium } from "playwright-core"
import { createServer } from "vite"
import { caliper } from "../../src/plugin.js"
import { installRouting, projectBase, startApp } from "../caliper-app.mjs"
import { createTakeStore } from "../../src/takes/store.js"

if (!process.env.CHROMIUM) throw new Error("Run with nix develop to supply CHROMIUM.")
const out = process.argv[2] ?? join("scripts", "ui", "out", "served")
mkdirSync(out, { recursive: true })
const checkout = fileURLToPath(new URL("../../", import.meta.url))
const root = mkdtempSync(join(tmpdir(), "caliper-served-typeahead-"))
const part = "src/Chip.part.tsx"
/** @param {string} file @param {string} source */
const put = (file, source) => { const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, source) }
put("package.json", JSON.stringify({ name: "served-typeahead", type: "module", exports: { ".": "./src/index.ts" } }))
put("tsconfig.json", JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }))
put("src/index.ts", 'import "./chip.css"\nexport {}\n')
put("src/chip.css", "body { margin: 0; font: 16px sans-serif; background: #203; color: #fff } .bar { display: flex; gap: 12px; padding: 24px } .chip { padding: 12px 20px; background: #fc0 } .tag { padding: 4px; background: #0cf; color: #000 }\n")
put("src/Chip.tsx", 'export function Chip() { return <div className="bar"><button className="chip">Menu</button><span className="tag">New</span></div> }\n')
put(part, 'import { Chip } from "./Chip"\nexport default function Part() { return <Chip /> }\n')
symlinkSync(resolve(checkout, "node_modules"), join(root, "node_modules"), "dir")
await build({ entryPoints: [join(checkout, "scripts/fixtures/markup-harness.tsx")], bundle: true, format: "esm", jsx: "automatic", outfile: join(root, "public/markup-harness.js"),
  alias: { "caliper-markup-renderer": join(checkout, "src/client/ui/Darkroom.tsx") }, loader: { ".ttf": "file", ".png": "file" }, assetNames: "[name]", publicPath: "/",
  define: { "process.env.NODE_ENV": '"development"' }, logLevel: "silent" })
const styles = existsSync(join(root, "public/markup-harness.css")) ? '<link rel="stylesheet" href="/markup-harness.css">' : ""
put("public/markup-harness.html", `<!doctype html><html><head><meta charset="utf-8"><base href="__caliper/"><title>Type-ahead harness</title>${styles}</head><body><div id="caliper"></div><script type="module" src="/markup-harness.js"></script></body></html>`)
const store = createTakeStore(root)
const [one, two] = ["Warm it", "Space it"].map(prompt => store.create({ part, state: "default", device: "rg353m", prompt }))
const vite = await createServer({ root, configFile: false, cacheDir: join(root, ".vite"), logLevel: "silent", server: { host: "127.0.0.1", port: 0 }, plugins: [caliper({ wrap: false })] })
await vite.listen()
// The Caliper app serves takes and marks (decision 37); the harness runs under the project's path in it.
const app = await startApp()
const url = await projectBase(app, root)
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
/** @type {string[]} */
const passed = []
/** @type {string[]} */
const failed = []
/** @param {unknown} condition @param {string} what */
const check = (condition, what) => { (condition ? passed : failed).push(what) }
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  /** @type {string[]} */
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await installRouting(page, app)
  await page.goto(new URL(`markup-harness.html#part=${part}&state=takes:default&take=${one}&device=rg353m`, url).href)
  /** @param {string} predicate a function of the ChromeView, as source */
  const until = (predicate, timeout = 20_000) => page.waitForFunction(`(${predicate})(window.caliperHarness?.snapshot())`, undefined, { timeout, polling: 50 })
  await until(`view => view?.markup?._tag === "Ready" && view.canvas._tag === "Frames" && view.canvas.frames.length === 3 && view.canvas.frames.every(frame => frame.verdict._tag === "Rendered")`, 30_000)
  /** Alt-click an element's centre in a take's frame, or the real files'. @param {string | null} take @param {string} selector */
  const altClick = async (take, selector) => {
    const box = await page.frameLocator(take ? `iframe[data-cal="frame"][data-take="${take}"]` : 'iframe[data-cal="frame"]:not([data-take])').locator(selector).first().boundingBox()
    if (!box) throw new Error(`${selector} has no box`)
    await page.keyboard.down("Alt"); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await page.keyboard.up("Alt")
  }
  await altClick(null, ".tag")
  await until(`view => view.markup.editor._tag === "Open" && view.markup.editor.name === "0A"`)
  await page.keyboard.type("too loud")
  await page.keyboard.press("Enter")
  await altClick(two ?? "", ".bar")
  await until(`view => view.markup.editor._tag === "Open" && view.markup.editor.name === "${two}A"`)
  await page.keyboard.type("this gap")
  await page.keyboard.press("Enter")
  await altClick(one ?? "", ".chip")
  await until(`view => view.markup.editor._tag === "Open" && view.markup.editor.name === "${one}A"`)
  await page.keyboard.type(`use ${two}`)
  await page.locator('[data-cal="mark-reference"]').first().waitFor()
  const offered = await page.locator('[data-cal="mark-reference"]').evaluateAll(nodes => nodes.map(node => node.getAttribute("data-mark-id")))
  const twoA = await page.evaluate(name => { const markup = /** @type {any} */ (window).caliperHarness.snapshot().markup; return markup.groups.flatMap((/** @type {any} */ group) => group.marks).find((/** @type {any} */ mark) => mark.name === name)?.id }, `${two}A`)
  check(offered.length === 1 && offered[0] === twoA, `typing ${two} offers only ${two}A: ${JSON.stringify(offered)}`)
  await page.frameLocator('[data-cal="mark-reference"] iframe').locator(".bar").waitFor({ timeout: 15_000 })
  check(true, "the crop loads the take's page from core's frame URL")
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, "served-typeahead.png") })
  await page.keyboard.press("Enter")
  await until(`view => view.markup.editor._tag === "Open" && view.markup.editor.note === "use ${two}A "`)
  check(true, `Enter writes "use ${two}A " through core and keeps the note open`)
  await page.keyboard.type("and 0")
  await page.locator('[data-cal="mark-reference"]').first().waitFor()
  await page.keyboard.press("Tab")
  await until(`view => view.markup.editor._tag === "Open" && view.markup.editor.note === "use ${two}A and 0A "`)
  check(true, "the caret follows the pick: typing on and Tab write 0A after it")
  await page.keyboard.press("Enter")
  await until(`view => view.markup.editor._tag === "Closed" && view.markup.groups.flatMap(group => group.marks).some(mark => mark.name === "${one}A" && mark.references.join() === "${two}A,0A")`)
  check(true, "the saved note names both marks")
  await page.locator('[data-cal="draft-open"]').click()
  const outcomes = await page.locator('[data-cal="draft-outcome"]').evaluateAll(nodes => nodes.map(node => node.getAttribute("data-outcome")))
  check(outcomes.join() === "PointedTo,PointedTo,NewTake", `the draft says what Send does with each group: ${outcomes}`)
  const chips = await page.locator('[data-cal="mark-edit"] .dr-ref').allTextContents()
  check(chips.join() === `${two}A,0A`, `the names are set apart in the note: ${chips}`)
  const where = await page.locator(".dr-dmark__where").count()
  check(where === 0, "marks placed on the shown state and device do not say where they were placed")
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, "served-draft.png") })
  check(errors.length === 0, `no page errors: ${JSON.stringify(errors)}`)
} catch (error) {
  failed.push(`harness: ${error instanceof Error ? error.stack : String(error)}`)
} finally {
  await browser.close()
  await app.close()
  await vite.close()
  rmSync(root, { recursive: true, force: true })
}
for (const line of passed) console.log(`PASS ${line}`)
for (const line of failed) console.error(`FAIL ${line}`)
console.log(`${passed.length} of ${passed.length + failed.length} served type-ahead checks passed. Screenshots in ${out}.`)
process.exit(failed.length ? 1 : 0)
