#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 --command node
// @ts-check
// Spike only. Start the stack and keep it running, for a manual check from another device.
import { parseArgs } from "node:util"
import { startStack } from "./stack.mjs"

const { values } = parseArgs({ options: { port: { type: "string", default: "3140" }, work: { type: "string" } } })
const stack = await startStack({ port: Number(values.port), work: values.work })
const { pico, react18 } = stack.ids
console.log(JSON.stringify({
  central: stack.central.url, work: stack.work,
  both: `/__caliper/?frames=${pico}~src/ui/atoms/PicoButton.atom.part.tsx~default|${react18}~src/Counter.part.tsx~default`,
}, null, 2))
const stop = async () => { await stack.stop(); process.exit(0) }
process.once("SIGTERM", stop)
process.once("SIGINT", stop)
