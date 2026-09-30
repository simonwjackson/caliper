#!/usr/bin/env -S nix develop -c node
// Phase 6 gate for references between takes and marks on the original, with
// no paid model. A live subject, real frames, the real app wiring and the
// event stream in Chromium, drawn by the unstyled reference renderer
// (default) or the production Darkroom (--darkroom). Marks and notes go
// through the rendered controls. A deterministic local endpoint stands in for
// the model and records each first message.
//
// Usage: nix develop -c node scripts/verify-references.mjs [--darkroom] [--keep]
import { createServer as createHttpServer } from "node:http"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { chromium } from "playwright-core"
import { createServer } from "vite"
import { caliper } from "../src/plugin.js"
import { installRouting, projectBase, startApp } from "./caliper-app.mjs"
import { createTakeStore } from "../src/takes/store.js"

if (!process.env.CHROMIUM) throw new Error("Run with nix develop to supply CHROMIUM.")
const keep = process.argv.includes("--keep")
const renderer = process.argv.includes("--darkroom") ? "Darkroom" : "Chrome"
const checkout = fileURLToPath(new URL("../", import.meta.url))
const root = mkdtempSync(join(tmpdir(), "caliper-references-subject-"))
const evidence = mkdtempSync(join(tmpdir(), "caliper-references-evidence-"))
const part = "src/Chip.part.tsx"
/** @param {string} file @param {string} source */
const put = (file, source) => { const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, source) }
put("package.json", JSON.stringify({ name: "references-subject", type: "module", exports: { ".": "./src/index.ts" } }))
put("tsconfig.json", JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }))
put("src/index.ts", 'import "./chip.css"\nexport {}\n')
put("src/chip.css", "body { margin: 0; font: 16px sans-serif } .bar { display: flex; gap: 12px; padding: 24px } .chip { padding: 12px 20px } .tag { padding: 4px }\n")
put("src/Chip.tsx", 'export function Chip() { return <div className="bar"><button className="chip">Menu</button><span className="tag">New</span></div> }\n')
put(part, 'import { Chip } from "./Chip"\nexport default function Part() { return <Chip /> }\n')
symlinkSync(resolve(checkout, "node_modules"), join(root, "node_modules"), "dir")
await build({ entryPoints: [join(checkout, "scripts/fixtures/markup-harness.tsx")], bundle: true, format: "esm", jsx: "automatic", outfile: join(root, "public/markup-harness.js"), alias: { "caliper-markup-renderer": join(checkout, `src/client/ui/${renderer}.tsx`) }, loader: { ".ttf": "file", ".png": "file" }, assetNames: "[name]", publicPath: "/", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "silent" })
const styles = existsSync(join(root, "public/markup-harness.css")) ? '<link rel="stylesheet" href="/markup-harness.css">' : ""
put("public/markup-harness.html", `<!doctype html><html><head><meta charset="utf-8"><base href="__caliper/"><title>References harness</title>${styles}</head><body><div id="caliper"></div><script type="module" src="/markup-harness.js"></script></body></html>`)
console.log(`Renderer: ${renderer}`)

const store = createTakeStore(root)
const css = readFileSync(join(root, "src/chip.css"), "utf8")
const [one, two, three] = ["Warm it", "Space it", "Plain"].map(prompt => store.create({ part, state: "default", device: "rg353m", prompt }))
store.write(/** @type {string} */ (two), "src/chip.css", css.replace("gap: 12px", "gap: 40px"))

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
process.env.CALIPER_REFERENCES_VERIFY_KEY = "local"
const vite = await createServer({ root, configFile: false, cacheDir: join(root, ".vite"), logLevel: "silent", server: { host: "127.0.0.1", port: 0 },
  plugins: [caliper({ wrap: false })] })
