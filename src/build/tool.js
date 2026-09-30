// @ts-check
// Explicit recovery-tool installation, never a link back to the subject.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const TOOL_REVISION = "5578e65fe8dc34ad4d858a22f92ccc53c3d8c7c0"
const ARCHIVE_SHA256 = "a431d550f933c44d411f5520a68abed3ab29bcb7eb6d1f67197c7e9dfa6faddb"
const SOURCES_SHA256 = "086e0e09eab511d97d6f63603bc5d37197a0a4dee5e39cfba31ec79fccb67ee4"
const LOCK_SHA256 = "64e1c93b4671a9bc7d49673b3f411e5b24a6aca816db34db848dd145490a533e"
export const toolDirectory = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "caliper/tools", TOOL_REVISION)
const subject = fileURLToPath(new URL("../../", import.meta.url))
/** @param {string | Buffer} value */
const sha256 = value => createHash("sha256").update(value).digest("hex")
/** @param {string} root */
function sourceHashes(root) {
  /** @type {string[]} */
  const files = []
  /** @param {string} path */
  function walk(path) {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
      if (!path && ["node_modules", "tool-pin.json", "dist"].includes(entry.name)) continue
      const file = path ? `${path}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(file)
      else files.push(file)
    }
  }
  walk("")
  return Object.fromEntries(files.sort().map(file => [file, sha256(readFileSync(join(root, file)))]))
}

/** Refuse an absent or edited tool. Recovery is an explicit reinstall. */
export function verifiedToolDirectory() {
  const recovery = "Run nix develop -c bun run tool:install -- --repair to restore the pinned recovery tool."
  try {
    const pin = JSON.parse(readFileSync(join(toolDirectory, "tool-pin.json"), "utf8"))
    assert.equal(pin.revision, TOOL_REVISION)
    assert.equal(pin.archiveSha256, ARCHIVE_SHA256)
    assert.equal(pin.lockSha256, LOCK_SHA256)
    assert.equal(sha256(readFileSync(join(toolDirectory, "bun.lock"))), LOCK_SHA256)
    assert.equal(sha256(JSON.stringify(sourceHashes(toolDirectory))), SOURCES_SHA256)
    assert(existsSync(join(toolDirectory, "node_modules/vite/package.json")))
    assert(existsSync(join(toolDirectory, "dist/chrome/.vite/manifest.json")))
    return toolDirectory
  } catch (error) {
    throw new Error(`Caliper's pinned tool is missing or changed. ${recovery}`, { cause: error })
  }
}

/** Install or explicitly restore the pinned revision, its frozen dependency lock and its chrome bundle. */
export function installChromeTool() {
  if (existsSync(toolDirectory) && !process.argv.includes("--repair")) {
    console.log(verifiedToolDirectory())
    return
  }
  mkdirSync(dirname(toolDirectory), { recursive: true })
  const stage = mkdtempSync(join(dirname(toolDirectory), ".install-"))
  try {
    const archive = execFileSync("git", ["archive", TOOL_REVISION], { cwd: subject, maxBuffer: 32 * 1024 * 1024 })
    assert.equal(sha256(archive), ARCHIVE_SHA256, "The archive must match the explicit pin")
    execFileSync("tar", ["-x", "-C", stage], { input: archive })
    assert.equal(sha256(readFileSync(join(stage, "bun.lock"))), LOCK_SHA256)
    assert.equal(sha256(JSON.stringify(sourceHashes(stage))), SOURCES_SHA256)
    execFileSync("bun", ["install", "--frozen-lockfile", "--ignore-scripts"], { cwd: stage, stdio: "inherit" })
    // The pinned chrome is a React bundle; build it from the pinned sources. dist is outside the source hash.
    execFileSync(process.execPath, ["scripts/build-chrome.mjs"], { cwd: stage, stdio: "inherit" })
    writeFileSync(join(stage, "tool-pin.json"), JSON.stringify({ revision: TOOL_REVISION, archiveSha256: ARCHIVE_SHA256, lockSha256: LOCK_SHA256 }, null, 2))
    if (existsSync(toolDirectory)) rmSync(toolDirectory, { recursive: true, force: true })
    renameSync(stage, toolDirectory)
    console.log(verifiedToolDirectory())
  } finally { rmSync(stage, { recursive: true, force: true }) }
}
