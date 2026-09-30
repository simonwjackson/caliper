#!/usr/bin/env -S nix develop -c node
// Real browser/package delivery. No model calls, source shims or global I/O interception.
import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { once } from "node:events"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"
import { TOOL_REVISION, toolDirectory, verifiedToolDirectory } from "../src/build/tool.js"

assert(process.env.CHROMIUM, "nix develop must provide CHROMIUM")
const packageRoot = fileURLToPath(new URL("../", import.meta.url))
const evidence = mkdtempSync(join(tmpdir(), "caliper-chrome-delivery-"))
const consumers = []
const results = []
const packageName = "@simonwjackson/caliper"
const fixtureDependencies = { react: "18.3.1", "react-dom": "18.3.1", vite: "6.4.2" }
const part = "src/Counter.part.tsx"
const source = `import { useState } from "react"
export default function Counter() {
  const [count, setCount] = useState(0)
  return <main><h1>Delivery source</h1><button onClick={() => setCount(count + 1)}>Count {count}</button></main>
}
`
/** @type {import('node:child_process').ChildProcess | undefined} */
let activeServer
/** @type {import('playwright-core').Browser | undefined} */
let browser
/** @type {import('playwright-core').Page | undefined} */
let activePage

/** @param {string} path @param {string} text */
function write(path, text) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
/** @param {string} command @param {string[]} args @param {string} cwd @param {string} label */
function run(command, args, cwd, label) {
  try {
    const output = execFileSync(command, args, { cwd, env: process.env, timeout: 180_000, encoding: "utf8", maxBuffer: 32_000_000, stdio: ["ignore", "pipe", "pipe"] })
    write(join(evidence, `${label}.stdout`), output)
    return output
  } catch (error) {
    write(join(evidence, `${label}.error`), String(error))
    throw error
  }
}
/** @param {string} root @param {string} label @param {boolean} [subject] */
async function start(root, label, subject = false) {
  const serverFile = join(evidence, `${label}-server.mjs`)
  // Resolve Vite from the temporary consumer or the independent tool, not this
  // verifier. This also logs the real consumer resolution and transform graph.
  const viteRoot = subject ? toolDirectory : root
  write(serverFile, `import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(${JSON.stringify(join(viteRoot, "package.json"))});
const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
const graph = ${JSON.stringify(join(evidence, `${label}-graph.ndjson`))};
const pluginPath = ${subject ? JSON.stringify(join(toolDirectory, "src/plugin.js")) : 'require.resolve("@simonwjackson/caliper")'};
const { caliper } = await import(pathToFileURL(pluginPath).href);
const server = await createServer({ root: ${JSON.stringify(root)}, ${subject ? `configFile: ${JSON.stringify(join(packageRoot, "vite.config.js"))},` : "configFile: false,"} logLevel: "error",
plugins: [{name: "delivery-graph", enforce: "pre", resolveId(id, importer) { appendFileSync(graph, JSON.stringify({kind: "resolve", id, importer}) + "\\n"); }, transform(_code, id) { appendFileSync(graph, JSON.stringify({kind: "transform", id}) + "\\n"); }}, ${subject ? "" : "caliper({wrap: false}),"}],
server: {host: "127.0.0.1", port: 0}, ${subject ? "" : 'base: "/preview/",'} });
let closing = false;
async function close() { if (closing) return; closing = true; server.httpServer?.closeAllConnections(); await server.close(); process.exit(0); }
process.on("SIGTERM", close); process.on("SIGINT", close);
await server.listen();
console.log("READY " + JSON.stringify({url: server.resolvedUrls.local[0], plugin: pluginPath, root: server.config.root, react: ${subject ? '"subject"' : 'require("react/package.json").version'}}));
`)
  const child = spawn(process.execPath, [serverFile], { cwd: root, stdio: ["ignore", "pipe", "pipe"] })
  activeServer = child
  let output = ""
  let errors = ""
  child.stderr.on("data", value => { errors += value; write(join(evidence, `${label}-server.stderr`), errors) })
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer
  try {
    return await new Promise(/** @param {(value: {url: string, plugin: string, root: string, react: string}) => void} resolve */ (resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Server startup timed out: ${errors}`)), 30_000)
      child.on("error", reject)
      child.on("close", code => reject(new Error(`Server exited ${code}: ${errors}`)))
      child.stdout.on("data", value => {
        output += value
        write(join(evidence, `${label}-server.stdout`), output)
        const line = output.split("\n").find(line => line.startsWith("READY "))
        if (line) resolve(JSON.parse(line.slice(6)))
      })
    })
  } finally { clearTimeout(timer) }
}
async function stop() {
  const child = activeServer
  activeServer = undefined
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const closed = once(child, "close")
  child.kill("SIGTERM")
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000)
  try { await closed } finally { clearTimeout(timer) }
}
/** @param {string} url @param {string} path */
async function json(url, path) {
  const response = await fetch(new URL(path.replace(/^\//, ""), url))
  assert.equal(response.status, 200, await response.clone().text())
  return response.json()
}

console.log(`Chrome delivery evidence: ${evidence}`)
try {
  run("bun", ["install", "--frozen-lockfile"], packageRoot, "install")
  // Pack must itself run prepack. Do not pass --ignore-scripts here.
  const tarball = join(evidence, "caliper.tgz")
  run("bun", ["pm", "pack", "--filename", tarball], packageRoot, "pack")
  const contents = run("tar", ["-tf", tarball], packageRoot, "tar-contents")
  assert(contents.includes("package/dist/chrome/chrome.js"), "The packed artifact must contain the built chrome")
  assert(contents.includes("package/dist/chrome/.vite/manifest.json"))
  const tarballSha256 = createHash("sha256").update(readFileSync(tarball)).digest("hex")
  const manifest = JSON.parse(readFileSync(join(packageRoot, "dist/chrome/.vite/manifest.json"), "utf8"))
  const editor = Object.values(manifest).find((/** @type {any} */ value) => value.file.startsWith("editor-"))
  assert(editor, "CodeMirror/editorAppearance must have a lazy editor chunk")
  const editorFile = /** @type {{file:string}} */ (editor).file
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })

  for (const mode of ["linked", "packed"]) {
    const root = mkdtempSync(join(tmpdir(), `caliper-chrome-${mode}-`))
    consumers.push(root)
    const dependencies = mode === "packed" ? { ...fixtureDependencies, [packageName]: tarball } : fixtureDependencies
    write(join(root, "package.json"), JSON.stringify({ name: `${mode}-react18-subject`, private: true, type: "module", exports: { ".": "./src/index.ts" }, dependencies }, null, 2))
    run("bun", ["install", "--linker", "isolated"], root, `${mode}-install`)
    const installed = join(root, "node_modules", packageName)
    if (mode === "linked") { mkdirSync(dirname(installed), { recursive: true }); symlinkSync(packageRoot, installed, "dir") }
    copyFileSync(join(root, "bun.lock"), join(evidence, `${mode}-bun.lock`))
    assert(!existsSync(join(root, "node_modules/@codemirror/state")), "Consumer must not install CodeMirror directly")
    write(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }))
    write(join(root, "src/index.ts"), "export {}\n")
    write(join(root, part), source)
    const ready = await start(root, mode)
    assert.equal(realpathSync(ready.plugin), join(realpathSync(installed), "src/plugin.js"))
    assert.equal(ready.react, "18.3.1")
    /** @type {import('playwright-core').BrowserContext} */
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
    // Observe actual React renderer internals in each same-origin document. The
    // dispatcher reference, not only the version, must be a distinct object.
    await context.addInitScript(() => {
      const target = /** @type {any} */ (window)
      const renderers = new Map()
      target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true, renderers,
        inject(/** @type {any} */ renderer) { const id = renderers.size + 1; renderers.set(id, renderer); return id },
        onCommitFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
      }
    })
    /** @type {import('playwright-core').Page} */
    const page = await context.newPage()
    activePage = page
    /** @type {string[]} */
    const requests = []
    /** @type {string[]} */
    const topRequests = []
    /** @type {string[]} */
    const errors = []
    page.on("request", request => { requests.push(request.url()); if (request.frame() === page.mainFrame()) topRequests.push(request.url()) })
    page.on("pageerror", error => errors.push(error.message))
    page.on("console", message => { if (message.type() === "error") errors.push(`${message.text()} ${message.location().url}`) })
    page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`) })
    await page.goto(new URL("__caliper/", ready.url).href)
    await page.locator('[data-cal="chrome"]').waitFor()
    const frameHost = page.locator('iframe[data-cal="frame"]').first()
    await frameHost.waitFor()
    const product = page.frameLocator('iframe[data-cal="frame"]').first()
    await product.getByRole("button", { name: "Count 0", exact: true }).click()
    await product.getByRole("button", { name: "Count 1", exact: true }).waitFor()
    /** @type {{tool: string, subject: string, independentDispatchers: boolean}} */
    const internals = await page.evaluate(() => {
      const top = /** @type {any} */ (window).__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.values().next().value
      const frame = /** @type {any} */ (document.querySelector('iframe[data-cal="frame"]'))?.contentWindow
      const subject = frame.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.values().next().value
      return { tool: top.version, subject: subject.version, independentDispatchers: top.currentDispatcherRef !== subject.currentDispatcherRef && !!top.currentDispatcherRef && !!subject.currentDispatcherRef }
    })
    assert.equal(internals.tool, "19.2.4")
    assert.equal(internals.subject, "18.3.1")
    assert.equal(internals.independentDispatchers, true, "Chrome and product must use distinct React dispatcher internals")
    assert(!topRequests.some(url => /node_modules|\/@vite\/|\/@id\/|\/@fs\//.test(url)), "Chrome must not ask consumer Vite to load dependencies")
    assert(!requests.some(url => url.endsWith(editorFile)), "Editor must remain unloaded during normal preview")
    const filter = page.locator('[data-cal="parts-filter"]')
    await filter.fill("Counter")
    write(join(root, part), source.replace("Delivery source", "HMR source"))
    await product.getByRole("heading", { name: "HMR source", exact: true }).waitFor()
    assert.equal(await filter.inputValue(), "Counter", "Product source HMR must not reset the chrome's filter state")
    await product.getByRole("button", { name: "Count 0", exact: true }).click()
    await product.getByRole("button", { name: "Count 1", exact: true }).waitFor()
    const before = requests.length
    await page.locator('[data-cal="tool"][data-tool="code"]').click()
    await page.locator('[data-cal="code-editor"] .cm-editor').waitFor()
    assert(requests.slice(before).some(url => url.endsWith(editorFile)), "Opening Code must load Caliper's editor chunk")
    assert(!requests.some(url => /\/__caliper\/modules\//.test(url)), "CodeMirror must not fall back to the legacy import map")
    const graph = readFileSync(join(evidence, `${mode}-graph.ndjson`), "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line))
    assert(!graph.some(item => /\/client\/(?:app|ui)\/|code-editor\.js|dist\/chrome\//.test(item.importer ?? item.id)), "Consumer Vite must never resolve or transform chrome source")
    assert.deepEqual(errors, [], `${mode} chrome and interactive React18 product have no browser errors`)
    await page.screenshot({ path: join(evidence, `${mode}.png`) })
    write(join(evidence, `${mode}-requests.json`), JSON.stringify({ requests, topRequests }, null, 2))
    results.push({ mode, installation: ready, internals, editorFile, hmr: "Passed" })
    await context.close()
    activePage = undefined
    await stop()
    console.log(`PASS ${mode}: independent React19/18 dispatchers; lazy editor; source HMR; consumer resolution isolation`)
  }

  run("bun", ["run", "tool:install"], packageRoot, "tool-install")
  const pinned = verifiedToolDirectory()
  assert.equal(pinned, toolDirectory)
  const pinBefore = readFileSync(join(pinned, "src/plugin.js"), "utf8")
  // Load the actual subject checkout through its real self-hosting config.
  // Run 1's temporary core-owned reference is the exact approved subject here.
  // It uses the existing renderer and real app with local inputs. It does not
  // establish Darkroom appearance, layout, or UI-owned region scenario coverage.
  const ready = await start(packageRoot, "self-host", true)
  assert.equal(ready.root, packageRoot.replace(/\/$/, ""))
  assert.equal(ready.plugin, join(pinned, "src/plugin.js"))
  const project = await json(ready.url, "/__caliper/project.json")
  const subjectPart = "src/client/app/Reference.page.part.tsx"
  const chromePart = project.parts.find((/** @type {{file:string}} */ candidate) => candidate.file === subjectPart)
  assert(chromePart, `The approved temporary reference subject ${subjectPart} must exist`)
  assert.deepEqual(chromePart.states.map((/** @type {{export:string}} */ state) => state.export).sort(), ["Calibrate", "Unreachable", "default"])
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  activePage = page
  /** @type {string[]} */
  const selfHostErrors = []
  page.on("pageerror", error => selfHostErrors.push(error.message))
  page.on("console", message => { if (message.type() === "error") selfHostErrors.push(`${message.text()} ${message.location().url}`) })
  // Open the real pinned tool page (the Darkroom chrome), not only an isolated subject frame.
  await page.goto(new URL(`__caliper/#part=${encodeURIComponent(subjectPart)}&state=default`, ready.url).href)
  const subjectFrame = page.frameLocator('iframe[src*="Reference.page.part.tsx"][src*="state=default"]')
  await subjectFrame.locator('[data-cal="chrome"]').waitFor()
  const localFilter = subjectFrame.locator('[data-cal="parts-filter"]')
  await localFilter.fill("Local scenario filter")
  assert.equal(await localFilter.inputValue(), "Local scenario filter")
  await subjectFrame.locator('[data-cal="tool"][data-tool="calibrate"]').click()
  await subjectFrame.locator('[data-cal="calibration"]').waitFor()
  await subjectFrame.locator('[data-cal="calibration-close"]').click()
  await subjectFrame.locator('[data-cal="calibration"]').waitFor({ state: "detached" })
  await page.screenshot({ path: join(evidence, "self-host.png") })
  const stateEvidence = []
  for (const state of ["default", "Calibrate", "Unreachable"]) {
    await page.goto(new URL(`__caliper/frame?part=${encodeURIComponent(subjectPart)}&state=${state}`, ready.url).href)
    await page.waitForFunction(() => document.documentElement.dataset.caliperState === "Rendered")
    if (state === "Calibrate") {
      await page.locator('[data-cal="calibration-scale"]').focus()
      await page.keyboard.press("ArrowRight")
      await page.locator('[data-cal="calibration"] output').filter({ hasText: "Calibrated" }).waitFor()
      await page.locator('[data-cal="calibration-reset"]').click()
      await page.locator('[data-cal="calibration"] output').filter({ hasText: "Assumed" }).waitFor()
    }
    if (state === "Unreachable") await page.locator('[data-cal="connection"]').filter({ hasText: "The local scenario records an unreachable subject server." }).waitFor()
    const screenshot = join(evidence, `self-host-${state}.png`)
    await page.screenshot({ path: screenshot })
    stateEvidence.push({ state, screenshot })
  }
  assert.deepEqual(selfHostErrors, [], "The real reference subject and pinned tool have no browser errors")
  const sourceResponse = await json(ready.url, `/__caliper/code/file?file=${encodeURIComponent(chromePart.file)}`)
  assert.equal(sourceResponse.content, readFileSync(join(packageRoot, chromePart.file), "utf8"), "Tool must read the real subject file")
  const refusal = await page.request.post(new URL("__caliper/code/file", ready.url).href, { headers: { origin: new URL(ready.url).origin }, data: { file: join(pinned, "src/plugin.js"), content: "export {}" } })
  assert.equal(refusal.status(), 400, "Subject write API must reject the independent tool path")
  assert.equal(readFileSync(join(pinned, "src/plugin.js"), "utf8"), pinBefore)
  verifiedToolDirectory()
  await page.close()
  activePage = undefined
  await stop()
  results.push({ mode: "self-host", revision: TOOL_REVISION, directory: pinned, subject: packageRoot, part: chromePart.file, states: stateEvidence, toolWriteRefused: true, coverage: "Temporary core-owned reference only; no Darkroom or UI-owned region scenario coverage" })
  write(join(evidence, "summary.json"), JSON.stringify({ status: "Passed", tarballSha256, fixtureDependencies, results }, null, 2))
  console.log(`PASS self-host: pinned tool ${TOOL_REVISION}; actual subject source; tool outside write fence`)
  console.log(`PASS chrome delivery. Evidence: ${evidence}`)
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: join(evidence, "failure.png") }).catch(() => {})
    write(join(evidence, "failure.html"), await activePage.content().catch(() => ""))
    const frames = await Promise.all(activePage.frames().map(async frame => ({ url: frame.url(), content: await frame.content().catch(() => "") })))
    write(join(evidence, "failure-frames.json"), JSON.stringify(frames, null, 2))
  }
  write(join(evidence, "failure.txt"), error instanceof Error ? error.stack ?? error.message : String(error))
  write(join(evidence, "partial-results.json"), JSON.stringify(results, null, 2))
  console.error(`FAIL chrome delivery; evidence: ${evidence}`)
  throw error
} finally {
  try { await browser?.close() } finally { await stop(); for (const root of consumers) rmSync(root, { recursive: true, force: true }) }
}
