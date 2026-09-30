// @ts-check
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const directory = fileURLToPath(new URL("../../dist/chrome/", import.meta.url))
const types = new Map([
  ["js", "text/javascript"], ["css", "text/css"],
  ["woff", "font/woff"], ["woff2", "font/woff2"], ["ttf", "font/ttf"],
  ["svg", "image/svg+xml"], ["png", "image/png"], ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"], ["webp", "image/webp"], ["gif", "image/gif"],
])

/** Read only build-manifest resources, never arbitrary package or subject files. */
export function chromeDelivery() {
  const manifestFile = join(directory, ".vite/manifest.json")
  if (!existsSync(manifestFile)) throw new Error("Caliper's chrome bundle is missing. Run bun run build in Caliper before linking or packing it.")
  /** @type {Record<string, {file: string, isEntry?: boolean, css?: string[], assets?: string[], imports?: string[]}>} */
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"))
  const entry = Object.values(manifest).find(value => value.isEntry)
  if (!entry) throw new Error("Caliper's chrome manifest has no entry. Run bun run build in Caliper.")
  const files = new Set(Object.values(manifest).flatMap(value => [value.file, ...(value.css ?? []), ...(value.assets ?? [])]))
  const css = new Set(entry.css ?? [])
  // Entry CSS can also belong to a static shared chunk. Do not eagerly load
  // dynamic editor chunks or their resources.
  const visited = new Set()
  /** @param {string} key */
  function visit(key) {
    if (visited.has(key)) return
    visited.add(key)
    const chunk = manifest[key]
    for (const file of chunk?.css ?? []) css.add(file)
    for (const dependency of chunk?.imports ?? []) visit(dependency)
  }
  for (const key of entry.imports ?? []) visit(key)
  return {
    entry: entry.file,
    css: [...css],
    /** @param {string} file */
    read(file) {
      if (!files.has(file) || file.split("/").some(segment => segment === "..") || file.startsWith("/")) return null
      const type = types.get(file.split(".").at(-1) ?? "")
      return type === undefined ? null : { type, body: readFileSync(join(directory, file)) }
    },
  }
}
