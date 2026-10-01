#!/usr/bin/env -S nix develop -c node
// @ts-check
/**
 * Check the Caliper app (decision 37) in Chromium, with the real chrome and
 * plugin: two projects on ports Vite picks, tabs on each, one-port routing
 * through the service worker, HMR, web workers, lazy imports, a stopped
 * service worker, a hard reload, a dev server that restarts on a new port,
 * the project switcher, the token on writes, and one take made by the app's
 * agent through the plugin's host endpoint.
 *
 *   CHROMIUM=... node scripts/verify-central.mjs [--via https://caliper.example/] [--port 3141]
 *
 * `--via` opens the app through a TLS proxy that forwards to --port. Every
 * check runs and reports; the exit code is the number of failures.
 */
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync, readdirSync } from "node:fs"
import { createServer as createHttpServer } from "node:http"
import { createServer as createNetServer } from "node:net"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { parseArgs } from "node:util"
import { chromium } from "playwright-core"
import { createServer } from "vite"
import { caliper } from "../src/plugin.js"
import { projectId, readRegistry } from "../src/central/registry.js"
import { projectBase, startApp, useScriptRegistry } from "./caliper-app.mjs"
import { cal } from "./verify-helpers.mjs"

const { values } = parseArgs({ options: { via: { type: "string" }, port: { type: "string", default: "0" }, pico: { type: "string", default: join(homedir(), "code/sandbox/korri/surfaces/pico") } } })
if (!process.env.CHROMIUM) throw new Error("Set CHROMIUM.")
// Its own registry, even under the gate runner: the checks count the projects.
process.env.CALIPER_REGISTRY = mkdtempSync(join(tmpdir(), "caliper-central-registry-"))
const registry = useScriptRegistry()
const work = mkdtempSync(join(tmpdir(), "caliper-central-"))
/** @param {string} path @param {string} text */
const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
console.log(`work ${work}, registry ${registry}`)

// Two projects: a copy of Pico (React 19) and a React 18 project with a module worker and a lazy import.
const skip = (/** @type {string} */ path) => !/\/(node_modules|\.caliper|\.git|\.vite[^/]*)(\/|$)/.test(path)
const pico = join(work, "pico")
cpSync(values.pico, pico, { recursive: true, filter: skip })
symlinkSync(join(values.pico, "node_modules"), join(pico, "node_modules"), "dir")
const PICO_PART = "src/ui/atoms/PicoButton.atom.part.tsx"
const older = join(work, "react18")
const COUNTER = "src/Counter.part.tsx"
const counter = (/** @type {string} */ heading) => `import { useEffect, useState } from "react"
export default function Counter() {
  const [count, setCount] = useState(0)
  const [worker, setWorker] = useState("waiting")
  const [lazy, setLazy] = useState("not loaded")
  useEffect(() => {
    const echo = new Worker(new URL("./echo.worker.ts", import.meta.url), { type: "module" })
    Object.assign(window, { __echo: echo })
    echo.onmessage = event => setWorker(String(event.data))
    echo.postMessage("ping")
    return () => echo.terminate()
  }, [])
  return <main>
    <h1>{${JSON.stringify(heading)}}</h1>
    <button onClick={() => setCount(count + 1)}>Count {count}</button>
    <button onClick={() => import("./lazy").then(module => setLazy(module.lazyText))}>Load lazy</button>
    <p data-worker>{worker}</p>
    <p data-lazy>{lazy}</p>
  </main>
}
`
write(join(older, "package.json"), JSON.stringify({ name: "react18-subject", private: true, type: "module", exports: { ".": "./src/index.ts" }, dependencies: { react: "18.3.1", "react-dom": "18.3.1" } }, null, 2))
write(join(older, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react-jsx", module: "esnext", target: "es2022" } }))
write(join(older, "src/index.ts"), "export {}\n")
write(join(older, COUNTER), counter("Routing source"))
write(join(older, "src/echo.worker.ts"), `import { shout } from "./shout"\nself.onmessage = event => event.data === "import" ? import(/* @vite-ignore */ "/src/lazy.ts?worker-after-stop=" + Date.now()).then(module => self.postMessage(module.lazyText + " in worker")) : self.postMessage(shout(String(event.data)))\n`)
write(join(older, "src/shout.ts"), `export const shout = (text: string) => "worker says " + text.toUpperCase()\n`)
write(join(older, "src/lazy.ts"), `export const lazyText = "lazy loaded"\n`)
execFileSync("bun", ["install", "--linker", "isolated"], { cwd: older, stdio: "pipe" })

// A scripted model: the take agent writes one file, then says it is done.
const model = createHttpServer((request, response) => {
  let body = ""
  request.on("data", chunk => { body += chunk })
  request.on("end", () => {
    const call = JSON.parse(body)
    const done = call.messages?.some((/** @type {{ role: string }} */ message) => message.role === "tool")
    const delta = done ? { role: "assistant", content: "Done." }
      : { role: "assistant", tool_calls: [{ index: 0, id: "write", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: COUNTER, content: counter("Take heading") }) } }] }
    const base = { id: "local", object: "chat.completion.chunk", created: 0, model: "scripted" }
    response.writeHead(200, { "content-type": "text/event-stream" })
    response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta }] })}\n\n`)
    response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: done ? "stop" : "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`)
    response.end("data: [DONE]\n\n")
  })
})
await new Promise(resolve => model.listen(0, "127.0.0.1", () => resolve(undefined)))
process.env.CALIPER_CENTRAL_VERIFY_KEY = "local"
const modelPort = /** @type {import("node:net").AddressInfo} */ (model.address()).port