await vite.listen()
const app = await startApp({ agent: { model: "scripted", baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKeyEnv: "CALIPER_REFERENCES_VERIFY_KEY", reasoning: "off", skills: false } })
const url = await projectBase(app, root)

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

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
const page = await (await browser.newContext({ viewport: { width: 1800, height: 1100 } })).newPage()
const pageErrors = /** @type {string[]} */ ([])
page.on("pageerror", error => pageErrors.push(error.message))
/** @typedef {import("../src/client/ui/contract").ChromeView} ChromeView */
/** @returns {Promise<ChromeView>} */
const view = () => page.evaluate(() => /** @type {any} */ (window).caliperHarness.snapshot())
/** @param {string} predicate a function of the ChromeView, as source @param {string} what */
async function until(predicate, what, timeout = 20_000) {
  try { await page.waitForFunction(`(${predicate})(window.caliperHarness?.snapshot())`, undefined, { timeout, polling: 50 }) }
  catch {
    const current = await view().catch(() => null)
    throw new Error(`Timed out waiting for ${what}. Notices: ${JSON.stringify(current?.composer.notices)} Markup: ${JSON.stringify(current?.markup)}`)
  }
}
const draft = () => JSON.parse(readFileSync(join(root, ".caliper/marks.json"), "utf8"))
/** An original frame has no take. @param {string | null} take */
const frameSelector = take => take ? `iframe[data-cal="frame"][data-take="${take}"]` : 'iframe[data-cal="frame"]:not([data-take])'
/** Alt-click the element's centre in a take's frame, or the original's, and write a note. @param {string | null} take @param {string} selector @param {string} name @param {string} note */
async function mark(take, selector, name, note) {
  const target = page.frameLocator(frameSelector(take)).locator(selector).first()
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  assert(box, `${selector} in ${take ?? "the original"} has no box`)
  const { x, y, width, height } = /** @type {{x:number,y:number,width:number,height:number}} */ (box)
  await page.keyboard.down("Alt")
  await page.mouse.click(x + width / 2, y + height / 2)
  await page.keyboard.up("Alt")
  await until(`view => view.markup.groups.some(group => group.marks.some(mark => mark.name === "${name}"))`, `mark ${name}`)
  const field = page.locator('[data-cal="mark-note"]')
  await field.waitFor()
  await field.fill(note)
  await field.press("Enter")
  await page.waitForFunction(`!document.querySelector('[data-cal="mark-note"]')`)
  await until(`view => view.markup.groups.flatMap(group => group.marks).some(mark => mark.name === "${name}" && mark.note === ${JSON.stringify(note)} && mark.location._tag === "Located")`, `${name}'s note`)
}
async function send() {
  const before = store.list()
  const label = (await view()).markup
  if (label._tag !== "Ready") throw new Error("markup not ready")
  assert(label.send._tag === "Idle" && label.send.availability._tag === "Enabled", `Send is not ready: ${JSON.stringify(label._tag === "Ready" ? label.send : label)}`)
  const seen = briefs.length
  await page.locator('[data-cal="marks-send"]').click()
  await until(`view => view.markup.groups.length === 0 && view.markup.send._tag === "Idle"`, "an empty draft after Send", 60_000)
  const made = store.list().filter(take => !before.includes(take))
  for (let attempt = 0; attempt < 200 && briefs.length - seen < made.length; attempt += 1) await new Promise(done => setTimeout(done, 50))
  return { label: label.send.label, made, briefs: briefs.slice(seen) }
}

