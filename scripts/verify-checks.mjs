#!/usr/bin/env -S nix shell nixpkgs#nodejs --command node
// Exercise the public CLI and real render/agent tools against a temporary React consumer.
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createServer as createHttpServer } from "node:http"
import { once } from "node:events"
import { setTimeout } from "node:timers/promises"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs, promisify } from "node:util"
import { createServer } from "vite"
import { caliper } from "../src/plugin.js"
import { checkJobs } from "../src/render/checks.js"
import { createTakeStore } from "../src/takes/store.js"

const { values } = parseArgs({ options: { modules: { type: "string" }, out: { type: "string", default: "/tmp/caliper-checks-browser" } } })
assert(values.modules && process.env.CHROMIUM, "Pass --modules and set CHROMIUM")
const root = mkdtempSync(join(tmpdir(), "caliper-checks-consumer-"))
const out = resolve(values.out)
mkdirSync(out, { recursive: true })
const baselines = join(root, ".caliper", "baselines")
const cli = fileURLToPath(new URL("../bin/caliper-render.mjs", import.meta.url))
const runFile = promisify(execFile)
/** @param {string[]} args */
const run = async args => {
  const { stdout } = await runFile(process.execPath, [cli, ...args], { maxBuffer: 8_000_000, timeout: 120_000 })
  return JSON.parse(stdout)
}
/** @param {string} file @param {string} text */
const write = (file, text) => { const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
const part = "src/Button.atom.part.tsx"
const source = `import { useEffect } from "react"
export default function Default() { return <button>Ready</button> }
export function MissingName() { return <button style={{ width: 60, height: 30 }} /> }
export function Empty() { return null }
export function Throwing() { throw new Error("deliberate render failure") }
export function BrowserError() { useEffect(() => console.error("deliberate browser error"), []); return <button>Error</button> }
export function Overflow() { return <button style={{ width: 1800 }}>A scrollable or clipped control</button> }
export function Unstable() { return <button>{crypto.randomUUID()}</button> }
`
write("package.json", JSON.stringify({ name: "checks-consumer", type: "module", exports: { ".": "./src/index.ts" } }))
write("tsconfig.json", JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }))
write("src/index.ts", 'import "./global.css"')
write("src/global.css", "body { margin: 0; background: white; color: black; } button { color: black; background: white; }")
write(part, source)
// These paths used to collide when screenshots replaced slashes with hyphens.
write("src/a/b.part.tsx", 'export default function Part() { return <button>Nested</button> }')
write("src/a-b.part.tsx", 'export default function Part() { return <button>Flat</button> }')
symlinkSync(resolve(values.modules), join(root, "node_modules"), "dir")
// A local OpenAI-compatible endpoint asks the real take agent to run checks.
// No external model, key, or paid request is used.
/** @type {Array<{ messages: Array<{ role: string, content: unknown }> }>} */
const modelRequests = []
const model = createHttpServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  modelRequests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")))
  const first = modelRequests.length === 1
  response.writeHead(200, { "content-type": "text/event-stream" })
  const delta = first
    ? { role: "assistant", tool_calls: [{ index: 0, id: "check-call", type: "function", function: { name: "render", arguments: '{"checks":true}' } }] }
    : { role: "assistant", content: "Reported the check findings." }
  for (const [change, finish] of [[delta, null], [{}, first ? "tool_calls" : "stop"]]) {
    response.write(`data: ${JSON.stringify({ id: "local-check", object: "chat.completion.chunk", created: 0, model: "checks-model", choices: [{ index: 0, delta: change, finish_reason: finish }] })}\n\n`)
  }
  response.end("data: [DONE]\n\n")
})
model.listen(0, "127.0.0.1")
await once(model, "listening")
const modelAddress = model.address()
assert(modelAddress && typeof modelAddress !== "string")
write(".env.local", "CALIPER_CHECKS_TEST_KEY=local-test-only\n")
const server = await createServer({ root, cacheDir: join(root, ".vite"), configFile: false, logLevel: "silent", plugins: [caliper({ wrap: false, agent: { model: "checks-model", baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`, apiKeyEnv: "CALIPER_CHECKS_TEST_KEY", reasoning: "off" } })], server: { host: "127.0.0.1", port: 0 } })
try {
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  assert(url)
  const request = ["--url", url, "--part", part, "--out", out, "--baselines", baselines, "--check"]
  const all = await run(["--url", url, "--part", "*", "--state", "*", "--device", "*", "--out", out, "--check"])
  /** @type {import('../src/render/check-contract.js').CheckReport} */
  const report = all.report
  assert.equal(report.results.length, 18)
  assert.equal(new Set(report.results.map(result => result.png)).size, 18, "all images retain distinct paths")
  /** @param {string} state @param {string} name */
  const resultStatus = (state, name) => report.results.find(result => result.part === part && result.state === state)?.checks.find(check => check.name === name)?.status
  assert.equal(resultStatus("default", "accessibility"), "Passed")
  assert.equal(resultStatus("MissingName", "accessibility"), "Failed")
  assert.equal(resultStatus("Empty", "render"), "Review")
  assert.equal(resultStatus("Throwing", "render"), "Failed")
  assert.equal(resultStatus("Throwing", "accessibility"), "Inconclusive")
  assert.equal(resultStatus("Throwing", "spill"), "Inconclusive")
  assert.equal(resultStatus("BrowserError", "browser"), "Failed")
  assert.equal(resultStatus("Overflow", "spill"), "Review")
  assert.equal(resultStatus("Unstable", "determinism"), "Inconclusive")
  assert.equal(resultStatus("default", "baseline"), "NotRun")
  console.log("Both-device checks report render failures, console errors, empty states, spill, unnamed buttons, and unstable images without a failing CLI exit.")

  /** @type {Awaited<ReturnType<typeof checkJobs>>} */
  const stable = await run(request)
  assert.equal(stable.report.results[0]?.checks.find(check => check.name === "baseline")?.status, "Review")
  assert.equal((await run(["--approve", stable.reportPath, "--baselines", baselines])).approved, 1)
  /** @type {Awaited<ReturnType<typeof checkJobs>>} */
  const matched = await run(request)
  assert.equal(matched.report.results[0]?.checks.find(check => check.name === "baseline")?.status, "Passed")
  assert.notEqual(stable.reportPath, matched.reportPath)
  assert.equal(readFileSync(stable.reportPath, "utf8"), `${JSON.stringify(stable.report, null, 2)}\n`, "later checks leave reviewed evidence intact")

  const store = createTakeStore(root)
  const take = store.create({ part, state: "default", device: "rg353m" })
  store.write(take, part, source.replace("<button>Ready</button>", '<button style={{ width: 60, height: 30 }} />'))
  /** @type {Awaited<ReturnType<typeof checkJobs>>} */
  const changed = await run([...request, "--take", take])
  assert.equal(changed.report.results[0]?.checks.find(check => check.name === "baseline")?.status, "Review")
  assert.equal(changed.report.results[0]?.checks.find(check => check.name === "accessibility")?.status, "Failed")
  await assert.rejects(run(["--approve", changed.reportPath, "--baselines", baselines]), { code: 2, stdout: /Take images cannot/ })

  const response = await fetch(`${url}__caliper/takes/${take}/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
  assert.equal(response.status, 200, await response.text())
  assert.equal(store.record(take), null, "reports do not gate ordinary Replace")
  assert(readFileSync(join(root, part), "utf8").includes('width: 60'))
  const accepted = await run(["--url", url, "--part", part, "--out", join(out, "accepted")])
  assert.equal(accepted.results[0].frame, "Rendered", "accepted files render without a take overlay")

  // Exercise the production HTTP -> engine -> render tool -> checks path.
  const started = await fetch(`${url}__caliper/takes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ part, state: "default", device: "rg353m", prompt: "Report automatic checks without editing files." }) })
  assert.equal(started.status, 201)
  const startedTake = await started.json()
  const deadline = Date.now() + 30_000
  let idle = false
  while (Date.now() < deadline) {
    const snapshot = await (await fetch(`${url}__caliper/takes.json`)).json()
    const view = snapshot.takes.find((/** @type {import('../src/types').TakeView} */ item) => item.take === startedTake.take)
    if (view && view.run._tag !== "Running") { assert.equal(view.run._tag, "Idle", JSON.stringify(view.run)); idle = true; break }
    await setTimeout(100)
  }
  assert(idle, "agent check completed")
  const toolMessage = modelRequests.flatMap(request => request.messages).find(message => message.role === "tool")
  const toolText = JSON.stringify(toolMessage?.content)
  assert(toolText?.includes("checks") && toolText.includes("Failed") && toolText.includes("accessibility"), "model received production check findings")
  const discarded = await fetch(`${url}__caliper/takes/${startedTake.take}/discard`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
  assert.equal(discarded.status, 200)
  await discarded.text()
  console.log(`Verified baseline approval, repeat matching, take comparison, agent findings, and unchanged Replace. Reports: ${out}`)
} finally {
  if (server.httpServer && "closeAllConnections" in server.httpServer) server.httpServer.closeAllConnections()
  await server.close()
  model.closeAllConnections()
  await new Promise((resolve, reject) => model.close(error => error ? reject(error) : resolve(undefined)))
  rmSync(root, { recursive: true, force: true })
}
