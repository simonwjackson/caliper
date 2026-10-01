#!/usr/bin/env -S nix develop -c node
// The test runner owns files and assertions; real Node owns Vite and its services.
import { createServer } from "vite"
import { caliper } from "../src/plugin.js"
import { basename, dirname, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { createServer as createPortReservation } from "node:net"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { startCentral } from "../src/central/server.js"
import { projectId } from "../src/central/registry.js"

if (process.versions.bun) throw new Error("Vite fixture hosting requires real Node.")
/** @type {import('vite').ViteDevServer | undefined} */
let server
/** @type {Awaited<ReturnType<typeof startCentral>> | undefined} */
let app
// Each fixture host has its own registry, so fixtures never see this machine's servers.
process.env.CALIPER_REGISTRY = mkdtempSync(join(tmpdir(), "caliper-test-registry-"))
let closing = false
/** @param {number} [code] */
async function close(code = 0) {
  if (closing) return
  closing = true
  try {
    if (server?.httpServer && "closeAllConnections" in server.httpServer) server.httpServer.closeAllConnections()
    await app?.close()
    await server?.close()
  } finally {
    if (process.connected) process.disconnect()
    process.exit(code)
  }
}
process.on("disconnect", () => void close())
process.once("SIGTERM", () => void close())
process.on("message", async value => {
  try {
    if (!value || typeof value !== "object" || !("type" in value)) throw new Error("Invalid fixture request.")
    if (value.type === "close") { await close(); return }
    if (value.type !== "start" || server || !("root" in value) || typeof value.root !== "string" || !("base" in value) || typeof value.base !== "string") throw new Error("Invalid fixture start.")
    const root = value.root
    const given = "options" in value ? /** @type {(import('../src/types').CaliperOptions & { agent?: import('../src/types').AgentOptions }) | undefined} */ (value.options) : undefined
    // The Caliper app owns the agent (decision 37); the plugin takes the rest.
    const { agent, ...options } = given ?? {}
    // Vite interprets port 0 as its default, which reuses the previous fixture's
    // origin and Bun's keep-alive pool. Give each host an OS-assigned port.
    const reservation = createPortReservation()
    await new Promise((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", () => resolve(undefined)) })
    const address = reservation.address()
    if (!address || typeof address === "string") throw new Error("No fixture port was assigned.")
    const port = address.port
    await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve(undefined)))
    server = await createServer({ root, base: value.base, cacheDir: join(root, ".vite"), configFile: false, logLevel: "silent", plugins: [caliper(options)], server: { host: "127.0.0.1", port } })
    await server.listen()
    if (!("files" in value) || !Array.isArray(value.files) || !value.files.every(file => typeof file === "string")) throw new Error("Invalid fixture files.")
    const files = value.files.filter(file => !/^(node_modules|\.git|\.vite|dist)(\/|$)/.test(file))
    // Chokidar can emit ready for a missing path added by a plugin before its
    // initial root traversal finishes. Wait for the files the test will edit.
    const deadline = Date.now() + 3000
    while (true) {
      const watched = server.watcher.getWatched()
      if (files.every(file => watched[dirname(join(root, file))]?.includes(basename(file)))) break
      if (Date.now() >= deadline) throw new Error("Vite did not watch the fixture files before startup.")
      await sleep(10)
    }
    const viteUrl = server.resolvedUrls?.local[0]
    if (!viteUrl) throw new Error("Vite did not publish a local address.")
    const state = mkdtempSync(join(tmpdir(), "caliper-test-app-"))
    app = await startCentral({ port: 0, registry: process.env.CALIPER_REGISTRY, stateDir: state, settings: join(state, "none.json"), agent })
    const id = projectId(root)
    let url = await app.projectUrl(id)
    for (const end = Date.now() + 5000; url === null && Date.now() < end; url = await app.projectUrl(id)) await sleep(10)
    if (url === null) throw new Error("The dev server did not register with the Caliper app.")
    process.send?.({ type: "ready", url, viteUrl })
  } catch (error) {
    process.send?.({ type: "error", message: error instanceof Error ? error.message : String(error) })
    await close(1)
  }
})
