#!/usr/bin/env -S nix develop -c node
// Real-model markup pass. It spends model tokens: two take agents run once.
// It copies a subject (default: Pico) to a scratch directory, makes three
// takes of one part, marks two of them in the served Darkroom chrome, presses
// Send once and waits for both new takes. The subject is never written.
//
// Usage: nix develop -c node scripts/verify-markup-model.mjs
//   [--subject <dir>] [--part <file>] [--model <id>] [--keep]
// The model and endpoint come from the Caliper app's settings, the key from the environment
// (~/.config/caliper/config.json and CALIPER_AGENT_API_KEY, or the variable it names).
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright-core"
import { createServer } from "vite"
import { caliper } from "../src/plugin.js"
import { liveAgent, projectBase, startApp } from "./caliper-app.mjs"
import { createTakeStore } from "../src/takes/store.js"

if (!process.env.CHROMIUM) throw new Error("Run with nix develop to supply CHROMIUM.")
const option = (/** @type {string} */ name, /** @type {string} */ fallback) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] ?? fallback : fallback }
const subject = option("--subject", join(homedir(), "code/sandbox/korri/surfaces/pico"))
const part = option("--part", "src/ui/molecules/PicoCard.molecule.part.tsx")
const model = option("--model", "") || undefined
const css = option("--css", "src/ui/molecules/PicoCard.css")
const title = option("--title", ".pico-card-title"), kicker = option("--kicker", ".pico-card-kicker")
const keep = process.argv.includes("--keep")

const root = mkdtempSync(join(tmpdir(), "caliper-markup-model-"))
const evidence = mkdtempSync(join(tmpdir(), "caliper-markup-model-evidence-"))
cpSync(subject, root, { recursive: true, filter: source => !/\/(node_modules|\.caliper|\.git|dist)$/.test(source) })
symlinkSync(join(subject, "node_modules"), join(root, "node_modules"), "dir")

const store = createTakeStore(root)
const [one, two, three] = ["Warm it up", "Cool it down", "Keep it plain"].map(prompt => /** @type {string} */ (store.create({ part, state: "default", device: "rg353m", prompt })))
// Take 1 carries a hand edit, so the new take must copy it.
store.write(one, css, `${readFileSync(join(root, css), "utf8")}\n.pico-card-kicker { text-decoration: underline }\n`)

const server = await createServer({ root, configFile: false, cacheDir: join(root, ".vite"), logLevel: "warn", server: { host: "127.0.0.1", port: 0 }, plugins: [caliper()] })
await server.listen()
const app = await startApp({ agent: liveAgent(model) })
const url = await projectBase(app, root)
if (!url) throw new Error("The subject did not start.")
const api = async (/** @type {string} */ path) => (await fetch(new URL(`__caliper/${path}`, url))).json()

/** @param {unknown} condition @param {string} message */
function assert(condition, message) { if (!condition) throw new Error(message) }
/** Polls the draft from here: an async predicate in waitForFunction is always truthy. @param {(draft: any) => boolean} test @param {string} what */
async function until(test, what, timeout = 15_000) {
  for (const end = Date.now() + timeout; Date.now() < end; await new Promise(done => setTimeout(done, 250))) if (test(await api("marks.json"))) return
  throw new Error(`Timed out waiting for ${what}: ${JSON.stringify(await api("marks.json"))}`)
}
const log = (/** @type {string} */ line) => { console.log(line); appendFileSync(join(evidence, "log.txt"), `${line}\n`) }

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage()
const errors = /** @type {string[]} */ ([])
page.on("pageerror", error => errors.push(error.message))
let failed = false
try {
  const agent = await api("takes.json")
  assert(agent.agent._tag === "Ready", `the agent is not ready: ${JSON.stringify(agent.agent)}`)
  await page.goto(new URL(`__caliper/#part=${part}&state=takes:default&take=${one}&device=rg353m`, url).href)
  for (const take of [one, two, three]) await page.frameLocator(`iframe[data-take="${take}"]`).locator(title).first().waitFor({ timeout: 90_000 })
  await page.locator('[data-cal="mark-mode"]').waitFor({ timeout: 30_000 })

  /** @param {string} take @param {string} selector @param {string} note */
  const mark = async (take, selector, note) => {
    const target = page.frameLocator(`iframe[data-take="${take}"]`).locator(selector).first()
    const box = await target.boundingBox()
    assert(box, `${selector} in take ${take} has no box`)
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
  await mark(one, title, "Make this title about half as big")
  await mark(two, kicker, "Make this kicker text red")
  await until(draft => draft.marks.length === 2 && draft.marks.every((/** @type {{ note: string }} */ mark) => mark.note), "two marks with notes", 10_000)
  const send = page.locator('[data-cal="marks-send"]')
  await page.waitForFunction(`!document.querySelector('[data-cal="marks-send"]')?.disabled`, undefined, { timeout: 30_000 })
  log(`Send label: ${await send.textContent()}`)
  await page.screenshot({ path: join(evidence, "marked.png") })

  const before = new Set(store.list())
  const started = Date.now()
  await send.click()
  await until(draft => draft.marks.length === 0, "an empty draft after Send", 120_000)
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

  for (const take of made) {
    const record = store.record(take)
    const parent = record?.parent?.take
    const own = parent === one ? "half as big" : "kicker text red", other = parent === one ? "kicker text red" : "half as big"
    const view = views.find(item => item.take === take)
    const brief = JSON.stringify(view?.log?.[0] ?? {})
    assert(record?.chain && record.history && record.marks?.length === 1, `record ${take}: ${JSON.stringify(record)}`)
    assert(brief.includes(own) && !brief.includes(other), `take ${take} brief does not hold only its own marks`)
    assert(existsSync(join(root, ".caliper/takes", `${take}.images`, "1.png")), `take ${take} has no picture`)
    cpSync(join(root, ".caliper/takes", `${take}.images`, "1.png"), join(evidence, `take-${take}-from-${parent}-picture.png`))
    assert(view?.run._tag !== "Failed", `take ${take} failed: ${JSON.stringify(view?.run)}`)
    const edited = store.files(take)
    const text = edited.includes(css) ? store.read(take, css) ?? "" : ""
    if (parent === one) assert(text.includes("text-decoration: underline"), `take ${take} lost take ${one}'s hand edit`)
    log(`take ${take} from ${parent}: run ${view?.run._tag}; files ${edited.join(", ") || "none"}; brief holds only its own mark`)
    const diffTarget = join(evidence, `take-${take}-${css.replaceAll("/", "_")}`)
    if (text) writeFileSync(diffTarget, text)
  }
  await page.waitForTimeout(3000)
  await page.screenshot({ path: join(evidence, "after.png") })
  assert(errors.length === 0, `page errors: ${errors.join("\n")}`)
  log("PASS real-model markup pass")
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
