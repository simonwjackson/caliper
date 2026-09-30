#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 --command node
// @ts-check
// Spike only. Start one project's Vite server on a port Vite picks, with Caliper
// and the spike plugin. The central app learns the port from the registry.
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { createServer } from "vite"
import { caliper } from "../../src/plugin.js"
import { centralSpike } from "./project-plugin.mjs"

const { values } = parseArgs({ options: { root: { type: "string" }, registry: { type: "string" } } })
if (!values.root || !values.registry) throw new Error("Pass --root and --registry.")
const root = resolve(values.root)
const server = await createServer({
  root, configFile: false, cacheDir: join(root, ".vite-spike"), logLevel: "warn",
  esbuild: { jsx: "automatic" },
  plugins: [caliper(), centralSpike({ registry: resolve(values.registry) })],
  server: { host: "127.0.0.1", port: 0, strictPort: false },
})
await server.listen()
console.log(`ready ${server.resolvedUrls?.local[0]}`)
const stop = async () => { await server.close(); process.exit(0) }
process.once("SIGTERM", stop)
process.once("SIGINT", stop)