/** @param {string} root */
const startVite = async root => {
  const server = await createServer({ root, configFile: false, cacheDir: join(root, ".vite-central"), logLevel: "silent", oxc: { jsx: { runtime: "automatic" } }, plugins: [caliper({ wrap: false })], server: { host: "127.0.0.1", port: 0 } })
  await server.listen()
  return server
}
/** @type {Map<string, import("vite").ViteDevServer>} */
const servers = new Map([["pico", await startVite(pico)], ["react18", await startVite(older)]])
const app = await startApp({ port: Number(values.port), agent: { model: "scripted", baseUrl: `http://127.0.0.1:${modelPort}/v1`, apiKeyEnv: "CALIPER_CENTRAL_VERIFY_KEY", reasoning: "off", skills: false } })
const ids = { pico: projectId(pico), react18: projectId(older) }
const direct = { pico: await projectBase(app, pico), react18: await projectBase(app, older) }
const via = values.via ? new URL(values.via) : new URL(app.url)
/** The project's chrome base as the browser opens it. @param {"pico" | "react18"} name */
const base = name => new URL(new URL(direct[name]).pathname, via).href
console.log(`app ${app.url}, browser uses ${via.href}`)

/** @type {{ name: string, ok: boolean, detail: unknown }[]} */
const results = []
/** @param {string} name @param {() => Promise<unknown>} run */
async function check(name, run) {
  const started = Date.now()
  try {
    const detail = await run()
    results.push({ name, ok: true, detail: { ms: Date.now() - started, ...(detail && typeof detail === "object" ? detail : {}) } })
    console.log(`PASS ${name}`)
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) })
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : error}`)
  }
}
/** @param {unknown} ok @param {string} message */
const assert = (ok, message) => { if (!ok) throw new Error(message) }

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } })
await context.addInitScript(() => {
  const renderers = new Map()
  Object.assign(window, { __REACT_DEVTOOLS_GLOBAL_HOOK__: {
    supportsFiber: true, renderers,
    inject(/** @type {any} */ renderer) { const id = renderers.size + 1; renderers.set(id, renderer); return id },
    onCommitFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
  } })
})
/** @type {string[]} */
const sockets = []
/** @type {string[]} */
const problems = []
/** @param {string} url */
async function open(url) {
  const tab = await context.newPage()
  tab.on("dialog", dialog => void dialog.accept())
  tab.on("websocket", socket => sockets.push(socket.url()))
  tab.on("pageerror", error => problems.push(`pageerror ${error.message}`))
  tab.on("console", message => { if (message.type() === "error") problems.push(`console ${message.text()} ${message.location().url}`) })
  tab.on("response", response => { if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`) })
  await tab.goto(url)
  return tab
}
/** @param {import("playwright-core").Page} tab @param {string} id */
const framesOf = (tab, id) => tab.frames().filter(frame => frame.url().includes(`/__caliper/p/${id}/`) && frame.url().includes("/__caliper/frame"))
/** @param {import("playwright-core").Page} tab @param {string} id @param {number} [timeout] */
async function rendered(tab, id, timeout = 60_000) {
  const end = Date.now() + timeout
  for (;;) {
    const frames = framesOf(tab, id)
    const states = await Promise.all(frames.map(frame => frame.evaluate(() => document.documentElement.dataset.caliperState).catch(() => undefined)))
    if (frames.length > 0 && states.every(state => state === "Rendered")) return frames
    if (Date.now() > end) throw new Error(`frames of ${id}: ${JSON.stringify(states)}`)
    await tab.waitForTimeout(150)
  }
}
/** @param {import("playwright-core").Frame} frame */
const renderers = frame => frame.evaluate(() => [.../** @type {any} */ (window).__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.values()].map(renderer => renderer.version))
const markAll = (/** @type {import("playwright-core").Page[]} */ tabs) => Promise.all(tabs.flatMap(tab => tab.frames().filter(frame => frame.url().includes("/__caliper/frame")).map(frame => frame.evaluate(() => Object.assign(window, { __mark: 1 })).catch(() => undefined))))
/** @param {import("playwright-core").Frame} frame */
const marked = frame => frame.evaluate(() => /** @type {any} */ (window).__mark === 1)
const picoUrl = `${base("pico")}__caliper/#${new URLSearchParams({ part: PICO_PART, state: "default", device: "iphone-16" })}`
const olderUrl = `${base("react18")}__caliper/#${new URLSearchParams({ part: COUNTER, state: "default", device: "iphone-16" })}`

