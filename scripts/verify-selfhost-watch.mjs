#!/usr/bin/env -S nix develop -c node
// Verify the checkout's actual Vite watcher without traversing a real Nix tree.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createServer } from "vite"
import config from "../vite.config.js"

const root = mkdtempSync("/tmp/caliper-subject-watch-")
const external = mkdtempSync("/tmp/caliper-watch-input-")
/** @type {import('vite').ViteDevServer | undefined} */
let server
try {
  writeFileSync(join(external, "input.js"), "export const input = true")
  mkdirSync(join(root, "src"))
  writeFileSync(join(root, "src/A.part.tsx"), "export default () => null")
  for (const directory of [".direnv", ".worktree", ".worktrees"]) {
    mkdirSync(join(root, directory))
    symlinkSync(external, join(root, directory, "input"), "dir")
  }
  symlinkSync(external, join(root, "shared"), "dir")
  let ready = () => {}
  const watching = new Promise(resolve => { ready = () => resolve(undefined) })
  server = await createServer({
    ...config,
    root,
    configFile: false,
    plugins: [...(config.plugins ?? []), { name: "observe-subject-watcher", configureServer(server) { server.watcher.once("ready", ready) } }],
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  await watching
  const deadline = Date.now() + 5000
  while (!Object.keys(server.watcher.getWatched()).includes(join(root, "src")) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  const watched = Object.keys(server.watcher.getWatched())
  assert(watched.includes(join(root, "src")), "Product source must be watched.")
  assert(watched.includes(join(root, "shared")), "Linked product source must be watched.")
  for (const directory of [".direnv", ".worktree", ".worktrees"]) {
    assert(!watched.some(path => path === join(root, directory) || path.startsWith(join(root, directory) + "/")), `${directory} must not be traversed by the self-hosting watcher.`)
  }
  console.log("PASS: self-hosting watches product links, not direnv caches or worktrees.")
} finally {
  await server?.close()
  rmSync(root, { recursive: true, force: true })
  rmSync(external, { recursive: true, force: true })
}
