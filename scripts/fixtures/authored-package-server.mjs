#!/usr/bin/env -S nix shell nixpkgs#nodejs --command node
// Copied into the temporary consumer: these imports must resolve there.
import { appendFileSync } from "node:fs"
import { createRequire } from "node:module"
import { createServer } from "vite"
import { caliper } from "@simonwjackson/caliper"

const require = createRequire(import.meta.url)
const requests = process.env.CALIPER_PACKAGE_REQUESTS
if (!requests) throw new Error("CALIPER_PACKAGE_REQUESTS is required")
const server = await createServer({
  root: process.cwd(), configFile: false, logLevel: "error",
  plugins: [
    {
      name: "package-gate-request-log",
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          appendFileSync(requests, JSON.stringify({ url: request.url }) + "\n")
          next()
        })
      },
    },
    caliper({ wrap: false }),
  ],
  server: { host: "127.0.0.1", port: 0 },
})

let closing = false
async function close() {
  if (closing) return
  closing = true
  if (server.httpServer && "closeAllConnections" in server.httpServer) server.httpServer.closeAllConnections()
  await server.close()
  process.exit(0)
}
process.on("SIGTERM", close)
process.on("SIGINT", close)
await server.listen()
console.log("CALIPER_PACKAGE_READY " + JSON.stringify({
  url: server.resolvedUrls?.local[0],
  plugin: require.resolve("@simonwjackson/caliper"),
  vite: require("vite/package.json").version,
  react: require("react/package.json").version,
  reactDom: require("react-dom/package.json").version,
}))
