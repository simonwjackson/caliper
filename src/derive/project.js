// @ts-check
import { existsSync, readFileSync, statSync } from "node:fs"
import { basename, isAbsolute, join, relative, resolve as resolvePath } from "node:path"
import { CSS_FILE, readAppShell } from "./app-shell.js"
import { deriveEntry } from "./entry.js"
import { discoverParts } from "./parts.js"
import { resolveDevices } from "../client/device-frame.js"

/**
 * @typedef {import("../types").Project} Project
 * @typedef {import("../types").CaliperOptions} CaliperOptions
 * @typedef {import("../types").Resolve} Resolve
 * @typedef {import("../types").Derivation<import("../types").Wrapper>} WrapperDerivation
 * @typedef {import("../types").Derivation<import("../types").GlobalCss>} CssDerivation
 */

/**
 * Derive everything Caliper needs from the project's own source.
 *
 * @param {{ root: string, options: CaliperOptions, resolve: Resolve }} input
 * @returns {Promise<{ project: Project, files: string[] }>}
 *   `files` are the absolute paths the result depends on, apart from part files
 */
export async function deriveProject({ root, options, resolve }) {
  const devices = resolveDevices(options.devices)
  if (devices._tag === "Invalid") throw new Error(devices.reason)
  const parts = discoverParts(root)
  const entry = deriveEntry(root, options.entry)
  const files = [join(root, "index.html"), join(root, "package.json")]

  /** @type {CssDerivation} */
  let css = {
    _tag: "Failed",
    reason: "Caliper has no entry to start from.",
    hint: 'Set caliper({ entry: "src/main.tsx" }) in vite.config.',
  }
  /** @type {WrapperDerivation} */
  let wrapper = css
  if (entry._tag !== "Failed") {
    const shell = await readAppShell({ root, entry: entry.value.file, resolve })
    css = shell.css
    wrapper = shell.wrapper
    files.push(...shell.files)
  }

  css = cssOverride(root, options.css) ?? css
  if (css._tag !== "Failed") files.push(...css.value.stylesheets.map(sheet => resolvePath(root, sheet.file)))

  return {
    project: { name: projectName(root), parts, entry, css, wrapper: wrapOverride(options.wrap) ?? wrapper, devices: devices.devices },
    files,
  }
}

/**
 * Explicit globals replace discovery; they never pull in a component subtree.
 * @param {string} root
 * @param {CaliperOptions["css"]} css
 * @returns {CssDerivation | null}
 */
function cssOverride(root, css) {
  if (css === undefined) return null
  /** @type {import("../types").GlobalStylesheet[]} */
  const stylesheets = []
  const seen = new Set()
  for (const file of css) {
    const absolute = resolvePath(root, file)
    const inside = relative(root, absolute).replaceAll("\\", "/")
    if (isAbsolute(file) || inside.startsWith("../") || !CSS_FILE.test(file)
      || !existsSync(absolute) || !statSync(absolute).isFile()) {
      return {
        _tag: "Failed",
        reason: `caliper({ css }) names an invalid stylesheet: "${file}".`,
        hint: 'Set caliper({ css: ["src/global.css"] }) to existing stylesheet paths relative to the Vite root, without query strings.',
      }
    }
    if (!seen.has(inside)) stylesheets.push({ file: inside })
    seen.add(inside)
  }
  return { _tag: "Overridden", value: { stylesheets, unresolved: [] }, option: "css" }
}

/**
 * @param {CaliperOptions["wrap"]} wrap
 * @returns {WrapperDerivation | null}
 */
function wrapOverride(wrap) {
  if (wrap === undefined) return null
  const classNames = wrap === false ? [] : typeof wrap === "string" ? [wrap] : [...wrap]
  return {
    _tag: "Overridden",
    value: { elements: classNames.map(className => ({ tag: "div", className })) },
    option: "wrap",
  }
}

/** @param {string} root */
function projectName(root) {
  const manifest = join(root, "package.json")
  if (existsSync(manifest)) {
    const name = JSON.parse(readFileSync(manifest, "utf8")).name
    if (typeof name === "string" && name.length > 0) return name
  }
  return basename(root)
}
