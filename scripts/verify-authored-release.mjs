#!/usr/bin/env -S nix shell nixpkgs#nodejs --command node
// Final public integration gates run serially, with durable logs per path.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseArgs } from "node:util"
const { values } = parseArgs({ options: { modules: { type: "string" }, out: { type: "string", default: "/tmp/caliper-authored-release" } } })
assert(values.modules && process.env.CHROMIUM, "Pass --modules and set CHROMIUM")
const out = resolve(values.out)
mkdirSync(out, { recursive: true })
for (const name of ["checks", "agent-cli", "ui", "package"]) {
  /** @type {string[]} */
  const args = [`scripts/verify-authored-${name}.mjs`, ...(name === "package" ? [] : ["--modules", values.modules])]
  /** @type {import('node:child_process').SpawnSyncReturns<string>} */
  const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 300000, maxBuffer: 16000000 })
  writeFileSync(`${out}/${name}.log`, `${result.stdout}\n${result.stderr}`)
  console.log(`${name}: ${result.status === 0 ? "PASS" : "FAIL"}`)
  assert.equal(result.status, 0, `${name}: ${result.error || result.stderr || result.stdout}`)
}
console.log(`All authored-check release gates passed. Logs: ${out}`)
