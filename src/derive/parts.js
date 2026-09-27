// @ts-check
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, join, relative } from "node:path"
import ts from "typescript"
import { readComposition, validateCompositions } from "./composition.js"

/**
 * @typedef {import("../types").Part} Part
 * @typedef {import("../types").PartState} PartState
 * @typedef {import("../types").PartLayer} PartLayer
 */

export const PART_SUFFIX = ".part.tsx"

/** The state every part has: its default export. */
export const DEFAULT_STATE = /** @type {const} */ ({ export: "default", label: "Default" })

/**
 * Find every `*.part.tsx` file under `root`.
 *
 * Inside a Git checkout, Git decides what counts: tracked and untracked files
 * are listed, and anything the checkout ignores is not. Outside Git, Caliper
 * walks the folder and skips dot-folders. `node_modules` never counts.
 *
 * @param {string} root absolute Vite root
 * @param {ReadonlyMap<string, string>} [overrides] Proposed part sources, including new files, when validating a take before acceptance
 * @returns {Part[]} sorted by file path
 */
export function discoverParts(root, overrides = new Map()) {
  const files = [...new Set([...(gitListedParts(root) ?? walkedParts(root)), ...overrides.keys()])]
  const parts = files
    .filter(file => file.endsWith(PART_SUFFIX) && !/(^|\/)node_modules\//.test(file) && (overrides.has(file) || existsSync(join(root, file))))
    .sort((left, right) => left.localeCompare(right))
    .map(file => readPart(root, file, overrides.get(file)))
  return validateCompositions(parts)
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
 * Read the part's metadata and states without running the file.
 *
 * @param {string} root
 * @param {string} file
 * @param {string} [source] Optional take copy; no module is executed.
 * @returns {Part}
 */
export function readPart(root, file, source = readFileSync(join(root, file), "utf8")) {
  const name = stringExport(source, "name") ?? nameFromFile(file)
  const note = stringExport(source, "note")
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const states = [DEFAULT_STATE, ...namedStates(tree)]
  return { file, name, ...(note === undefined ? {} : { note }), states, ...partLayer(file, tree), ...readComposition(file, source) }
}

/**
 * The part's named states, in source order, without running the file.
 *
 * A named state is an exported component: an exported function, or an
 * exported `const` set to an arrow or function expression, whose name starts
 * with an upper-case letter. Lower-case exports such as `name`, `note` and
 * helpers are not states. The default export is always the first state, so
 * it is not listed here; the frame reports it when it is missing.
 *
 * @param {ts.SourceFile} tree
 * @returns {PartState[]}
 */
function namedStates(tree) {
  /** @type {PartState[]} */
  const states = []
  /** @param {ts.Node} node @param {string} exportName */
  const add = (node, exportName) => {
    if (!/^[A-Z]/.test(exportName)) return
    const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1
    states.push({ export: exportName, label: labelFor(exportName), line })
  }
  for (const statement of tree.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : []
    if (!modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
    if (modifiers.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) continue
    if (ts.isFunctionDeclaration(statement) && statement.name) add(statement, statement.name.text)
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      const value = declaration.initializer
      if (!ts.isIdentifier(declaration.name) || !value) continue
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) add(statement, declaration.name.text)
    }
  }
  return states
}

/** @type {readonly PartLayer[]} */
const LAYERS = ["page", "template", "organism", "molecule", "atom"]

/**
 * An exported literal `layer` overrides the filename suffix. Folder names
 * never classify a part. Read syntax only; computed values are not executed.
 *
 * @param {string} file
 * @param {ts.SourceFile} tree
 * @returns {Pick<Part, "layer" | "layerSource">}
 */
function partLayer(file, tree) {
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement)
      || !(statement.declarationList.flags & ts.NodeFlags.Const)
      || !statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "layer") continue
      let value = declaration.initializer
      while (value && (ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isParenthesizedExpression(value))) value = value.expression
      if (!value || !(ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))) continue
      const layer = LAYERS.find(layer => layer === value.text)
      if (layer) return { layer, layerSource: { file, line: tree.getLineAndCharacterOfPosition(declaration.getStart(tree)).line + 1 } }
    }
  }
  const stem = basename(file, PART_SUFFIX)
  const suffix = stem.includes(".") ? stem.split(".").at(-1) : undefined
  const layer = LAYERS.find(layer => layer === suffix)
  return layer ? { layer } : {}
}

/**
 * "CatalogError" becomes "Catalog error".
 *
 * @param {string} exportName
 */
function labelFor(exportName) {
  const words = exportName.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" ")
  return words.map((word, index) => (index === 0 || /^[A-Z0-9]+$/.test(word) ? word : word.toLowerCase())).join(" ")
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
