// @ts-check
import { existsSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative } from "node:path"
import { gzipSync } from "node:zlib"

/**
 * The browser packages Caliper's chrome imports, served from Caliper's own
 * node_modules through an import map. There is no bundler: the browser loads
 * each package's own ES module, and the import map maps every bare name to
 * one URL, so each package loads once.
 *
 * The project's Vite never sees these packages. They are not in its module
 * graph or its dependency pre-bundling (decision 10).
 *
 * @typedef {{ name: string, version: string, dir: string, entry: string }} BrowserPackage
 *   `dir` is absolute; `entry` is the ES module entry, relative to `dir`.
 * @typedef {{ packages: BrowserPackage[], problems: string[] }} PackageGraph
 * @typedef {{ type: string, body: Buffer, encoding: "gzip" | null }} ServedModule
 */

/** The packages the chrome imports by name. Their dependencies follow. */
export const CHROME_PACKAGES = [
  "@codemirror/autocomplete",
  "@codemirror/commands",
  "@codemirror/lang-css",
  "@codemirror/lang-javascript",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/merge",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/highlight",
]

/**
 * Find every package the roots need, with its version and ES module entry.
 * Each dependency resolves from the package that depends on it, as Node
 * resolves it. Two versions of one package are a problem: an import map
 * maps a name to one URL, and CodeMirror breaks with two copies of
 * `@codemirror/state`.
 *
 * @param {string} from the folder to resolve the roots from
 * @param {readonly string[]} roots
 * @returns {PackageGraph}
 */
export function browserPackages(from, roots) {
  /** @type {Map<string, BrowserPackage>} */
  const found = new Map()
  /** @type {string[]} */
  const problems = []

  /** @param {string} name @param {string} importer */
  const visit = (name, importer) => {
    const dir = packageDir(importer, name)
    if (dir === null) {
      problems.push(`Caliper cannot find the package ${name}, needed by ${importer}. Run your package manager's install.`)
      return
    }
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
    const known = found.get(name)
    if (known !== undefined) {
      if (known.dir !== dir && known.version !== manifest.version) {
        problems.push(`Caliper found two versions of ${name}: ${known.version} and ${manifest.version}. The code editor needs exactly one.`)
      }
      return
    }
    const entry = moduleEntry(manifest)
    if (entry === null || !existsSync(join(dir, entry))) {
      problems.push(`${name} ${manifest.version} has no ES module entry Caliper can load in a browser.`)
      return
    }
    found.set(name, { name, version: manifest.version, dir, entry: entry.replace(/^\.\//, "") })
    for (const dependency of Object.keys(manifest.dependencies ?? {})) visit(dependency, dir)
  }

  for (const root of roots) visit(root, from)
  return { packages: [...found.values()], problems }
}

/**
 * The import map for the packages: each bare name maps to its entry's URL.
 * The version is in the URL, so the browser may cache each file for good.
 *
 * @param {readonly BrowserPackage[]} packages
 * @param {string} baseUrl where `serveModule` answers, for example "/__caliper/modules"
 * @returns {{ imports: Record<string, string> }}
 */
export function importMap(packages, baseUrl) {
  return {
    imports: Object.fromEntries(packages.map(pkg => [pkg.name, `${baseUrl}/${pkg.name}@${pkg.version}/${pkg.entry}`])),
  }
}

/**
 * Serve one file of one package, compressed when the browser accepts it.
 * Only `.js` files inside a known package's folder are served.
 *
 * @param {readonly BrowserPackage[]} packages
 * @param {string} path below the base URL, for example "@codemirror/view@6.43.13/dist/index.js"
 * @param {boolean} gzip whether the browser accepts gzip
 * @param {Map<string, ServedModule>} cache
 * @returns {ServedModule | null}
 */
export function serveModule(packages, path, gzip, cache) {
  const key = `${gzip ? "gz" : "id"}:${path}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const pkg = packages.find(candidate => path.startsWith(`${candidate.name}@${candidate.version}/`))
  if (pkg === undefined) return null
  const file = join(pkg.dir, path.slice(`${pkg.name}@${pkg.version}/`.length))
  const inside = relative(pkg.dir, file)
  if (inside.startsWith("..") || isAbsolute(inside) || !file.endsWith(".js") || !existsSync(file)) return null
  const source = readFileSync(file)
  /** @type {ServedModule} */
  const served = gzip
    ? { type: "text/javascript", body: gzipSync(source), encoding: "gzip" }
    : { type: "text/javascript", body: source, encoding: null }
  cache.set(key, served)
  return served
}

/**
 * The folder of package `name` as Node would find it from `from`: the
 * nearest `node_modules/<name>` in `from` or a folder above it.
 *
 * @param {string} from
 * @param {string} name
 * @returns {string | null}
 */
function packageDir(from, name) {
  let dir = from
  for (;;) {
    const candidate = join(dir, "node_modules", ...name.split("/"))
    if (existsSync(join(candidate, "package.json"))) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * The file a browser `import` of the package loads.
 *
 * @param {Record<string, any>} manifest
 * @returns {string | null}
 */
function moduleEntry(manifest) {
  const exports = manifest.exports
  const root = typeof exports === "object" && exports !== null && "." in exports ? exports["."] : exports
  const fromExports = conditional(root)
  if (fromExports !== null) return fromExports
  if (typeof manifest.module === "string") return manifest.module
  return manifest.type === "module" && typeof manifest.main === "string" ? manifest.main : null
}

/**
 * @param {unknown} target an `exports` target
 * @returns {string | null}
 */
function conditional(target) {
  if (typeof target === "string") return target
  if (typeof target !== "object" || target === null || Array.isArray(target)) return null
  const record = /** @type {Record<string, unknown>} */ (target)
  for (const condition of ["browser", "import", "module", "default"]) {
    if (condition in record) {
      const resolved = conditional(record[condition])
      if (resolved !== null) return resolved
    }
  }
  return null
}
