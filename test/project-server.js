// @ts-check
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createServer } from "vite"
import { caliper } from "../src/plugin.js"

/**
 * @typedef {import("../src/types").CaliperOptions} CaliperOptions
 * @typedef {import("../src/types").Project} Project
 * @typedef {{
 *   root: string,
 *   url: string,
 *   get: (path: string) => Promise<Response>,
 *   project: () => Promise<Project>,
 *   write: (file: string, content: string) => void,
 * }} RunningProject
 */

/**
 * Write a project to a temporary folder, start a real Vite dev server on it
 * with `caliper(options)`, run `test`, and clean up.
 *
 * @param {{ files: Record<string, string>, options?: CaliperOptions, git?: boolean }} setup
 *   `git` makes the folder a Git checkout, so `.gitignore` applies
 * @param {(project: RunningProject) => Promise<void>} test
 */
export async function withProject({ files, options, git = false }, test) {
  const root = mkdtempSync(join(tmpdir(), "caliper-test-"))
  /** @param {string} file @param {string} content */
  const write = (file, content) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), content)
  }
  for (const [file, content] of Object.entries(files)) write(file, content)
  if (git) execFileSync("git", ["init", "-q"], { cwd: root })

  const server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [caliper(options)],
    server: { port: 0, host: "127.0.0.1" },
  })
  await server.listen()
  const url = server.resolvedUrls?.local[0] ?? ""
  try {
    /** @param {string} path */
    const get = path => fetch(new URL(path.replace(/^\//, ""), url))
    await test({
      root,
      url,
      get,
      project: async () => (await get("/__caliper/project.json")).json(),
      write,
    })
  } finally {
    // A failing browser assertion can leave SSE open. Close it before waiting
    // for the server so the assertion is reported instead of a test timeout.
    if (server.httpServer && "closeAllConnections" in server.httpServer) server.httpServer.closeAllConnections()
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
}

/** A package.json whose `exports["."]` is `entry`. */
export function manifest(entry = "./src/index.ts", name = "fixture-app") {
  return JSON.stringify({ name, type: "module", exports: { ".": entry } }, null, 2)
}
