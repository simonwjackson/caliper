#!/usr/bin/env -S nix develop -c node
// Print the pin constants for src/build/tool.js for one revision.
//   scripts/tool-pin-hashes.mjs <revision>
// The source hash walks the extracted archive as verifiedToolDirectory does:
// it skips node_modules, tool-pin.json and dist at the root.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const revision = execFileSync("git", ["rev-parse", process.argv[2] ?? "HEAD"], { encoding: "utf8" }).trim()
/** @param {string | Buffer} value */
const sha256 = value => createHash("sha256").update(value).digest("hex")
const archive = execFileSync("git", ["archive", revision], { maxBuffer: 64 * 1024 * 1024 })
const stage = mkdtempSync(join(tmpdir(), "tool-pin-"))
try {
  execFileSync("tar", ["-x", "-C", stage], { input: archive })
  /** @type {string[]} */
  const files = []
  /** @param {string} path */
  const walk = path => {
    for (const entry of readdirSync(join(stage, path), { withFileTypes: true })) {
      if (!path && ["node_modules", "tool-pin.json", "dist"].includes(entry.name)) continue
      const file = path ? `${path}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(file)
      else files.push(file)
    }
  }
  walk("")
  const sources = Object.fromEntries(files.sort().map(file => [file, sha256(readFileSync(join(stage, file)))]))
  console.log(JSON.stringify({ revision, archive: sha256(archive), sources: sha256(JSON.stringify(sources)), lock: sha256(readFileSync(join(stage, "bun.lock"))) }, null, 2))
} finally { rmSync(stage, { recursive: true, force: true }) }
