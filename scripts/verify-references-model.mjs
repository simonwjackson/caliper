#!/usr/bin/env -S nix develop -c node
// Real-model phase 6 pass. It spends model tokens: two take agents run once.
// It copies a subject (default: Pico) to a scratch directory and makes three
// takes of one part. Take 2 has a red kicker. In the served Darkroom it marks
// 2A on take 2's kicker, 3A on take 3's kicker with "use 2A here", and 0A on
// the original's title. One Send must make two takes: one from take 3 that
// may read take 2, and one from the real files. The subject is never written.
//
// Usage: nix develop -c node scripts/verify-references-model.mjs
//   [--subject <dir>] [--part <file>] [--model <id>] [--keep]
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright-core"
import { createServer } from "vite"
import { caliper } from "../src/plugin.js"
import { projectBase, startApp } from "./caliper-app.mjs"
import { createTakeStore } from "../src/takes/store.js"

if (!process.env.CHROMIUM) throw new Error("Run with nix develop to supply CHROMIUM.")
const option = (/** @type {string} */ name, /** @type {string} */ fallback) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] ?? fallback : fallback }
const subject = option("--subject", join(homedir(), "code/sandbox/korri/surfaces/pico"))
const part = option("--part", "src/ui/molecules/PicoCard.molecule.part.tsx")
const model = option("--model", "claude-opus-5-5")
const css = option("--css", "src/ui/molecules/PicoCard.css")
const title = option("--title", ".pico-card-title"), kicker = option("--kicker", ".pico-card-kicker")
const keep = process.argv.includes("--keep")
const RED = "#d01818"

const root = mkdtempSync(join(tmpdir(), "caliper-references-model-"))
const evidence = mkdtempSync(join(tmpdir(), "caliper-references-model-evidence-"))
cpSync(subject, root, { recursive: true, filter: source => !/\/(node_modules|\.caliper|\.git|dist)$/.test(source) })
symlinkSync(join(subject, "node_modules"), join(root, "node_modules"), "dir")

const store = createTakeStore(root)
const [one, two, three] = ["Warm it up", "Cool it down", "Keep it plain"].map(prompt => /** @type {string} */ (store.create({ part, state: "default", device: "rg353m", prompt })))
store.write(two, css, `${readFileSync(join(root, css), "utf8")}\n.pico-card-kicker { color: ${RED} }\n`)

const server = await createServer({ root, configFile: false, cacheDir: join(root, ".vite"), logLevel: "warn", server: { host: "127.0.0.1", port: 0 }, plugins: [caliper()] })
await server.listen()
const app = await startApp({ agent: { model, reasoning: "medium" } })
const url = await projectBase(app, root)
if (!url) throw new Error("The subject did not start.")
const api = async (/** @type {string} */ path) => (await fetch(new URL(`__caliper/${path}`, url))).json()

