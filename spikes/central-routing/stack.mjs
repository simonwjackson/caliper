// @ts-check
// Spike only. Build two disposable projects, start the central app and one Vite
// server for each project, and stop them again.
import { execFileSync, spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { readRegistry, startCentral } from "./central.mjs"
import { projectId } from "./project-plugin.mjs"

const here = dirname(fileURLToPath(import.meta.url))
export const PICO = join(homedir(), "code/sandbox/korri/surfaces/pico")

/** @param {string} path @param {string} text */
export const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }

export const counterSource = (/** @type {string} */ heading) => `import { useEffect, useState } from "react"
export default function Counter() {
  const [count, setCount] = useState(0)
  const [worker, setWorker] = useState("waiting")
  const [lazy, setLazy] = useState("not loaded")
  useEffect(() => {
    const echo = new Worker(new URL("./echo.worker.ts", import.meta.url), { type: "module" })
    echo.onmessage = event => setWorker(String(event.data))
    echo.onerror = event => setWorker("worker error " + (event.message || ""))
    Object.assign(window, { __echo: echo })
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

/** @param {string} work */
export function makeProjects(work) {
  const skip = (/** @type {string} */ path) => !/\/(node_modules|\.caliper|\.git|\.vite[^/]*)(\/|$)/.test(path)
  const pico = join(work, "pico")
  cpSync(PICO, pico, { recursive: true, filter: skip })
  symlinkSync(join(PICO, "node_modules"), join(pico, "node_modules"), "dir")

  const older = join(work, "react18")
  write(join(older, "package.json"), JSON.stringify({ name: "react18", private: true, type: "module", exports: { ".": "./src/index.ts" }, dependencies: { react: "18.3.1", "react-dom": "18.3.1" } }, null, 2))
  write(join(older, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react-jsx", module: "esnext", target: "es2022" } }))
  write(join(older, "src/index.ts"), "export {}\n")
  write(join(older, "src/Counter.part.tsx"), counterSource("Routing source"))
  write(join(older, "src/echo.worker.ts"), `import { shout } from "./shout"\nself.onmessage = event => event.data === "import" ? import(/* @vite-ignore */ "/src/lazy.ts?worker-after-stop=" + Date.now()).then(module => self.postMessage(module.lazyText + " in worker")) : self.postMessage(shout(String(event.data)))\n`)
  write(join(older, "src/shout.ts"), `export const shout = (text: string) => "worker says " + text.toUpperCase()\n`)
  write(join(older, "src/lazy.ts"), `export const lazyText = "lazy loaded"\n`)
  execFileSync("bun", ["install", "--linker", "isolated"], { cwd: older, stdio: "pipe" })
  return { pico, react18: older }
}

/**
 * @param {{ root: string, registry: string, log: string }} input
 * @returns {import("node:child_process").ChildProcess}
 */
export function startProject({ root, registry, log }) {
  const child = spawn(process.execPath, [join(here, "project-server.mjs"), "--root", root, "--registry", registry], { stdio: ["ignore", "pipe", "pipe"] })
  const lines = (/** @type {Buffer} */ chunk) => { try { writeFileSync(log, chunk, { flag: "a" }) } catch { /* the work dir is gone */ } }
  child.stdout?.on("data", lines)
  child.stderr?.on("data", lines)
  return child
}

/** @param {string} registry @param {string} id @param {number} [timeout] */
export async function waitForProject(registry, id, timeout = 60_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const entry = readRegistry(registry).find(candidate => candidate.id === id)
    if (entry) return entry
    await new Promise(done => setTimeout(done, 200))
  }
  throw new Error(`Project ${id} did not register within ${timeout} ms.`)
}

/** @param {{ port: number, work?: string }} options */
export async function startStack({ port, work = mkdtempSync(join(tmpdir(), "caliper-central-spike-")) }) {
  const registry = join(work, "registry")
  const roots = existsSync(join(work, "pico")) ? { pico: join(work, "pico"), react18: join(work, "react18") } : makeProjects(work)
  const central = await startCentral({ port, registry })
  /** @type {Map<string, import("node:child_process").ChildProcess>} */
  const children = new Map()
  const ids = { pico: projectId(roots.pico), react18: projectId(roots.react18) }
  for (const [name, root] of Object.entries(roots)) children.set(name, startProject({ root, registry, log: join(work, `${name}.log`) }))
  await Promise.all(Object.values(ids).map(id => waitForProject(registry, id)))
  const stop = async () => {
    for (const child of children.values()) child.kill("SIGTERM")
    await central.close()
  }
  return { work, registry, roots, ids, central, children, stop }
}
