// @ts-check
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, join, relative } from "node:path"

/** @typedef {import("../types").Part} Part */

export const PART_SUFFIX = ".part.tsx"

/**
 * Find every `*.part.tsx` file under `root`.
 *
 * Inside a Git checkout, Git decides what counts: tracked and untracked files
 * are listed, and anything the checkout ignores is not. Outside Git, Caliper
 * walks the folder and skips dot-folders. `node_modules` never counts.
 *
 * @param {string} root absolute Vite root
 * @returns {Part[]} sorted by file path
 */
export function discoverParts(root) {
  const files = gitListedParts(root) ?? walkedParts(root)
  return files
    .filter(file => !/(^|\/)node_modules\//.test(file) && existsSync(join(root, file)))
    .sort((left, right) => left.localeCompare(right))
    .map(file => readPart(root, file))
}

/**
 * @param {string} root
 * @returns {string[] | null} null when `root` is not inside a Git checkout
 */
function gitListedParts(root) {
  try {
    const output = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", `*${PART_SUFFIX}`],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    )
    return [...new Set(output.split("\0").filter(Boolean))]
  } catch {
    return null
  }
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function walkedParts(root) {
  /** @type {string[]} */
  const found = []
  /** @param {string} directory */
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith(PART_SUFFIX)) found.push(relative(root, path).replaceAll("\\", "/"))
    }
  }
  walk(root)
  return found
}

/**
 * Read the part's `name` and `note` exports without running the file.
 *
 * @param {string} root
 * @param {string} file
 * @returns {Part}
 */
function readPart(root, file) {
  const source = readFileSync(join(root, file), "utf8")
  const name = stringExport(source, "name") ?? nameFromFile(file)
  const note = stringExport(source, "note")
  return note === undefined ? { file, name } : { file, name, note }
}

/**
 * @param {string} source
 * @param {string} exportName
 * @returns {string | undefined}
 */
function stringExport(source, exportName) {
  const match = source.match(
    new RegExp(`export\\s+const\\s+${exportName}\\s*(?::\\s*string\\s*)?=\\s*(["'\`])((?:\\\\.|(?!\\1).)*)\\1`),
  )
  return match?.[2]
}

/**
 * "PicoButton.atom.part.tsx" becomes "PicoButton".
 *
 * @param {string} file
 */
function nameFromFile(file) {
  return basename(file, PART_SUFFIX).split(".")[0] ?? file
}
