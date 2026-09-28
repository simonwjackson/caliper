// @ts-check
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { fork, execFileSync } from "node:child_process"
import { once } from "node:events"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { createServer } from "vite"
import { caliper } from "../src/plugin.js"
import { checkJobs } from "../src/render/checks.js"

const browserTest = test.skipIf(!process.env.CHROMIUM || !process.env.CALIPER_TEST_MODULES)
browserTest("named browser checks pass on real state behavior and report an assertion failure separately from baseline renders", async () => {
  const root = mkdtempSync("/tmp/caliper-authored-test-")
  mkdirSync(join(root, "src"))
  symlinkSync(/** @type {string} */ (process.env.CALIPER_TEST_MODULES), join(root, "node_modules"), "dir")
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", exports: { ".": "./src/index.ts" } }))
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }))
  writeFileSync(join(root, "src/index.ts"), "export {}")
  writeFileSync(join(root, "src/Retry.part.tsx"), `import {useState} from 'react'
export default function Retry() { const [ready,setReady]=useState(false); return <button onClick={()=>setReady(true)}>{ready?'Loaded':'Retry'}</button> }
export function Waiting() { return <button>Waiting</button> }
export const checks = { Waiting: { 'started hanging callback': async () => { await fetch('/test-hang-started'); await new Promise(() => {}) } }, default: {
  'retry loads': async ({canvas,input,expect,waitFor}) => { await input.click(canvas.getByRole('button',{name:'Retry'})); await waitFor(()=>expect(canvas.getByRole('button',{name:'Loaded'})).toBeVisible()) },
  'deliberate failure': ({canvas,expect}) => { expect(canvas.getByRole('button',{name:'Retry'})).toHaveTextContent('Wrong') },
  'assertion mentions page closed': () => { throw new Error('Expected page closed notification') },
  'still executes next check': ({canvas,expect}) => { expect(canvas.getByRole('button',{name:'Retry'})).toBeVisible() }
} }
`)
  const cancellation = new AbortController()
  let started = false
  /** @type {(() => void)|undefined} */
  let disconnectWorker
  const server = await createServer({ root, configFile: false, logLevel: "silent", cacheDir: join(root, ".vite"), plugins: [caliper({ wrap: false }), {
    name: "check-cancellation-witness",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url !== "/test-hang-started") return next()
        response.end("started")
        started = true
        disconnectWorker?.()
        cancellation.abort(new DOMException("Public caller cancelled", "AbortError"))
      })
    },
  }], server: { host: "127.0.0.1", port: 0 } })
  try {
    await server.listen()
    const url = /** @type {string} */ (server.resolvedUrls?.local[0])
    const result = await checkJobs({ url, project: "test", jobs: [{ part: "src/Retry.part.tsx", state: "default", device: "rg353m" }], out: join(root, ".caliper/checks"), executablePath: /** @type {string} */ (process.env.CHROMIUM) })
    expect(result.report.version).toBe(2)
    expect(result.results[0]?.authored?.checks.map(item => [item.name, item.status])).toEqual([["retry loads", "Passed"], ["deliberate failure", "Failed"], ["assertion mentions page closed", "Failed"], ["still executes next check", "Passed"]])
    expect(result.results[0]?.authored?.checks[1]?.detail).toContain("Wrong")
    expect(result.results[0]?.checkRun?.termination).toBe("Completed")
    expect(result.report.results[0]?.checks.find(item => item.name === "determinism")?.status).toBe("Passed")
    const alias = `${root}-outside-alias`
    mkdirSync(join(root, "screenshots"))
    symlinkSync(join(root, "screenshots"), alias, "dir")
    try {
      await expect(checkJobs({ url, project: "test", jobs: [{ part: "src/Retry.part.tsx", state: "default", device: "rg353m" }], out: alias, executablePath: /** @type {string} */ (process.env.CHROMIUM) })).rejects.toThrow("must be under .caliper/checks")
    } finally { rmSync(alias) }
    const stopped = await checkJobs({ url, project: "test", jobs: [{ part: "src/Retry.part.tsx", state: "Waiting", device: "rg353m" }], out: join(root, ".caliper/checks"), executablePath: /** @type {string} */ (process.env.CHROMIUM), signal: cancellation.signal })
    expect(started).toBe(true)
    expect(stopped.results[0]?.checkRun?.termination).toBe("Cancelled")
    expect(stopped.results[0]?.authored?.checks[0]?.status).toBe("Inconclusive")
    const child = fork(fileURLToPath(new URL("../src/render/worker.js", import.meta.url)), [], { execPath: "node", stdio: ["ignore", "ignore", "ignore", "ipc"] })
    const exit = once(child, "exit", { signal: AbortSignal.timeout(30000) })
    /** @type {number[]} */
    const browsers = []
    disconnectWorker = () => {
      for (const line of execFileSync("ps", ["-eo", "pid,ppid,args"], { encoding: "utf8" }).split("\n")) {
        const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
        if (match && Number(match[2]) === child.pid && match[3].includes("--remote-debugging-pipe")) browsers.push(Number(match[1]))
      }
      child.disconnect()
    }
    try {
      child.send({ type: "checks", input: { url, project: "test", jobs: [{ part: "src/Retry.part.tsx", state: "Waiting", device: "rg353m" }], out: join(root, ".caliper/checks/disconnected"), executablePath: process.env.CHROMIUM } })
      const [code] = await exit
      expect(code).toBe(0)
      expect(browsers.length).toBeGreaterThan(0)
      for (const pid of browsers) expect(() => process.kill(pid, 0)).toThrow()
    } finally { disconnectWorker = undefined; if (child.exitCode === null) child.kill("SIGKILL") }
  } finally {
    if (server.httpServer && "closeAllConnections" in server.httpServer) server.httpServer.closeAllConnections()
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
}, 60000)