/** @type {Record<string, import("playwright-core").Page>} */
const tabs = {}
await check("the project list shows both projects, each with a link to its chrome", async () => {
  const tab = await open(new URL("/__caliper/", via).href)
  await tab.locator('[data-cal="projects"] a').nth(1).waitFor({ timeout: 10_000 })
  const links = await tab.locator('[data-cal="projects"] a').evaluateAll(nodes => nodes.map(node => /** @type {HTMLAnchorElement} */ (node).getAttribute("href")))
  assert(links.includes(new URL(direct.pico).pathname + "__caliper/") && links.includes(new URL(direct.react18).pathname + "__caliper/"), JSON.stringify(links))
  await tab.close()
  return { links }
})

await check("two tabs, one on each project, render their frames", async () => {
  tabs.pico = await open(picoUrl)
  tabs.older = await open(olderUrl)
  await rendered(tabs.pico, ids.pico)
  await rendered(tabs.older, ids.react18)
  const routed = await Promise.all(Object.values(tabs).map(tab => tab.evaluate(() => document.documentElement.dataset.calRouted === "true" && !!navigator.serviceWorker.controller)))
  assert(routed.every(Boolean), `service worker control: ${routed}`)
})

await check("each frame loads one React, from its own project", async () => {
  const pico19 = await renderers(/** @type {import("playwright-core").Frame} */ (framesOf(tabs.pico, ids.pico)[0]))
  const react18 = await renderers(/** @type {import("playwright-core").Frame} */ (framesOf(tabs.older, ids.react18)[0]))
  assert(pico19.length === 1 && pico19[0]?.startsWith("19."), `Pico frame: ${pico19}`)
  assert(react18.length === 1 && react18[0] === "18.3.1", `React 18 frame: ${react18}`)
  const chrome = await tabs.pico.evaluate(() => [.../** @type {any} */ (window).__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.values()].map(renderer => renderer.version))
  return { pico19, react18, chrome }
})

await check("every HMR socket reaches the app's host at its project's path", async () => {
  const hmr = sockets.filter(url => url.includes("/__caliper/hmr/"))
  assert(hmr.some(url => url.includes(ids.pico)) && hmr.some(url => url.includes(ids.react18)), `sockets: ${sockets.join(", ")}`)
  for (const url of hmr) assert(new URL(url).host === via.host, `socket went to ${url}`)
  return { sockets: [...new Set(hmr.map(url => new URL(url).pathname))] }
})

