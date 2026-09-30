#!/usr/bin/env -S nix develop -c node
// Phase 4 core gate for take markup, with no paid model. A live subject, real
// frames, the real app wiring and the unstyled reference renderer in
// Chromium. The production Darkroom markup is the UI worker's; this gate does
// not check layout. A deterministic local endpoint stands in for the model.
//
// Usage: nix develop -c node scripts/verify-markup.mjs [--keep]
import { createServer as createHttpServer } from "node:http"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { chromium } from "playwright-core"
import { createServer } from "vite"
import { caliper } from "../src/plugin.js"
import { createTakeStore } from "../src/takes/store.js"

if (!process.env.CHROMIUM) throw new Error("Run with nix develop to supply CHROMIUM.")
const keep = process.argv.includes("--keep")
const checkout = fileURLToPath(new URL("../", import.meta.url))
const root = mkdtempSync(join(tmpdir(), "caliper-markup-subject-"))
const evidence = mkdtempSync(join(tmpdir(), "caliper-markup-evidence-"))
const part = "src/Chip.part.tsx"
/** @param {string} file @param {string} source */
const put = (file, source) => { const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, source) }
put("package.json", JSON.stringify({ name: "markup-subject", type: "module", exports: { ".": "./src/index.ts" } }))
put("tsconfig.json", JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }))
put("src/index.ts", 'import "./chip.css"\nexport {}\n')
put("src/chip.css", "body { margin: 0; font: 16px sans-serif } .bar { display: flex; gap: 12px; padding: 24px } .chip { padding: 12px 20px } .menu { margin: 0 24px; padding: 8px; list-style: none; border: 1px solid #999 } .item { padding: 10px }\n")
const chip = (/** @type {string} */ label) => `import { useState } from "react"
export function Chip() {
  const [open, setOpen] = useState(false)
  const [clicks, setClicks] = useState(0)
  return <div>
    <div className="bar"><button className="chip" onClick={() => { setOpen(!open); setClicks(clicks + 1) }}>${label}</button><span className="count">{clicks}</span></div>
    {open && <ul className="menu"><li className="item">First item</li><li className="item">Second item</li></ul>}
  </div>
}
`
put("src/Chip.tsx", chip("Menu"))
put(part, 'import { Chip } from "./Chip"\nexport default function Part() { return <Chip /> }\n')
symlinkSync(resolve(checkout, "node_modules"), join(root, "node_modules"), "dir")
await build({ entryPoints: [join(checkout, "scripts/fixtures/markup-harness.tsx")], bundle: true, format: "esm", jsx: "automatic", outfile: join(root, "public/markup-harness.js"), define: { "process.env.NODE_ENV": '"development"' }, logLevel: "silent" })
put("public/markup-harness.html", '<!doctype html><html><head><meta charset="utf-8"><base href="/__caliper/"><title>Markup harness</title></head><body><div id="caliper"></div><script type="module" src="/markup-harness.js"></script></body></html>')

const store = createTakeStore(root)
const [one, two, three] = ["Warm it up", "Cool it down", "Keep it plain"].map(prompt => store.create({ part, state: "default", device: "rg353m", prompt }))
store.write(/** @type {string} */ (one), "src/chip.css", readFileSync(join(root, "src/chip.css"), "utf8").replace(".chip { padding: 12px 20px }", ".chip { padding: 12px 20px; color: #b00 }"))

