#!/usr/bin/env -S nix develop -c node
// @ts-check
// Start the pinned recovery tool's Caliper app (decisions 36 and 37). It serves
// the chrome for this checkout's self-hosting dev server from the tool's own
// copy, so an accepted take cannot break the app used to undo it.
// Arguments pass through, for example --port 3133.
import { spawn } from "node:child_process"
import { join } from "node:path"
import { verifiedToolDirectory } from "../src/build/tool.js"

const tool = verifiedToolDirectory()
const args = process.argv.slice(2)
const child = spawn(process.execPath, [join(tool, "bin/caliper.mjs"), ...(args.length ? args : ["--port", "3133"])], { stdio: "inherit" })
for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"])) process.on(signal, () => child.kill(signal))
child.on("exit", code => process.exit(code ?? 0))
