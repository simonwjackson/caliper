#!/usr/bin/env -S nix develop -c node
// Phase 5 gate for chains on the Takes canvas, with no model. A live subject,
// real take records on disk, the real app wiring and the event stream in
// Chromium, drawn by the unstyled reference renderer (default) or the
// production Darkroom (--darkroom). It checks effects through the rendered
// controls; scripts/ui/verify.mjs checks Darkroom layout.
//
// Usage: nix develop -c node scripts/verify-chains.mjs [--darkroom] [--keep]
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
const root = mkdtempSync(join(tmpdir(), "caliper-chains-subject-"))
const evidence = mkdtempSync(join(tmpdir(), "caliper-chains-evidence-"))
const chipPart = "src/Chip.part.tsx", badgePart = "src/Badge.part.tsx"
/** @param {string} file @param {string} source */
const put = (file, source) => { const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, source) }
put("package.json", JSON.stringify({ name: "chains-subject", type: "module", exports: { ".": "./src/index.ts" } }))
put("tsconfig.json", JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }))
put("src/index.ts", 'import "./chip.css"\nexport {}\n')
put("src/chip.css", "body { margin: 0; font: 16px sans-serif } .chip { margin: 24px; padding: 12px 20px }\n")
put(chipPart, 'export default function Part() { return <button className="chip">Chip</button> }\n')
put(badgePart, 'export default function Part() { return <span className="chip">Badge</span> }\n')
symlinkSync(resolve(checkout, "node_modules"), join(root, "node_modules"), "dir")
await build({ entryPoints: [join(checkout, "scripts/fixtures/markup-harness.tsx")], bundle: true, format: "esm", jsx: "automatic", outfile: join(root, "public/markup-harness.js"), alias: { "caliper-markup-renderer": join(checkout, `src/client/ui/${renderer}.tsx`) }, loader: { ".ttf": "file", ".png": "file" }, assetNames: "[name]", publicPath: "/", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "silent" })
const styles = existsSync(join(root, "public/markup-harness.css")) ? '<link rel="stylesheet" href="/markup-harness.css">' : ""
put("public/markup-harness.html", `<!doctype html><html><head><meta charset="utf-8"><base href="__caliper/"><title>Chains harness</title>${styles}</head><body><div id="caliper"></div><script type="module" src="/markup-harness.js"></script></body></html>`)
console.log(`Renderer: ${renderer}`)

// Records as Send writes them: warmer from warm, warmest from warmer. badge is a Badge
// take that writes the chip's stylesheet; plain is another Chip prompt.
const store = createTakeStore(root)
const css = (/** @type {string} */ colour) => readFileSync(join(root, "src/chip.css"), "utf8").replace("padding: 12px 20px", `padding: 12px 20px; color: ${colour}`)
const ask = { part: chipPart, state: "default", device: "iphone-16" }
/** @param {string} take */
const identity = take => ({ take, created: /** @type {import("../src/takes/store.js").TakeRecord} */ (store.record(take)).created })
const pause = () => new Promise(done => setTimeout(done, 5))
const warm = store.create({ ...ask, prompt: "Warm it", name: "Warm chip" }); store.write(warm, "src/chip.css", css("#b00")); await pause()
const badge = store.create({ ...ask, part: badgePart, prompt: "Badge colour", name: "Badge colour" }); store.write(badge, "src/chip.css", css("#06c")); await pause()
const plain = store.create({ ...ask, prompt: "Plain", name: "Plain chip" }); await pause()
const warmer = store.fork(warm, { ...ask, name: "Warmer chip", parent: identity(warm), chain: identity(warm), history: { prompt: "Warm it", lineage: [identity(warm)], passes: [] }, marks: [] }); await pause()
const warmest = store.fork(warmer, { ...ask, name: "Warmest chip", parent: identity(warmer), chain: identity(warm), history: { prompt: "Warm it", lineage: [identity(warm), identity(warmer)], passes: [] }, marks: [] })
store.write(warmest, "src/chip.css", css("#f00"))
const chainId = `${warm}@${identity(warm).created}`