/** @type {Array<{ text: string, images: number }>} */
const briefs = []
const model = createHttpServer((request, response) => {
  let body = ""
  request.on("data", chunk => { body += chunk })
  request.on("end", () => {
    const call = JSON.parse(body)
    const first = call.messages?.find((/** @type {{ role: string }} */ message) => message.role === "user")
    const parts = Array.isArray(first?.content) ? first.content : [{ type: "text", text: String(first?.content ?? "") }]
    briefs.push({ text: parts.filter((/** @type {{ type: string }} */ item) => item.type === "text").map((/** @type {{ text: string }} */ item) => item.text).join("\n"), images: parts.filter((/** @type {{ type: string }} */ item) => item.type === "image_url").length })
    response.writeHead(200, { "content-type": "text/event-stream" })
    const base = { id: "local", object: "chat.completion.chunk", created: 0, model: "scripted" }
    response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "Done." } }] })}\n\n`)
    response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`)
    response.end("data: [DONE]\n\n")
  })
})
await new Promise(done => model.listen(0, "127.0.0.1", () => done(undefined)))
const address = model.address()
if (!address || typeof address === "string") throw new Error("The local model endpoint did not start.")
process.env.CALIPER_MARKUP_VERIFY_KEY = "local"

async function startVite() {
  const server = await createServer({ root, configFile: false, cacheDir: join(root, ".vite"), logLevel: "silent", server: { host: "127.0.0.1", port: 0 },
    plugins: [caliper({ wrap: false, agent: { model: "scripted", baseUrl: `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (address).port}/v1`, apiKeyEnv: "CALIPER_MARKUP_VERIFY_KEY", reasoning: "off", skills: false } })] })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (!url) throw new Error("The subject did not start.")
  return { server, url }
}

