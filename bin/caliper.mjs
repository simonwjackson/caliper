#!/usr/bin/env node
// @ts-check
// The Caliper app (decision 37): the chrome for every running project, on one
// port. It reads the registry the plugin writes; it never starts a project.
import { parseArgs } from "node:util"
import { startCentral } from "../src/central/server.js"
import { settingsFile } from "../src/central/config.js"
import { registryDir } from "../src/central/registry.js"

const { values } = parseArgs({
  options: {
    port: { type: "string", default: process.env.CALIPER_PORT ?? "3132" },
    host: { type: "string", default: process.env.CALIPER_HOST ?? "127.0.0.1" },
    help: { type: "boolean", short: "h" },
  },
})
if (values.help) {
  console.log(`Usage: caliper [--port 3132] [--host 127.0.0.1]

Serves Caliper's chrome for every dev server that runs the caliper() plugin.
Settings: ${settingsFile()}
Registry: ${registryDir()}`)
  process.exit(0)
}
const app = await startCentral({ port: Number(values.port), host: values.host })
console.log(`Caliper: ${app.url}__caliper/`)
console.log(`  settings ${settingsFile()}`)
console.log(`  registry ${registryDir()}`)
const stop = async () => { await app.close(); process.exit(0) }
process.once("SIGTERM", stop)
process.once("SIGINT", stop)
