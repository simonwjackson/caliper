#!/usr/bin/env -S nix shell nixpkgs#nodejs --command node
// Public CLI and real SDK Stop gates against a temporary React/Vite consumer.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { EventEmitter, once } from "node:events"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { createServer } from "vite"
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai"
import { caliper } from "../src/plugin.js"
import { createTakeStore } from "../src/takes/store.js"
import { createTakeAgents } from "../src/agent/take-agents.js"
import { checkJobs } from "../src/render/checks.js"
import { renderJobs } from "../src/render/render.js"

const { values } = parseArgs({ options: { modules: { type: "string" } } })
assert(values.modules && process.env.CHROMIUM, "Pass --modules <React consumer node_modules> and set CHROMIUM")
const executablePath = process.env.CHROMIUM
const root = mkdtempSync("/tmp/caliper-authored-agent-cli-")
const cli = fileURLToPath(new URL("../bin/caliper-render.mjs", import.meta.url))
const events = new EventEmitter()
mkdirSync(join(root, "src"))
symlinkSync(resolve(values.modules), join(root, "node_modules"), "dir")
writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", exports: { ".": "./src/index.ts" } }))
writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }))
writeFileSync(join(root, "src/index.ts"), "export {}")
const part = "src/Retry.part.tsx"
const source = `import { useState } from 'react'
export default function Retry() { const [ready, setReady] = useState(false); return <button onClick={() => setReady(true)}>{ready ? 'Loaded' : 'Retry'}</button> }
export function Hang() { return <button>Waiting</button> }
export const checks = {
 default: {
  'retry loads': async ({ canvas, input, expect }) => { await input.click(canvas.getByRole('button', { name: 'Retry' })); expect(canvas.getByRole('button', { name: 'Loaded' })).toBeVisible() },
  'deliberate failure': ({ canvas, expect }) => { expect(canvas.getByRole('button')).toHaveTextContent('Wrong') }
 },
 Hang: { 'hanging callback': async () => { await fetch('/authored-start'); await new Promise(() => {}) } }
}
`
writeFileSync(join(root, part), source)
const server = await createServer({ root, configFile: false, logLevel: "silent", cacheDir: join(root, ".vite"), plugins: [caliper({ wrap: false }), {
  name: "authored-gate-witness",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (request.url !== "/authored-start") return next()
      response.end("started")
      events.emit("started")
    })
  },
}], server: { host: "127.0.0.1", port: 0 } })
/** @type {Set<import('node:child_process').ChildProcess>} */
const children = new Set()

/** @param {string[]} args */
function command(args) {
  const child = spawn(process.execPath, [cli, ...args], { stdio: ["ignore", "pipe", "pipe"] })
  children.add(child)
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", chunk => { stdout += chunk })
  child.stderr.on("data", chunk => { stderr += chunk })
  const done = once(child, "close").then(([code, signal]) => {
    children.delete(child)
    assert(stdout, `No JSON output: code=${code} signal=${signal} ${stderr}`)
    return { code, output: JSON.parse(stdout) }
  })
  return { child, done }
}

try {
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  assert(url)
  const common = ["--url", url, "--part", part, "--device", "rg353m", "--out", join(root, ".caliper/checks"), "--chromium", executablePath]
  const store = createTakeStore(root)
  const take = store.create({ part, state: "default", device: "rg353m" })
  store.write(take, part, source.replace("export const checks = {", "export function Extra() { return <p>Take only</p> }\nexport const checks = { Extra: { 'take only': ({ canvas, expect }) => expect(canvas.getByText('Take only')).toBeVisible() },"))
  const listed = await command(["--url", url, "--take", take, "--list"]).done
  assert.equal(listed.code, 0)
  assert(listed.output.parts[0].states.includes("Extra"))
  assert.equal(listed.output.parts[0].authoredChecks.Extra[0].name, "take only")
  const checked = await command([...common, "--check"]).done
  assert.equal(checked.code, 0, "A written report, including failed checks, keeps exit 0")
  assert.equal(checked.output.report.version, 2)
  assert.deepEqual(checked.output.results[0].authored.checks.map((/** @type {{ status: string }} */ check) => check.status), ["Passed", "Failed"])
  assert.notEqual(checked.output.results[0].authored.checks[0].image, checked.output.results[0].png)

  console.log("PASS: take-only CLI discovery and exit-0 failed authored report with separate interaction evidence")

  const faux = fauxProvider({ models: [{ id: "scripted", input: ["text", "image"] }] })
  const models = createModels()
  models.setProvider(faux.provider)
  let followup = false
  /** @type {string | undefined} */
  let reportPath
  const agents = createTakeAgents({ store, engine: () => ({ models, model: faux.getModel(), reasoning: "off" }), onChange: () => {}, renderFor: take => async request => {
    const input = { url, jobs: [{ part, state: request.state, device: "rg353m", take }], out: join(root, ".caliper/checks/agent"), executablePath, signal: request.signal }
    if (!request.checks) return renderJobs(input)
    const checked = await checkJobs({ ...input, project: "agent-gate" })
    reportPath = checked.reportPath
    return checked.results
  } })
  try {
    for (const action of ["stop", "close"]) {
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("render", { checks: true })], { stopReason: "toolUse" }),
        () => { followup = true; return fauxAssistantMessage([fauxText("Must not continue")]) },
      ])
      reportPath = undefined
      const started = once(events, "started", { signal: AbortSignal.timeout(30_000) })
      const take = agents.start({ part, state: "Hang", device: "rg353m", prompt: "Check the scenario" })
      await started
      const interruptedAt = Date.now()
      if (action === "stop") await agents.stop(take)
      else await agents.close()
      assert(Date.now() - interruptedAt < 10_000, "SDK Stop must await bounded browser cleanup")
      assert(reportPath, "The in-flight check must settle and retain its report before Stop returns")
      assert.equal(JSON.parse(readFileSync(reportPath, "utf8")).run.termination, "Cancelled")
      assert.notEqual(agents.views().find(view => view.take === take)?.run._tag, "Running")
      assert.equal(followup, false)
    }
  } finally { await agents.close() }
  console.log("PASS: real SDK Stop and close await cleanup during started hanging authored checks")

  for (const [signal, code] of /** @type {const} */ ([["SIGINT", 130], ["SIGTERM", 143]])) {
    const started = once(events, "started", { signal: AbortSignal.timeout(30_000) })
    const running = command([...common, "--state", "Hang", "--check"])
    await Promise.race([started, running.done.then(result => {
      throw new Error(`CLI finished before the authored callback started: ${JSON.stringify(result)}`)
    })])
    const interruptedAt = Date.now()
    running.child.kill(signal)
    const result = await running.done
    assert.equal(result.code, code)
    assert.equal(result.output.report.run.termination, "Cancelled")
    assert(result.output.results[0].png, "Keep initial-state evidence on cancellation")
    assert(Date.now() - interruptedAt < 10_000, "CLI must await bounded cleanup, not the full check deadline")
    console.log(`PASS: ${signal} preserves the cancellation report and awaits browser cleanup`)
  }
} finally {
  for (const child of children) child.kill("SIGKILL")
  const http = server.httpServer
  if (http && "closeAllConnections" in http) http.closeAllConnections()
  await server.close()
  rmSync(root, { recursive: true, force: true })
}
