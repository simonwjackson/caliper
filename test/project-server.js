// @ts-check
import { execFileSync, fork } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * @typedef {import("../src/types").CaliperOptions} CaliperOptions
 * @typedef {import("../src/types").Project} Project
 * @typedef {{
 *   root: string,
 *   url: string,
 *   viteUrl: string,
 *   get: (path: string) => Promise<Response>,
 *   project: () => Promise<Project>,
 *   write: (file: string, content: string) => void,
 * }} RunningProject
 */

/**
 * Write a temporary consumer, host real Vite in Node, run the HTTP assertions,
 * and wait for shutdown before removing its files. Per-fixture Node processes
 * give each fixture a Vite/esbuild lifecycle outside the Bun test runner.
 * @param {{ files: Record<string, string>, options?: CaliperOptions & { agent?: import("../src/types").AgentOptions }, git?: boolean, base?: string, modules?: string }} setup
 *   `options.agent` goes to the Caliper app in front of the project, the rest to the plugin.
 * @param {(project: RunningProject) => Promise<void>} test
 */
export async function withProject({ files, options, git = false, base = "/", modules }, test) {
  const root = mkdtempSync(join(tmpdir(), "caliper-test-"))
  /** @param {string} file @param {string} content */
  const write = (file, content) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), content)
  }
  for (const [file, content] of Object.entries(files)) write(file, content)
  if (modules) symlinkSync(modules, join(root, "node_modules"), "dir")
  if (git) execFileSync("git", ["init", "-q"], { cwd: root })
  const child = fork(fileURLToPath(new URL("./project-server-host.mjs", import.meta.url)), [], { execPath: "node", stdio: ["ignore", "ignore", "pipe", "ipc"] })
  let diagnostic = ""
  child.stderr?.on("data", bytes => { diagnostic = (diagnostic + String(bytes)).slice(-4000); process.stderr.write(bytes) })
  const closed = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })))
  /** @type {Promise<{ url: string, viteUrl: string }>} */
  const ready = new Promise((resolve, reject) => {
    child.once("error", reject)
    child.on("message", value => {
      if (!value || typeof value !== "object" || !("type" in value)) return
      if (value.type === "ready" && "url" in value && typeof value.url === "string" && "viteUrl" in value && typeof value.viteUrl === "string") resolve({ url: value.url, viteUrl: value.viteUrl })
      if (value.type === "error" && "message" in value) reject(new Error(String(value.message)))
    })
    child.once("close", (code, signal) => reject(new Error(`Vite fixture closed before its address: ${code ?? signal}. ${diagnostic}`)))
  })
  let failed = false
  try {
    child.send({ type: "start", root, base, options, files: Object.keys(files) })
    // `url` is the project's base in the Caliper app (decision 37); `viteUrl` is the dev server itself.
    const { url, viteUrl } = await ready
    /** @param {string} path */
    const get = path => fetch(new URL(path.replace(/^\//, ""), url))
    await test({ root, url, viteUrl, get, project: async () => (await get("/__caliper/project.json")).json(), write })
  } catch (error) {
    failed = true
    throw error
  } finally {
    if (child.connected) child.send({ type: "close" })
    const result = /** @type {{code:number|null,signal:NodeJS.Signals|null}} */ (await closed)
    rmSync(root, { recursive: true, force: true })
    if (!failed && result.code !== 0) throw new Error(`Vite fixture did not close cleanly: ${result.code ?? result.signal}. ${diagnostic}`)
  }
}

/** A package.json whose `exports["."]` is `entry`. */
export function manifest(entry = "./src/index.ts", name = "fixture-app") {
  return JSON.stringify({ name, type: "module", exports: { ".": entry } }, null, 2)
}