const app = await startApp()
async function startVite() {
  const server = await createServer({ root, configFile: false, cacheDir: join(root, ".vite"), logLevel: "silent", server: { host: "127.0.0.1", port: 0 }, plugins: [caliper({ wrap: false })] })
  await server.listen()
  return { server, url: await projectBase(app, root) }
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

/** @typedef {import("../src/client/ui/contract").ChromeView} ChromeView */
/** @param {import("playwright-core").Page} page @returns {Promise<ChromeView>} */
const view = page => page.evaluate(() => /** @type {any} */ (window).caliperHarness.snapshot())
/** @param {import("playwright-core").Page} page @param {string} predicate a function of the ChromeView, as source @param {string} what */
async function until(page, predicate, what, timeout = 15_000) {
  try { await page.waitForFunction(`(${predicate})(window.caliperHarness?.snapshot())`, undefined, { timeout, polling: 50 }) }
  catch {
    const current = await view(page).catch(() => null)
    throw new Error(`Timed out waiting for ${what}. Notices: ${JSON.stringify(current?.composer.notices)} Canvas: ${JSON.stringify(current?.canvas._tag === "Frames" ? current.canvas.chains : current?.canvas)}`)
  }
}
/** @param {import("playwright-core").Page} page @param {string} part @param {string | null} take */
async function open(page, part, take) {
  await installRouting(page, app)
  await page.goto(new URL(`markup-harness.html#part=${part}&state=takes:default&device=iphone-16${take ? `&take=${take}` : ""}`, vite.url).href)
  await until(page, `view => view?.canvas._tag === "Frames" && view.canvas.mode === "Takes" && view.canvas.chains.length > 0`, "the Takes canvas with chains", 30_000)
}
/** The chain warm, warmer, warmest. @param {import("playwright-core").Page} page */
const chain = page => page.locator(`[data-cal="chain"][data-chain="${chainId}"]`)
/** @param {import("playwright-core").Page} page @returns {Promise<string[]>} */
const confirms = page => page.evaluate(() => /** @type {any} */ (window).caliperHarness.confirms())

const page = await context.newPage()
const pageErrors = /** @type {string[]} */ ([])
page.on("pageerror", error => pageErrors.push(error.message))
try {
  await open(page, chipPart, null)

  await gate("the newest take shows next to its parent, with the chain heading", async () => {
    const current = await view(page)
    const chains = current.canvas._tag === "Frames" ? current.canvas.chains : []
    assert(chains.length === 2, `chains: ${JSON.stringify(chains.map(item => item.label))}`)
    assert((await chain(page).textContent())?.includes(`${warmest} ← from ${warmer}`), "heading missing")
    const keys = await chain(page).locator('iframe[data-take]').evaluateAll(nodes => nodes.map(node => /** @type {HTMLIFrameElement} */ (node).dataset.take))
    assert(JSON.stringify(keys) === JSON.stringify([warmer, warmest]), `pair: ${keys}`)
    return `pair ${keys.join(", ")}`
  })

  await gate("discarding the middle take keeps the chain and shows the gap", async () => {
    await open(page, chipPart, warmer)
    await page.locator(`[data-cal="take-discard"][data-take="${warmer}"]`).click()
    await until(page, `view => view.canvas._tag === "Frames" && view.canvas.chains.some(chain => chain.label === "${warmest} ← from ${warm} (1 discarded)")`, "the gap label")
    assert((await chain(page).textContent())?.includes(`${warmest} ← from ${warm} (1 discarded)`), "the drawn heading lacks the gap")
    assert(store.record(warmest)?.chain?.take === warm && store.record(warm) !== null, "discard removed more than one take")
    await page.screenshot({ path: join(evidence, "gap.png"), fullPage: true })
  })

  await gate("the history opens with the discarded step inert, and a present step selects its take", async () => {
    await chain(page).locator('[data-cal="chain-history"]').click()
    await until(page, `view => view.canvas.chains.some(chain => chain.history._tag === "Open")`, "an open history")
    const discarded = chain(page).locator(`[data-cal="chain-step"][data-take="${warmer}"]`)
    assert(await discarded.count() === 1, "the discarded step is not listed")
    assert(await discarded.evaluate(node => node.tagName !== "BUTTON" || /** @type {HTMLButtonElement} */ (node).disabled || node.getAttribute("aria-disabled") === "true"), "the discarded step is actionable")
    await chain(page).locator(`[data-cal="chain-step"][data-take="${warm}"]`).click()
    await until(page, `view => view.focusedTake?.id === "${warm}" && view.canvas.mode === "Takes" && view.canvas.chains.some(chain => chain.take === "${warm}")`, `take ${warm} in the pair`)
    await chain(page).locator('[data-cal="chain-history"]').click()
    await until(page, `view => view.canvas.chains.every(chain => chain.history._tag !== "Open")`, "a folded history")
  })

  await gate("accept removes its whole chain, says so first, and flags takes an accept can undo", async () => {
    await open(page, chipPart, warmest)
    await page.locator(`[data-cal="take-accept"][data-take="${warmest}"]`).click()
    await until(page, `() => window.caliperHarness.confirms().length > 0`, "the accept confirmation")
    const asked = (await confirms(page)).at(-1) ?? ""
    assert(asked.includes(`Accept also removes take ${warm} of this chain.`), `confirmation: ${asked}`)
    await until(page, `view => view.canvas._tag === "Frames" && !view.canvas.frames.some(frame => frame.take === "${warmest}" || frame.take === "${warm}")`, "the chain gone")
    assert(store.record(warm) === null && store.record(warmest) === null, `store still has ${store.list()}`)
    assert(store.record(badge) !== null && store.record(plain) !== null, "accept removed another chain")
    assert(readFileSync(join(root, "src/chip.css"), "utf8").includes("#f00"), "the accepted files were not copied")
    const log = JSON.parse(readFileSync(join(root, ".caliper/accepted.json"), "utf8"))
    assert(log.length === 1 && log[0].take === warmest && log[0].files.includes("src/chip.css"), `log: ${JSON.stringify(log)}`)
    const flagged = page.locator(`[data-cal="chain-flag"]`)
    await flagged.first().waitFor()
    assert((await flagged.first().textContent())?.includes(`made before take ${warmest} was accepted`), "the same-part take is not flagged")
    await open(page, badgePart, badge)
    await page.locator('[data-cal="chain-flag"]').first().waitFor()
    assert((await page.locator('[data-cal="chain-flag"]').first().textContent())?.includes(`made before take ${warmest} was accepted`), "the other part's take is not flagged")
    await page.screenshot({ path: join(evidence, "flagged.png"), fullPage: true })
  })

  await gate("a Vite restart keeps the flags", async () => {
    await vite.server.close()
    vite = await startVite()
    await open(page, badgePart, badge)
    await page.locator('[data-cal="chain-flag"]').first().waitFor({ timeout: 15_000 })
    const current = await view(page)
    assert(current.canvas._tag === "Frames" && current.canvas.chains[0]?.flag._tag === "Before", "flag lost after restart")
  })
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join("\n")}`)
} catch (error) {
  results.push({ name: "harness", ok: false, detail: error instanceof Error ? error.stack ?? error.message : String(error) })
  console.error(error)
} finally {
  writeFileSync(join(evidence, "summary.json"), JSON.stringify(results, null, 2))
  await browser.close()
  await app.close()
  await vite.server.close()
  if (!keep) rmSync(root, { recursive: true, force: true })
  else console.log(`Subject kept: ${root}`)
}
console.log(`Evidence: ${evidence}`)
const failed = results.filter(result => !result.ok)
console.log(`${results.length - failed.length} of ${results.length} chain gates passed.`)
process.exit(failed.length ? 1 : 0)
