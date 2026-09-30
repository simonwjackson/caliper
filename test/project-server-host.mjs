#!/usr/bin/env -S nix develop -c node
// The test runner owns files and assertions; real Node owns Vite and its services.
import { createServer } from "vite"
import { caliper } from "../src/plugin.js"
import { basename, dirname, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { createServer as createPortReservation } from "node:net"

if (process.versions.bun) throw new Error("Vite fixture hosting requires real Node.")
/** @type {import('vite').ViteDevServer | undefined} */
let server
let closing = false
/** @param {number} [code] */
async function close(code = 0) {
  if (closing) return
  closing = true
  try {
    if (server?.httpServer && "closeAllConnections" in server.httpServer) server.httpServer.closeAllConnections()
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
    const options = "options" in value ? /** @type {import('../src/types').CaliperOptions | undefined} */ (value.options) : undefined
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
    const url = server.resolvedUrls?.local[0]
    if (!url) throw new Error("Vite did not publish a local address.")
    process.send?.({ type: "ready", url })
  } catch (error) {
    process.send?.({ type: "error", message: error instanceof Error ? error.message : String(error) })
    await close(1)
  }
})