/** @param {unknown} condition @param {string} message */
function assert(condition, message) { if (!condition) throw new Error(message) }
/** @param {(draft: any) => boolean} test @param {string} what */
async function until(test, what, timeout = 15_000) {
  for (const end = Date.now() + timeout; Date.now() < end; await new Promise(done => setTimeout(done, 250))) if (test(await api("marks.json"))) return
  throw new Error(`Timed out waiting for ${what}: ${JSON.stringify(await api("marks.json"))}`)
}
const log = (/** @type {string} */ line) => { console.log(line); appendFileSync(join(evidence, "log.txt"), `${line}\n`) }

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
const page = await (await browser.newContext({ viewport: { width: 1800, height: 1000 } })).newPage()
const errors = /** @type {string[]} */ ([])
page.on("pageerror", error => errors.push(error.message))
/** @param {string | null} take */
const frame = take => page.frameLocator(take ? `iframe[data-cal="frame"][data-take="${take}"]` : 'iframe[data-cal="frame"]:not([data-take])')
let failed = false
try {
  const agent = await api("takes.json")
  assert(agent.agent._tag === "Ready", `the agent is not ready: ${JSON.stringify(agent.agent)}`)
  await page.goto(new URL(`__caliper/#part=${part}&state=takes:default&take=${one}&device=rg353m`, url).href)
  for (const take of [null, one, two, three]) await frame(take).locator(title).first().waitFor({ timeout: 90_000 })
  await page.locator('[data-cal="mark-mode"]').waitFor({ timeout: 30_000 })

  /** @param {string | null} take @param {string} selector @param {string} note */
  const mark = async (take, selector, note) => {
    const target = frame(take).locator(selector).first()
    await target.scrollIntoViewIfNeeded()
    const box = await target.boundingBox()
    assert(box, `${selector} in ${take ?? "the original"} has no box`)
    const { x, y, width, height } = /** @type {{x:number,y:number,width:number,height:number}} */ (box)
    await page.keyboard.down("Alt")
    await page.mouse.click(x + width / 2, y + height / 2)
    await page.keyboard.up("Alt")
    const field = page.locator('[data-cal="mark-note"]')
    await field.waitFor()
    await field.fill(note)
    await field.press("Enter")
    await page.waitForFunction(`!document.querySelector('[data-cal="mark-note"]')`)
  }
  await mark(two, kicker, "I like this red kicker")
  await mark(three, kicker, `use ${two}A here`)
  await mark(null, title, "Make this title bold")
  await until(draft => draft.marks.length === 3 && draft.marks.every((/** @type {{ note: string }} */ mark) => mark.note), "three marks with notes", 10_000)
  const send = page.locator('[data-cal="marks-send"]')
  await page.waitForFunction(`!document.querySelector('[data-cal="marks-send"]')?.disabled`, undefined, { timeout: 30_000 })
  const label = await send.textContent()
  log(`Send label: ${label}`)
  assert(label?.includes("2 new takes"), `label: ${label}`)
  await page.screenshot({ path: join(evidence, "marked.png") })

  const before = new Set(store.list())
  const started = Date.now()
  await send.click()
  await until(draft => draft.marks.length === 0, "an empty draft after Send", 180_000)
  const sent = Date.now()
  const made = store.list().filter(take => !before.has(take))
  assert(made.length === 2, `new takes: ${made}`)
  log(`Send answered in ${((sent - started) / 1000).toFixed(1)} s; new takes ${made.join(", ")}`)
  /** @type {any[]} */
  let views = []
  for (let wait = 0; wait < 600; wait += 2) {
    views = (await api("takes.json")).takes.filter((/** @type {{ take: string }} */ view) => made.includes(view.take))
    if (views.length === 2 && views.every(view => view.run._tag !== "Running")) break
    await new Promise(done => setTimeout(done, 2000))
  }
  log(`Both agents stopped ${((Date.now() - sent) / 1000).toFixed(1)} s after Send: ${views.map(view => `${view.take} ${view.run._tag}${view.run.reason ? ` (${view.run.reason})` : ""}`).join(", ")}`)
  writeFileSync(join(evidence, "takes.json"), JSON.stringify(views, null, 2))

  const fromThree = made.find(take => store.record(take)?.parent?.take === three), fromOriginal = made.find(take => !store.record(take)?.parent)
  assert(fromThree && fromOriginal, `parents: ${made.map(take => store.record(take)?.parent?.take ?? "original")}`)
  assert(!made.some(take => store.record(take)?.parent?.take === two), `take ${two} got a new take`)
  const threeRecord = store.record(/** @type {string} */ (fromThree)), threeView = views.find(view => view.take === fromThree)
  assert(threeRecord?.references?.[0]?.source.take === two, `references: ${JSON.stringify(threeRecord?.references)}`)
  assert(threeView?.run._tag !== "Failed", `take ${fromThree} failed: ${JSON.stringify(threeView?.run)}`)
  const readTwo = (threeView?.log ?? []).filter((/** @type {any} */ entry) => entry._tag === "Tool" && /read_file|list_files/.test(entry.name) && String(entry.subject).endsWith(` in take ${two}`))
  const threeCss = store.files(/** @type {string} */ (fromThree)).includes(css) ? store.read(/** @type {string} */ (fromThree), css) : ""
  log(`take ${fromThree} from ${three}: run ${threeView?.run._tag}; reads of take ${two}: ${readTwo.length}; red kicker brought over: ${threeCss.toLowerCase().includes(RED)}; files ${store.files(/** @type {string} */ (fromThree)).join(", ") || "none"}`)
  const originalView = views.find(view => view.take === fromOriginal)
  assert(originalView?.run._tag !== "Failed", `take ${fromOriginal} failed: ${JSON.stringify(originalView?.run)}`)
  log(`take ${fromOriginal} from the real files: run ${originalView?.run._tag}; files ${store.files(/** @type {string} */ (fromOriginal)).join(", ") || "none"}`)
  for (const take of made) cpSync(join(root, ".caliper/takes", `${take}.images`), join(evidence, `take-${take}-images`), { recursive: true })
  if (threeCss) writeFileSync(join(evidence, `take-${fromThree}.css`), threeCss)
  await page.waitForTimeout(3000)
  await page.screenshot({ path: join(evidence, "after.png") })
  assert(errors.length === 0, `page errors: ${errors.join("\n")}`)
  log("PASS real-model references pass")
} catch (error) {
  failed = true
  log(`FAIL ${error instanceof Error ? error.stack : error}`)
  await page.screenshot({ path: join(evidence, "failure.png") }).catch(() => undefined)
} finally {
  await browser.close()
  await app?.close()
  await server.close()
  if (!keep) rmSync(root, { recursive: true, force: true })
  else log(`Subject kept: ${root}`)
  log(`Evidence: ${evidence}`)
}
process.exit(failed ? 1 : 0)
