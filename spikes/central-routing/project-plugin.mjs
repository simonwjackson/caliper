// @ts-check
// Spike only. The part of the future headless plugin that the central app needs:
// a stable project id, an HMR socket path that carries the id, and a registry file.
import { createHash } from "node:crypto"
import { mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"

/** @param {string} root */
export const projectId = root => createHash("sha256").update(realpathSync(root)).digest("hex").slice(0, 12)

/**
 * @param {{ registry: string }} options the registry directory
 * @returns {import("vite").Plugin}
 */
export function centralSpike({ registry }) {
  /** @type {string} */
  let id = ""
  /** @type {string} */
  let root = ""
  return {
    name: "caliper-central-spike",
    apply: "serve",
    config(config) {
      root = config.root ?? process.cwd()
      id = projectId(root)
      // hmrBase = join(base, path), so the socket URL becomes /__caliper/hmr/<id>.
      return { server: { hmr: { path: `__caliper/hmr/${id}` } } }
    },
    configureServer(server) {
      const file = join(registry, `${process.pid}.json`)
      const remove = () => rmSync(file, { force: true })
      server.httpServer?.once("listening", () => {
        const address = server.httpServer?.address()
        if (address === null || typeof address !== "object") return
        mkdirSync(registry, { recursive: true, mode: 0o700 })
        const entry = { protocol: 0, pid: process.pid, id, root, name: basename(root), url: `http://127.0.0.1:${address.port}/`, started: new Date().toISOString() }
        writeFileSync(`${file}.tmp`, JSON.stringify(entry, null, 2), { mode: 0o600 })
        renameSync(`${file}.tmp`, file)
      })
      server.httpServer?.once("close", remove)
      process.once("exit", remove)
    },
  }
}
