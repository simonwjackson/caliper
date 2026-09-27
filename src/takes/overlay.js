// @ts-check
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve as resolvePath } from "node:path"
import { parse as parseCss } from "postcss"
import { fenceProjectPath, isTakeId, TAKES_DIR } from "./store.js"

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

/** Resolve only local new modules; package resolution remains Vite's job.
 * @param {string} root @param {string} take @param {string} source @param {string | undefined} importer
 */
function addedModule(root, take, source, importer) {
  const path = fileOf(source)
  const absolute = path.startsWith(`${root}/`) ? path
    : path.startsWith("/@fs/") ? path.slice(4)
      : path.startsWith("/") ? join(root, path)
        : path.startsWith(".") && importer ? resolvePath(dirname(fileOf(importer)), path) : null
  if (!absolute || !isProjectSource(root, absolute)) return null
  const query = new URLSearchParams(source.split("?")[1] ?? "")
  query.delete("take")
  const suffix = query.size ? `?${query}` : ""
  for (const extension of ["", ".tsx", ".ts", ".jsx", ".js", ".mjs", ".json", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"]) {
    const logical = `${absolute}${extension}`
    const file = relative(root, logical)
    if (fenceProjectPath(root, file)._tag !== "Inside") continue
    const folder = join(root, TAKES_DIR, take)
    if (!existsSync(folder) || fenceProjectPath(folder, file)._tag !== "Inside") continue
    const copy = copyFor(root, take, logical)
    if (copy && statSync(copy).isFile()) return withTake(`${logical}${suffix}`, take)
  }
  return null
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
 * @param {() => string} [getCacheDir] Vite's prebundled dependencies are never project source.
 */
export function takeOverlay(getRoot, getCacheDir = () => join(getRoot(), "node_modules/.vite")) {
  /** @param {string} file */
  const sourceFile = file => {
    const cacheRelative = relative(getCacheDir(), file)
    const cached = cacheRelative === "" || (!cacheRelative.startsWith("..") && !isAbsolute(cacheRelative))
    return !cached && isProjectSource(getRoot(), file)
  }
  // Only imports scheduled by a frame can be removed from its CSS. Component
  // CSS now loads through the part, so it is no longer flattened by default.
  /** @type {Map<string, Set<string>>} */
  const flattened = new Map()
  return {
    /**
     * @param {string} take
     * @param {readonly string[]} sheets
     * @param {(file: string) => void} invalidate
     */
    prepareStylesheets(take, sheets, invalidate) {
      const flat = flattenStylesheets(getRoot(), take, sheets)
      const before = flattened.get(take) ?? new Set()
      const after = new Set(flat.order)
      flattened.set(take, after)
      // Membership changes how load() treats @imports. A previously flattened
      // module must not survive in Vite's cache after it becomes component CSS.
      for (const file of new Set([...before, ...after])) {
        if (before.has(file) !== after.has(file)) invalidate(file)
      }
      return flat
    },

    /**
     * Must run before `vite:resolve`, which would drop the tag.
     *
     * @this {import("vite").Rollup.PluginContext}
     * @param {string} source
     * @param {string | undefined} importer
     * @param {any} options
     */
    async resolveId(source, importer, options) {
      const take = takeOf(source) ?? (importer ? takeOf(importer) : null)
      if (take === null) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (resolved?.external) return resolved
      if (resolved && !sourceFile(fileOf(resolved.id))) return resolved
      // Vite cannot resolve a file that exists only in the take. Resolve local
      // imports against their logical project path, never create placeholder
      // files in the real project just to satisfy its filesystem resolver.
      if (!resolved || !existsSync(fileOf(resolved.id))) {
        const added = addedModule(getRoot(), take, resolved?.id ?? source, importer)
        if (added) return added
      }
      if (!resolved) return null
      return takeOf(resolved.id) ? resolved : { ...resolved, id: withTake(resolved.id, take) }
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
      if (!sourceFile(file)) return null
      const copy = copyFor(root, take, file)
      if (copy) this.addWatchFile(copy)
      if (!file.endsWith(".css")) return copy ? readFileSync(copy, "utf8") : null
      const code = readFileSync(copy ?? file, "utf8")
      if (!flattened.get(take)?.has(file)) {
        // Use CSS syntax, not a URL regex: comments, bare paths and quoted
        // strings must not hide an actual import or invent one in a comment.
        parseCss(code, { from: file }).walkAtRules(/^import$/i, () => {
          throw new Error(`${relative(root, file)}: Caliper cannot overlay this component's CSS @import chain. Import these stylesheets from JS or TS instead.`)
        })
        return code
      }
      // Global imports are loaded as separate tagged modules by the frame.
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