await check("a module worker and a lazy import route to the React 18 project", async () => {
  const frame = /** @type {import("playwright-core").Frame} */ (framesOf(tabs.older, ids.react18)[0])
  await frame.locator("[data-worker]").getByText("worker says PING").waitFor({ timeout: 20_000 })
  await frame.getByRole("button", { name: "Load lazy" }).click()
  await frame.locator("[data-lazy]").getByText("lazy loaded").waitFor({ timeout: 20_000 })
})

await check("an edit in one project reloads its frames and no frame of the other", async () => {
  await markAll(Object.values(tabs))
  write(join(older, COUNTER), counter("HMR source"))
  const frame = /** @type {import("playwright-core").Frame} */ ((await rendered(tabs.older, ids.react18))[0])
  await frame.getByRole("heading", { name: "HMR source" }).waitFor({ timeout: 20_000 })
  const picoKept = await Promise.all(framesOf(tabs.pico, ids.pico).map(marked))
  assert(picoKept.every(Boolean), "a Pico frame reloaded after a React 18 edit")
})

await check("a Pico CSS edit is a hot update, with no frame reload", async () => {
  await markAll([tabs.pico])
  const file = join(pico, "src/ui/atoms/PicoButton.css")
  writeFileSync(file, `${readFileSync(file, "utf8")}\nhtml { --central-hmr: 1; }\n`)
  const frame = /** @type {import("playwright-core").Frame} */ (framesOf(tabs.pico, ids.pico)[0])
  await frame.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--central-hmr").trim() === "1", undefined, { timeout: 20_000 })
  assert(await marked(frame), "the Pico frame reloaded for a CSS edit")
})

await check("routing survives a stopped service worker, for a frame and its web worker", async () => {
  const session = await context.newCDPSession(tabs.older)
  await session.send("ServiceWorker.enable")
  await session.send("ServiceWorker.stopAllWorkers")
  await tabs.older.waitForTimeout(500)
  const frame = /** @type {import("playwright-core").Frame} */ (framesOf(tabs.older, ids.react18)[0])
  const answer = await frame.evaluate(async () => {
    const module = await import(/* @vite-ignore */ `/src/lazy.ts?after-stop=${Date.now()}`)
    const inWorker = await new Promise(done => {
      const echo = /** @type {any} */ (window).__echo
      echo.onmessage = (/** @type {MessageEvent} */ event) => done(String(event.data))
      echo.postMessage("import")
      setTimeout(() => done("no answer"), 10_000)
    })
    return { lazy: module.lazyText, inWorker }
  })
  assert(answer.lazy === "lazy loaded" && answer.inWorker === "lazy loaded in worker", JSON.stringify(answer))
  return answer
})

await check("a hard reload of the chrome recovers with one normal reload", async () => {
  const session = await context.newCDPSession(tabs.older)
  await session.send("Page.reload", { ignoreCache: true })
  await tabs.older.waitForFunction(() => document.documentElement.dataset.calRouted === "true", undefined, { timeout: 30_000 })
  await rendered(tabs.older, ids.react18)
})

await check("the switcher lists both projects and opens the other one in this tab", async () => {
  const tab = await open(picoUrl)
  const select = tab.locator(cal.project)
  await select.waitFor({ state: "attached", timeout: 20_000 })
  const options = await select.locator("option").allTextContents()
  assert(options.length === 2, `options: ${options}`)
  await select.selectOption(ids.react18)
  await tab.waitForURL(url => url.pathname.startsWith(new URL(direct.react18).pathname), { timeout: 10_000 })
  await tab.locator(cal.nav).first().waitFor({ state: "attached" })
  await tab.close()
  return { options }
})