try {
  await installRouting(page, app)
  await page.goto(new URL(`markup-harness.html#part=${part}&state=takes:default&take=${one}&device=rg353m`, url).href)
  await until(`view => view?.markup?._tag === "Ready" && view.canvas._tag === "Frames" && view.canvas.frames.length === 4 && view.canvas.frames.every(frame => frame.verdict._tag === "Rendered")`, "four rendered frames", 30_000)

  await gate("a note that points to another take's mark makes that take no take, and its agent gets the element, a crop and read access", async () => {
    await mark(two, ".bar", `${two}A`, "this gap is right")
    await mark(three, ".chip", `${three}A`, `use ${two}A here`)
    await mark(one, ".chip", `${one}A`, "restore 0A")
    await mark(null, ".tag", "0A", "")
    const current = await view()
    if (current.markup._tag !== "Ready") throw new Error("markup not ready")
    const outcomes = Object.fromEntries(current.markup.groups.map(group => [group.source.take, group.outcome._tag]))
    assert(outcomes[two] === "PointedTo" && outcomes[three] === "NewTake" && outcomes[one] === "NewTake" && outcomes["0"] === "PointedTo", `outcomes ${JSON.stringify(outcomes)}`)
    const pass = await send()
    assert(pass.label === "Send · 2 new takes" && pass.made.length === 2, `label ${pass.label}, made ${pass.made}`)
    const fromThree = pass.made.find(take => store.record(take)?.parent?.take === three), fromOne = pass.made.find(take => store.record(take)?.parent?.take === one)
    assert(fromThree && fromOne, `parents: ${pass.made.map(take => store.record(take)?.parent?.take)}`)
    assert(!pass.made.some(take => store.record(take)?.parent?.take === two), `take ${two} got a new take`)
    const threeBrief = pass.briefs.find(brief => brief.text.includes(`You are take ${fromThree}`)), oneBrief = pass.briefs.find(brief => brief.text.includes(`You are take ${fromOne}`))
    assert(threeBrief?.text.includes(`## Marks the notes point to\n${two}A: this gap is right`) && threeBrief.text.includes("div.bar") && threeBrief.text.includes(`take: "${two}"`) && threeBrief.images === 2, `take ${fromThree}'s brief: ${threeBrief?.text.slice(0, 400)} images ${threeBrief?.images}`)
    assert(oneBrief?.text.includes("0A: (no note)") && oneBrief.text.includes("the real files around 0A") && !oneBrief.text.includes("You may read take") && oneBrief.images === 2, `take ${fromOne}'s brief images ${oneBrief?.images}`)
    assert(store.record(/** @type {string} */ (fromThree))?.references?.[0]?.source.take === two, "the record lost its references")
    assert(draft().marks.length === 0, "the draft kept marks")
    await page.screenshot({ path: join(evidence, "after-references.png"), fullPage: true })
    return `takes ${pass.made.join(", ")}`
  })

  await gate("an unnamed mark on the original makes one take from the real files", async () => {
    await mark(null, ".chip", "0A", "too loud")
    const pass = await send()
    assert(pass.label === "Send · 1 new take" && pass.made.length === 1, `label ${pass.label}, made ${pass.made}`)
    const take = /** @type {string} */ (pass.made[0]), record = store.record(take)
    assert(record && !record.parent && !record.chain && record.marks?.[0]?.source.take === "0" && record.part === part, `record ${JSON.stringify(record)}`)
    assert(store.files(take).length === 0, "a take from the real files starts with no changed files")
    assert(pass.briefs[0]?.text.includes(`You are take ${take}, a new take made from the real files.`) && pass.briefs[0].images === 1, "the brief is wrong")
    return `take ${take}`
  })

  await gate("marks on the original go with a typed prompt, then leave the draft", async () => {
    await mark(null, ".tag", "0A", "make this red")
    await page.locator('[data-cal="prompt"]').fill("Tidy the tag")
    await until(`view => view.composer.marks._tag === "WithPrompt" && view.composer.marks.names.join() === "0A"`, "the prompt line")
    const before = store.list(), seen = briefs.length
    await page.locator('[data-cal="prompt"]').press("Control+Enter")
    await until(`view => view.markup.groups.length === 0`, "the draft without 0A", 60_000)
    const made = store.list().filter(take => !before.includes(take))
    assert(made.length === 1, `made ${made}`)
    for (let attempt = 0; attempt < 200 && briefs.length === seen; attempt += 1) await new Promise(done => setTimeout(done, 50))
    const brief = briefs[seen]
    assert(brief?.text.includes("Tidy the tag") && brief.text.includes("## Marks on the original\n") && brief.text.includes("0A: make this red"), `brief ${brief?.text.slice(0, 300)}`)
    assert(store.record(/** @type {string} */ (made[0]))?.images?.some(image => image.name.startsWith("original-")), "the picture was not attached")
    return `take ${made[0]}`
  })
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join("\n")}`)
} catch (error) {
  results.push({ name: "harness", ok: false, detail: error instanceof Error ? error.stack ?? error.message : String(error) })
  console.error(error)
} finally {
  writeFileSync(join(evidence, "summary.json"), JSON.stringify(results, null, 2))
  await browser.close()
  await app.close()
  await vite.close()
  model.close()
  if (!keep) rmSync(root, { recursive: true, force: true })
  else console.log(`Subject kept: ${root}`)
}
console.log(`Evidence: ${evidence}`)
const failed = results.filter(result => !result.ok)
console.log(`${results.length - failed.length} of ${results.length} reference gates passed.`)
process.exit(failed.length ? 1 : 0)
