// @ts-check
import { existsSync, readFileSync } from "node:fs"
import { join, posix } from "node:path"

/**
 * @typedef {import("../types").Entry} Entry
 * @typedef {import("../types").Derivation<Entry>} EntryDerivation
 */

const ENTRY_HINT = 'Set caliper({ entry: "src/main.tsx" }) in vite.config to name the module the app starts from.'

/**
 * Find the module the app starts from. Caliper tries, in order:
 *
 * 1. the first `<script type="module" src>` in `index.html`,
 * 2. `package.json` `exports["."]`,
 * 3. `package.json` `main`.
 *
 * @param {string} root absolute Vite root
 * @param {string | undefined} override the `entry` option
 * @returns {EntryDerivation}
 */
export function deriveEntry(root, override) {
  if (override !== undefined) {
    const file = normalize(override)
    if (!existsSync(join(root, file))) {
      return failed(`caliper({ entry: "${override}" }) names a file that does not exist.`)
    }
    return { _tag: "Overridden", value: { file }, option: "entry" }
  }
  return fromIndexHtml(root) ?? fromPackageJson(root) ?? failed(
    "Caliper found no index.html module script, no package.json exports[\".\"] and no package.json main.",
  )
}

/**
 * @param {string} root
 * @returns {EntryDerivation | null}
 */
function fromIndexHtml(root) {
  const path = join(root, "index.html")
  if (!existsSync(path)) return null
  const lines = readFileSync(path, "utf8").split("\n")
  for (const [index, line] of lines.entries()) {
    const tag = line.match(/<script\b[^>]*>/i)?.[0]
    if (!tag || !/type\s*=\s*["']module["']/i.test(tag)) continue
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]
    if (!src || /^[a-z]+:/i.test(src)) continue
    const file = normalize(src)
    if (!existsSync(join(root, file))) {
      return failed(`index.html line ${index + 1} loads "${src}", which does not exist.`)
    }
    return derived(file, { file: "index.html", line: index + 1 }, "index.html module script")
  }
  return null
}

/**
 * @param {string} root
 * @returns {EntryDerivation | null}
 */
function fromPackageJson(root) {
  const path = join(root, "package.json")
  if (!existsSync(path)) return null
  const text = readFileSync(path, "utf8")
  /** @type {{ exports?: unknown, main?: unknown }} */
  const manifest = JSON.parse(text)
  const exported = rootExport(manifest.exports)
  if (exported !== null) {
    return fromManifestField(root, text, exported, "exports", 'package.json exports["."]')
  }
  if (typeof manifest.main === "string") {
    return fromManifestField(root, text, manifest.main, "main", "package.json main")
  }
  return null
}

/**
 * The file behind `exports["."]`. Accepts the string form, the `"."` key, and
 * the `import` or `default` condition.
 *
 * @param {unknown} exports
 * @returns {string | null}
 */
function rootExport(exports) {
  if (typeof exports === "string") return exports
  if (!isRecord(exports)) return null
  const target = "." in exports ? exports["."] : exports
  if (typeof target === "string") return target
  if (!isRecord(target)) return null
  for (const condition of ["development", "import", "browser", "default"]) {
    const value = target[condition]
    if (typeof value === "string") return value
  }
  return null
}

/**
 * @param {string} root
 * @param {string} manifestText
 * @param {string} target
 * @param {string} key
 * @param {string} via
 * @returns {EntryDerivation}
 */
function fromManifestField(root, manifestText, target, key, via) {
  const file = normalize(target)
  if (!existsSync(join(root, file))) {
    return failed(`${via} is "${target}", which does not exist.`)
  }
  const index = manifestText.split("\n").findIndex(line => line.includes(`"${key}"`))
  return derived(file, { file: "package.json", line: index + 1 }, via)
}

/**
 * "./src/index.ts" and "/src/index.ts" both become "src/index.ts".
 *
 * @param {string} path
 */
function normalize(path) {
  return posix.normalize(path.replaceAll("\\", "/")).replace(/^(\.\/|\/)+/, "")
}

/**
 * @param {string} file
 * @param {import("../types").SourceSite} source
 * @param {string} via
 * @returns {EntryDerivation}
 */
function derived(file, source, via) {
  return { _tag: "Derived", value: { file }, source, via }
}

/**
 * @param {string} reason
 * @returns {EntryDerivation}
 */
function failed(reason) {
  return { _tag: "Failed", reason, hint: ENTRY_HINT }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