await check("the plugin refuses a write without its token, and the app refuses another site's page", async () => {
  const vite = /** @type {import("vite").ViteDevServer} */ (servers.get("react18"))
  const own = `${vite.resolvedUrls?.local[0]}__caliper/takes/1/discard`
  const plugin = await fetch(own, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
  const foreign = await fetch(`${direct.react18}__caliper/knobs/write`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" })
  assert(plugin.status === 401, `plugin answered ${plugin.status}`)
  assert(foreign.status === 403, `app answered ${foreign.status}`)
  const entry = readRegistry(registry).find(item => item.id === ids.react18)
  const file = readdirSync(registry).find(name => name.includes(ids.react18))
  const mode = file ? (statSync(join(registry, file)).mode & 0o777).toString(8) : "none"
  assert(entry && mode === "600" && (statSync(registry).mode & 0o777).toString(8) === "700", `modes: file ${mode}, folder ${(statSync(registry).mode & 0o777).toString(8)}`)
})

await check("the app's agent makes a take through the plugin, and the take renders in the chrome", async () => {
  const started = await fetch(`${direct.react18}__caliper/takes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ part: COUNTER, state: "default", device: "iphone-16", prompt: "Change the heading" }) })
  const body = await started.json()
  assert(started.status === 201, JSON.stringify(body))
  const take = body.take
  const end = Date.now() + 60_000
  /** @type {any} */
  let view
  while (Date.now() < end) {
    const snapshot = await (await fetch(`${direct.react18}__caliper/takes.json`)).json()
    view = snapshot.takes.find((/** @type {any} */ item) => item.take === take)
    if (view && view.run._tag !== "Running") break
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  assert(view?.run._tag === "Idle" && view.files.includes(COUNTER), JSON.stringify(view?.run ?? view))
  assert(existsSync(join(older, ".caliper/takes", take, COUNTER)), "the take's copy is in the project's take folder")
  const tab = await open(`${base("react18")}__caliper/#${new URLSearchParams({ part: COUNTER, state: "takes:default", device: "iphone-16", take, takeCreated: String(view.created) })}`)
  const end2 = Date.now() + 30_000
  for (;;) {
    const found = framesOf(tab, ids.react18).filter(frame => frame.url().includes(`take=${take}`))
    const text = found.length ? await found[0]?.locator("h1").textContent().catch(() => "") : ""
    if (text === "Take heading") break
    if (Date.now() > end2) throw new Error(`take frame shows ${JSON.stringify(text)}; frames ${tab.frames().map(frame => frame.url()).join(", ")}`)
    await tab.waitForTimeout(200)
  }
  const discard = await fetch(`${direct.react18}__caliper/takes/${take}/discard`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
  assert(discard.ok, `discard answered ${discard.status}`)
  await tab.close()
  return { take, log: view.log.map((/** @type {any} */ entry) => entry._tag) }
})

await check("a project whose dev server restarts on a new port comes back in its open frames", async () => {
  const before = /** @type {import("../src/central/registry.js").Entry} */ (readRegistry(registry).find(item => item.id === ids.react18))
  await markAll([tabs.older])
  await servers.get("react18")?.close()
  const holder = createNetServer()
  await new Promise(resolve => holder.listen(Number(new URL(before.url).port), "127.0.0.1", () => resolve(undefined)))
  servers.set("react18", await startVite(older))
  await projectBase(app, older)
  const after = /** @type {import("../src/central/registry.js").Entry} */ (readRegistry(registry).find(item => item.id === ids.react18))
  const end = Date.now() + 60_000
  for (;;) {
    const frame = framesOf(tabs.older, ids.react18)[0]
    if (frame && !(await marked(frame).catch(() => true)) && await frame.evaluate(() => document.documentElement.dataset.caliperState === "Rendered").catch(() => false)) break
    if (Date.now() > end) throw new Error(`the frame did not come back on ${after.url}`)
    await tabs.older.waitForTimeout(250)
  }
  holder.close()
  return { before: before.url, after: after.url }
})

await check("no request reached the app without a project", async () => {
  assert(app.misses.length === 0, `misses: ${app.misses.join(", ")}`)
})

await check("no browser errors", async () => {
  // Restarting a dev server closes its sockets and event stream on purpose.
  const real = problems.filter(line => !/WebSocket connection .* failed|server connection lost|Failed to load resource: .* 50[23]|^50[23] |ERR_INCOMPLETE_CHUNKED_ENCODING|net::ERR_ABORTED/.test(line))
  assert(real.length === 0, real.slice(0, 12).join("\n"))
  return { ignored: problems.length - real.length }
})

await browser.close()
await app.close()
for (const server of servers.values()) await server.close()
model.close()
const failed = results.filter(result => !result.ok)
writeFileSync(join(work, "report.json"), JSON.stringify({ via: via.href, results }, null, 2))
console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Report: ${join(work, "report.json")}`)
process.exit(failed.length)
