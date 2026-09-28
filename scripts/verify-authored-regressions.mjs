#!/usr/bin/env -S nix shell nixpkgs#nodejs --command node
// Run the affected real-browser contracts serially to avoid port/cache contention.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseArgs } from "node:util"

const { values } = parseArgs({ options: { modules: { type: "string" }, out: { type: "string", default: "/tmp/caliper-authored-regressions" } } })
assert(values.modules && process.env.CHROMIUM, "Pass --modules and set CHROMIUM")
const out = resolve(values.out)
mkdirSync(out, { recursive: true })
for (const name of ["frame-commit", "scenarios", "checks", "checks-ui", "expectations", "integration", "fast-saves"]) {
  /** @type {string[]} */
  const args = [`scripts/verify-${name}.mjs`, ...(name === "fast-saves" ? [] : ["--modules", values.modules])]
  /** @type {import('node:child_process').SpawnSyncReturns<string>} */
  const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 240000, maxBuffer: 16000000 })
  writeFileSync(`${out}/${name}.log`, `${result.stdout}\n${result.stderr}`)
  console.log(`${name}: ${result.status === 0 ? "PASS" : "FAIL"}`)
  assert.equal(result.status, 0, `${name}: ${result.error || result.stderr || result.stdout}`)
}
console.log(`Verified existing frame, scenario, report, UI, expectations, alternate and HMR contracts. Logs: ${out}`)