/** @type {Array<{ name: string, ok: boolean, detail: string }>} */
const results = []
/** @param {string} name @param {() => Promise<string | void>} run */
async function gate(name, run) {
  try {
    const detail = await run() ?? ""
    results.push({ name, ok: true, detail })
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`)
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.stack ?? error.message : String(error) })
    console.error(`FAIL ${name}\n${error instanceof Error ? error.stack : error}`)
  }
}
/** @param {unknown} condition @param {string} message */
function assert(condition, message) { if (!condition) throw new Error(message) }

let vite = await startVite()
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } })
const hash = `#part=${part}&state=takes:default&take=${one}&device=rg353m`

/** @typedef {import("../src/client/ui/contract").ChromeView} ChromeView */
/** @param {import("playwright-core").Page} page @returns {Promise<ChromeView>} */
const view = page => page.evaluate(() => /** @type {any} */ (window).caliperHarness.snapshot())
/**
 * @param {import("playwright-core").Page} page
 * @param {string} predicate a function of the ChromeView, as source
 * @param {string} what
 */
async function until(page, predicate, what, timeout = 15_000) {
  try { await page.waitForFunction(`(${predicate})(window.caliperHarness?.snapshot())`, undefined, { timeout, polling: 50 }) }
  catch {
    const current = await view(page).catch(() => null)
    throw new Error(`Timed out waiting for ${what}. Notices: ${JSON.stringify(current?.composer.notices)} Markup: ${JSON.stringify(current?.markup)}`)
  }
}
/** @param {import("playwright-core").Page} page @param {string} take */
const frameOf = (page, take) => page.frameLocator(`iframe[data-take="${take}"]`)
/** @param {import("playwright-core").Page} page */
async function open(page) {
  await page.goto(new URL(`markup-harness.html${hash}`, vite.url).href)
  await until(page, `view => view?.markup?._tag === "Ready" && view.canvas._tag === "Frames" && view.canvas.frames.length === 4 && view.canvas.frames.every(frame => frame.verdict._tag === "Rendered")`, "four rendered frames and a loaded draft", 30_000)
}
/** @param {import("playwright-core").Page} page */
const marks = page => view(page).then(current => current.markup._tag === "Ready" ? current.markup.groups.flatMap(group => group.marks) : [])
const draft = () => JSON.parse(readFileSync(join(root, ".caliper/marks.json"), "utf8"))
/** @param {import("playwright-core").Page} page @param {string} take @param {string} selector */
async function centre(page, take, selector) {
  const target = frameOf(page, take).locator(selector).first()
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  assert(box, `${selector} in take ${take} has no box`)
  return { x: /** @type {{x:number,width:number}} */ (box).x + /** @type {{width:number}} */ (box).width / 2, y: /** @type {{y:number,height:number}} */ (box).y + /** @type {{height:number}} */ (box).height / 2 }
}
/** @param {import("playwright-core").Page} page @param {string} note */
async function writeNote(page, note) {
  const field = page.locator('[data-cal="mark-note"]')
  await field.waitFor()
  await field.fill(note)
  await field.press("Enter")
  await page.waitForFunction(`!document.querySelector('[data-cal="mark-note"]')`)
}

const first = await context.newPage()
const pageErrors = /** @type {string[]} */ ([])
first.on("pageerror", error => pageErrors.push(error.message))
try {
  await open(first)

  await gate("Alt-click marks a take without mark mode, and the part does not react", async () => {
    const at = await centre(first, /** @type {string} */ (one), ".chip")
    await first.keyboard.down("Alt")
    await first.mouse.click(at.x, at.y)
    await first.keyboard.up("Alt")
    await until(first, `view => view.markup.groups.some(group => group.marks.some(mark => mark.name === "${one}A"))`, `mark ${one}A`)
    const count = await frameOf(first, /** @type {string} */ (one)).locator(".count").textContent()
    assert(count === "0", `the part saw the Alt-click: count ${count}`)
    assert(await frameOf(first, /** @type {string} */ (one)).locator(".menu").count() === 0, "the Alt-click opened the menu")
    await writeNote(first, "too heavy")
    await until(first, `view => view.markup.groups.flatMap(group => group.marks).some(mark => mark.name === "${one}A" && mark.note === "too heavy" && mark.location._tag === "Located")`, "the saved note")
    const stored = draft().marks.find((/** @type {any} */ mark) => mark.letter === "A" && mark.source.take === one)
    assert(stored?.note === "too heavy" && stored.anchor.element.text === "Menu" && stored.anchor.afterInput === false, `stored mark: ${JSON.stringify(stored)}`)
    return `anchor ${stored.anchor.element.selector}`
  })

  await gate("an open menu stays open when mark mode turns on and a mark is placed", async () => {
    const frame = frameOf(first, /** @type {string} */ (two))
    await frame.locator(".chip").click()
    await frame.locator(".menu").waitFor()
    await first.locator(`iframe[data-take="${two}"]`).evaluate(node => { /** @type {any} */ (/** @type {HTMLIFrameElement} */ (node).contentWindow).caliperGateMarker = 7 })
    await first.locator('[data-cal="mark-mode"]').click()
    await until(first, `view => view.markup.mode._tag === "Marking"`, "mark mode")
    const at = await centre(first, /** @type {string} */ (two), ".item")
    await first.mouse.click(at.x, at.y)
    await until(first, `view => view.markup.groups.flatMap(group => group.marks).some(mark => mark.name === "${two}A")`, `mark ${two}A`)
    await writeNote(first, "menu row")
    assert(await frame.locator(".menu").count() === 1, "the menu closed")
    assert(await frame.locator(".count").textContent() === "1", "the part saw the mark-mode click")
    const marker = await first.locator(`iframe[data-take="${two}"]`).evaluate(node => /** @type {any} */ (/** @type {HTMLIFrameElement} */ (node).contentWindow).caliperGateMarker)
    assert(marker === 7, "the frame reloaded")
    await until(first, `view => view.markup.groups.flatMap(group => group.marks).some(mark => mark.name === "${two}A" && mark.location._tag === "Located" && mark.note === "menu row")`, `${two}A located`)
    const stored = draft().marks.find((/** @type {any} */ mark) => mark.source.take === two)
    assert(stored.anchor.afterInput === true && stored.anchor.element.text === "First item", `stored: ${JSON.stringify(stored.anchor)}`)
    // Drag from just outside the button to just past the count: both lie inside the region.
    const from = await frame.locator(".chip").boundingBox(), to = await frame.locator(".count").boundingBox()
    assert(from && to, "the row has no boxes")
    const [a, b] = /** @type {[{x:number,y:number,width:number,height:number},{x:number,y:number,width:number,height:number}]} */ ([from, to])
    await first.mouse.move(a.x - 3, a.y - 3)
    await first.mouse.down()
    await first.mouse.move(b.x + b.width + 3, Math.max(a.y + a.height, b.y + b.height) + 3, { steps: 5 })
    await first.mouse.up()
    await until(first, `view => view.markup.groups.flatMap(group => group.marks).some(mark => mark.name === "${two}B" && mark.kind === "Region")`, `region ${two}B`)
    await writeNote(first, "tighten this row")
    await first.locator('[data-cal="mark-mode"]').click()
    await first.screenshot({ path: join(evidence, "marks-placed.png"), fullPage: true })
    const region = draft().marks.find((/** @type {any} */ mark) => mark.source.take === two && mark.letter === "B")
    return `region holds ${region.anchor.elements.map((/** @type {any} */ element) => element.tag).join(", ")} in ${region.anchor.element.selector}`
  })

  const second = await context.newPage()
  second.on("pageerror", error => pageErrors.push(error.message))
  await gate("a second chrome shows the draft, and its marks reach the first chrome", async () => {
    await open(second)
    const names = (await marks(second)).map(mark => `${mark.name}:${mark.note}`)
    assert(names.join() === `${one}A:too heavy,${two}A:menu row,${two}B:tighten this row`, `second chrome sees ${names}`)
    const at = await centre(second, /** @type {string} */ (three), ".chip")
    await second.keyboard.down("Alt")
    await second.mouse.click(at.x, at.y)
    await second.keyboard.up("Alt")
    await until(second, `view => view.markup.groups.flatMap(group => group.marks).some(mark => mark.name === "${three}A")`, `mark ${three}A in the second chrome (part clicks: ${await frameOf(second, /** @type {string} */ (three)).locator(".count").textContent()})`, 5000)
    await writeNote(second, "kill the border")
    await until(first, `view => view.markup.groups.flatMap(group => group.marks).some(mark => mark.name === "${three}A" && mark.note === "kill the border")`, "the second chrome's mark in the first", 5000)
    await second.close()
  })

  await gate("a mark placed after input is lost after a reload, and found again when the input repeats", async () => {
    await first.reload()
    await open(first)
    await until(first, `view => view.markup.groups.flatMap(group => group.marks).some(mark => mark.name === "${two}A" && mark.location._tag === "Lost")`, `${two}A lost`)
    const current = await view(first)
    assert(current.markup._tag === "Ready" && current.markup.send._tag === "Idle" && current.markup.send.availability._tag === "Disabled" && current.markup.send.availability.reason.includes(`Re-place or remove ${two}A`), `Send: ${JSON.stringify(current.markup._tag === "Ready" && current.markup.send)}`)
    assert((await marks(first)).find(mark => mark.name === `${one}A`)?.note === "too heavy", "the note did not survive the reload")
    await frameOf(first, /** @type {string} */ (two)).locator(".chip").click()
    await until(first, `view => view.markup.groups.flatMap(group => group.marks).every(mark => mark.location._tag === "Located")`, "every mark located")
  })

  await gate("the draft survives a Vite restart", async () => {
    await vite.server.close()
    vite = await startVite()
    await open(first)
    const names = (await marks(first)).map(mark => mark.name)
    assert(names.length === 4, `after restart: ${names}`)
    return `new origin ${vite.url}`
  })

  await gate("a changed take turns its mark lost and blocks the whole Send", async () => {
    await frameOf(first, /** @type {string} */ (two)).locator(".chip").click()
    await until(first, `view => view.markup._tag === "Ready" && view.markup.send.availability?._tag === "Enabled"`, "Send enabled")
    store.write(/** @type {string} */ (three), "src/Chip.tsx", chip("Open"))
    await until(first, `view => view.markup.groups.flatMap(group => group.marks).some(mark => mark.name === "${three}A" && mark.location._tag === "Lost")`, `${three}A lost`, 20_000)
    const current = await view(first)
    assert(current.markup._tag === "Ready" && current.markup.send._tag === "Idle" && current.markup.send.availability._tag === "Disabled", "Send stayed enabled")
    const pin = await first.locator(`[data-cal="mark-pin"][data-frame-key*='"${three}"']`).textContent()
    assert(pin?.includes("Lost"), `pin: ${pin}`)
    const lostId = (await marks(first)).find(mark => mark.name === `${three}A`)?.id
    await first.locator('[data-cal="draft-open"]').click()
    await first.locator(`[data-cal="mark-remove"][data-mark-id="${lostId}"]`).click()
    await until(first, `view => view.markup.send.availability?._tag === "Enabled" && view.markup.send.label === "Send · 2 new takes"`, "Send enabled for two takes")
  })

  await gate("Send makes two new takes; each agent gets only its own marks and the picture with pins", async () => {
    const before = store.list()
    await first.locator('[data-cal="marks-send"]').click()
    await until(first, `view => view.markup.groups.length === 0 && view.markup.send._tag === "Idle"`, "an empty draft after Send", 60_000)
    const made = store.list().filter(take => !before.includes(take))
    assert(made.length === 2, `new takes: ${made}`)
    for (let attempt = 0; attempt < 200 && briefs.filter(brief => brief.text.includes("(this pass)")).length < 2; attempt += 1) await new Promise(done => setTimeout(done, 50))
    const passes = briefs.filter(brief => brief.text.includes("(this pass)"))
    assert(passes.length === 2, `model saw ${passes.length} briefs`)
    const fromOne = passes.find(brief => brief.text.includes(`## Marks on take ${one} (this pass)`)), fromTwo = passes.find(brief => brief.text.includes(`## Marks on take ${two} (this pass)`))
    assert(fromOne && !fromOne.text.includes("menu row") && fromOne.text.includes("too heavy") && fromOne.images === 1, `take ${one} brief wrong`)
    assert(fromTwo && !fromTwo.text.includes("too heavy") && fromTwo.text.includes("Placed after input") && fromTwo.text.includes("tighten this row") && fromTwo.images === 1, `take ${two} brief wrong`)
    assert(!passes.some(brief => brief.text.includes("kill the border")), "a removed mark was sent")
    for (const take of made) {
      const record = store.record(take)
      assert(record?.parent && record.chain && record.history?.prompt && record.marks?.length, `record ${take}: ${JSON.stringify(record)}`)
      const picture = join(root, ".caliper/takes", `${take}.images`, "1.png")
      assert(existsSync(picture), `take ${take} has no picture`)
      copyFileSync(picture, join(evidence, `take-${take}-from-${record?.parent?.take}-marks.png`))
    }
    assert(store.read(/** @type {string} */ (made.find(take => store.record(take)?.parent?.take === one)), "src/chip.css").includes("#b00"), "the copy lost take 1's edit")
    assert(draft().marks.length === 0, "the draft kept sent marks")
    await first.screenshot({ path: join(evidence, "after-send.png"), fullPage: true })
    return `takes ${made.join(", ")}; pictures in ${evidence}`
  })
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join("\n")}`)
} catch (error) {
  results.push({ name: "harness", ok: false, detail: error instanceof Error ? error.stack ?? error.message : String(error) })
  console.error(error)
} finally {
  writeFileSync(join(evidence, "summary.json"), JSON.stringify(results, null, 2))
  await browser.close()
  await vite.server.close()
  model.close()
  if (!keep) rmSync(root, { recursive: true, force: true })
  else console.log(`Subject kept: ${root}`)
}
console.log(`Evidence: ${evidence}`)
const failed = results.filter(result => !result.ok)
console.log(`${results.length - failed.length} of ${results.length} markup gates passed.`)
process.exit(failed.length ? 1 : 0)
