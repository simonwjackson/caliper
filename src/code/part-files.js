// @ts-check
import { dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from "node:path"
import ts from "typescript"
import { CSS_FILE, SCRIPT_FILE, staticImports } from "../derive/app-shell.js"

/**
 * @typedef {import("../types").Resolve} Resolve
 * @typedef {import("../types").CodeFile} CodeFile
 */

/** A page part can reach many modules. Past this many, the list stops. */
export const MAX_PART_FILES = 400

/** What a relative import may leave out, in the order Vite tries it. */
const EXTENSIONS = ["", ".tsx", ".ts", ".jsx", ".js", ".mjs", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"]

/**
 * The project files a part is made of: the part file, then every local
 * module and stylesheet it imports, nearest first. The walk reads files as a
 * take sees them, so an import that a take adds counts, and one it removes
 * does not.
 *
 * Relative imports resolve against the files the take sees. Other imports,
 * such as aliases, resolve the way the project's Vite resolves them.
 *
 * @param {{
 *   root: string,
 *   part: string,
 *   read: (file: string) => string | null,
 *   resolve: Resolve,
 * }} input
 *   `part` and the files `read` takes are root-relative. `read` returns null
 *   for a file that does not exist.
 * @returns {Promise<Array<{ file: string, depth: number }>>}
 */
export async function partFiles({ root, part, read, resolve }) {
  /** @type {Array<{ file: string, depth: number }>} */
  const found = [{ file: part, depth: 0 }]
  const seen = new Set([part])
  // Breadth-first, so a file's depth is its shortest import chain.
  for (let index = 0; index < found.length && found.length < MAX_PART_FILES; index += 1) {
    const { file, depth } = /** @type {{ file: string, depth: number }} */ (found[index])
    if (!SCRIPT_FILE.test(file)) continue
    const source = read(file)
    if (source === null) continue
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file))
    for (const { specifier } of staticImports(tree)) {
      const target = await resolveImport({ root, importer: file, specifier: specifier.split("?")[0] ?? "", read, resolve })
      if (target === null || seen.has(target)) continue
      if (!SCRIPT_FILE.test(target) && !CSS_FILE.test(target)) continue
      seen.add(target)
      found.push({ file: target, depth: depth + 1 })
      if (found.length >= MAX_PART_FILES) break
    }
  }
  return found
}

/**
 * The list the code pane shows: the part's files, then files the take
 * changes that the part does not reach. Those still change other parts, so
 * they stay visible, with no depth.
 *
 * @param {Array<{ file: string, depth: number }>} reached
 * @param {readonly string[]} changed the files the take changes, or [] for the real files
 * @returns {CodeFile[]}
 */
export function codeFiles(reached, changed) {
  const changes = new Set(changed)
  const listed = reached.map(({ file, depth }) => ({ file, depth, changed: changes.has(file) }))
  const unreached = changed.filter(file => !reached.some(entry => entry.file === file))
  return [...listed, ...unreached.map(file => ({ file, depth: null, changed: true }))]
}

/**
 * @param {{ root: string, importer: string, specifier: string, read: (file: string) => string | null, resolve: Resolve }} input
 * @returns {Promise<string | null>} root-relative, or null for a file outside the project or in node_modules
 */
async function resolveImport({ root, importer, specifier, read, resolve }) {
  if (specifier === "") return null
  if (specifier.startsWith(".")) {
    const base = join(dirname(importer), specifier)
    for (const extension of EXTENSIONS) {
      const candidate = toPosix(`${base}${extension}`)
      if (read(candidate) !== null) return candidate
    }
    return null
  }
  const absolute = await resolve(specifier, resolvePath(root, importer))
  if (absolute === null || absolute.includes(`${sep}node_modules${sep}`)) return null
  const inside = relative(root, absolute)
  return inside.startsWith("..") || isAbsolute(inside) ? null : toPosix(inside)
}

/** @param {string} file */
function scriptKind(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX
  if (/\.(m|c)?ts$/.test(file)) return ts.ScriptKind.TS
  return ts.ScriptKind.JSX
}

/** @param {string} path */
function toPosix(path) {
  return path.split(sep).join("/")
}
