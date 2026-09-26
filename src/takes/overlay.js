// @ts-check
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve as resolvePath } from "node:path"
import { isTakeId, TAKES_DIR } from "./store.js"

/**
 * A take is overlaid on the real project inside the one Vite server.
 *
 * A module requested with `?take=<n>` passes the tag to every project module
 * it imports. `load` serves the take's copy of a file when one exists, else
 * the real file. `node_modules` never gets the tag, so the project keeps one
 * React. See decision 12 and the `spike/takes` branch.
 */

const TAKE_PARAM = /[?&]take=([1-9]\d*)(?:&|$)/

/**
 * The take a module id carries, or null.
 *
 * @param {string} id
 */
export function takeOf(id) {
  return TAKE_PARAM.exec(id)?.[1] ?? null
}

/**
 * @param {string} id a module id or URL
 * @param {string} take
 */
export function withTake(id, take) {
  return `${id}${id.includes("?") ? "&" : "?"}take=${take}`
}

/** @param {string} id */
function fileOf(id) {
  return id.split("?")[0] ?? id
}

/**
 * The take's copy of a real project file, or null when the take does not
 * change that file.
 *
 * @param {string} root
 * @param {string} take
 * @param {string} file absolute path of the real file
 */
export function copyFor(root, take, file) {
  if (!isProjectSource(root, file)) return null
  const copy = join(root, TAKES_DIR, take, relative(root, file))
  return existsSync(copy) ? copy : null
}

/**
 * Project source that a take can change: inside the root, and not in
 * node_modules or the takes folder.
 *
 * @param {string} root
 * @param {string} file absolute
 */
function isProjectSource(root, file) {
  const inside = relative(root, file)
  return !inside.startsWith("..") && !inside.includes("node_modules") && !inside.startsWith(TAKES_DIR)
}

// A top-level `@import "x";` or `@import url(x);` with no layer, media or supports condition.
const PLAIN_IMPORT = /^\s*@import\s+(?:url\()?\s*["']?([^"')\s]+)["']?\s*\)?\s*;\s*$/m
const ANY_IMPORT = /^\s*@import\b[^;]*;/gm

/**
 * The local `@import`s of a stylesheet, resolved to absolute files. A package
 * import stays in the file and is not listed. An import with a condition is
 * listed apart, because Caliper cannot flatten it.
 *
 * @param {string} root
 * @param {string} file
 * @param {string} code
 */
function localImports(root, file, code) {
  /** @type {{ statement: string, file: string }[]} */
  const found = []
  /** @type {string[]} */
  const conditional = []
  for (const match of code.matchAll(ANY_IMPORT)) {
    const statement = match[0]
    const specifier = PLAIN_IMPORT.exec(statement)?.[1]
    if (specifier === undefined) {
      conditional.push(statement.trim())
      continue
    }
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) continue
    const target = specifier.startsWith("/") ? join(root, specifier) : resolvePath(dirname(file), specifier)
    if (isProjectSource(root, target)) found.push({ statement, file: target })
  }
  return { found, conditional }
}

/**
 * The global stylesheets as a take sees them. Each local `@import` is expanded
 * in cascade order, imports first and then the file itself, so each file
 * becomes its own module that can carry the take tag.
 *
 * Vite inlines `@import` with postcss-import, which reads files from disk and
 * never calls plugin `load`, so the tag cannot pass through it.
 *
 * @param {string} root
 * @param {string} take
 * @param {readonly string[]} stylesheets absolute paths, in load order
 * @returns {{ order: string[], problems: string[] }}
 */
export function flattenStylesheets(root, take, stylesheets) {
  /** @type {string[]} */
  const order = []
  /** @type {string[]} */
  const problems = []
  const seen = new Set()
  /** @param {string} file */
  const visit = file => {
    if (seen.has(file)) return
    seen.add(file)
    const source = copyFor(root, take, file) ?? file
    if (!existsSync(source)) {
      problems.push(`${relative(root, file)} does not exist.`)
      return
    }
    const { found, conditional } = localImports(root, file, readFileSync(source, "utf8"))
    for (const statement of conditional) problems.push(`${relative(root, source)}: Caliper cannot show a take's change through ${statement}`)
    for (const entry of found) visit(entry.file)
    order.push(file)
  }
  for (const sheet of stylesheets) visit(sheet)
  return { order, problems }
}

/**
 * The Vite hooks that carry the take tag through the module graph. The
 * plugin calls them from its own hooks.
 *
 * @param {() => string} getRoot
 */
export function takeOverlay(getRoot) {
  return {
    /**
     * Must run before `vite:resolve`, which would drop the tag.
     *
     * @this {import("vite").Rollup.PluginContext}
     * @param {string} source
     * @param {string | undefined} importer
     * @param {any} options
     */
    async resolveId(source, importer, options) {
      if (!importer || takeOf(source) !== null) return null
      const take = takeOf(importer)
      if (take === null) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (!resolved || resolved.external) return resolved
      if (!isProjectSource(getRoot(), fileOf(resolved.id))) return resolved
      return { ...resolved, id: withTake(resolved.id, take) }
    },

    /**
     * @this {import("vite").Rollup.PluginContext}
     * @param {string} id
     * @returns {string | null}
     */
    load(id) {
      const take = takeOf(id)
      if (take === null) return null
      const root = getRoot()
      const file = fileOf(id)
      if (!isProjectSource(root, file)) return null
      const copy = copyFor(root, take, file)
      if (copy) this.addWatchFile(copy)
      if (!file.endsWith(".css")) return copy ? readFileSync(copy, "utf8") : null
      // The frame loads each local @import as its own tagged module; drop them here.
      const code = readFileSync(copy ?? file, "utf8")
      let out = code
      for (const entry of localImports(root, file, code).found) {
        out = out.replace(entry.statement, `/* take ${take}: loaded on its own: ${entry.statement.trim()} */`)
      }
      return out
    },

    /**
     * A save in a take's copy updates the modules of the real file that carry
     * that take's tag. Watching the copy alone triggers no update.
     *
     * @this {{ environment: import("vite").DevEnvironment }}
     * @param {{ file: string, modules: import("vite").EnvironmentModuleNode[] }} update
     */
    hotUpdate({ file, modules }) {
      const root = getRoot()
      const inside = relative(join(root, TAKES_DIR), file)
      if (inside.startsWith("..")) return undefined
      const [take = "", ...rest] = inside.split("/")
      if (!isTakeId(take) || rest.length === 0) return []
      const real = join(root, ...rest)
      const graph = this.environment.moduleGraph
      const tagged = [...(graph.getModulesByFile(real) ?? [])].filter(mod => mod.id !== null && takeOf(mod.id) === take)
      for (const mod of tagged) graph.invalidateModule(mod)
      return [...new Set([...modules, ...tagged])]
    },
  }
}
