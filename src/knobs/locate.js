// @ts-check
import { parse } from "postcss"
import { parseComment } from "./hints.js"

/**
 * Find the source declaration behind a rule the browser holds (decision 23).
 *
 * The chrome sends the text Vite served into a `<style>`, a summary of the
 * CSSOM rules the browser built from it, and the declarations it wants. This
 * module pairs each CSSOM rule with the parsed served text, by order and
 * selector, then maps the declaration through the inline sourcemap to the
 * source file. The served text is not the source: Vite inlines `@import` and
 * rewrites `url()`. Without a sourcemap, Caliper refuses.
 *
 * @typedef {import("postcss").ChildNode} ChildNode
 * @typedef {import("postcss").Container} Container
 * @typedef {import("postcss").Declaration} Declaration
 * @typedef {import("postcss").Root} Root
 * @typedef {{ path: number[], kind: string, selector?: string, name?: string }} RuleSummary
 *   One CSSOM rule. `kind` is `style` or the at-rule's name (`media`,
 *   `container`, `property`, ...); `path` is its index at each level.
 * @typedef {{ path: number[], property: string }} Target
 *   A declaration in one rule: a custom property, or `initial-value` in
 *   `@property`. `@container` names the condition of a `@container` rule.
 * @typedef {{ _tag: "Found", file: string, source: string, start: number, end: number, value: string, hints: import("./hints.js").ParsedComment }
 *   | { _tag: "Refused", reason: string }} Found
 *   `file` is absolute, `source` the text the sourcemap maps into.
 */

/** Rules a knob may sit inside. The others are not tested yet (decision 23). */
const TESTED_PARENTS = new Set(["media", "supports", "container"])

/**
 * @param {{ css: string, from: string, rules: RuleSummary[], targets: Target[] }} input
 *   `from` is the stylesheet's file, which the sourcemap's paths resolve against.
 * @returns {Found[]}
 */
export function locateDeclarations({ css, from, rules, targets }) {
  /** @type {Root} */
  let root
  try {
    root = parse(css, { from })
  } catch (error) {
    const reason = `Caliper could not read the served CSS: ${error instanceof Error ? error.message : String(error)}`
    return targets.map(() => ({ _tag: "Refused", reason }))
  }
  const paired = pair(root, rules)
  const byPath = new Map(rules.map(rule => [key(rule.path), rule]))
  /** @type {Map<string, Root | null>} */
  const sources = new Map()
  return targets.map(target => {
    for (let depth = 1; depth < target.path.length; depth++) {
      const parent = byPath.get(key(target.path.slice(0, depth)))
      if (parent === undefined || !TESTED_PARENTS.has(parent.kind)) {
        return refused(`Caliper does not place knobs inside ${parent === undefined ? "this rule" : parent.kind === "style" ? "nested CSS" : `@${parent.kind}`} yet.`)
      }
    }
    const summary = byPath.get(key(target.path))
    const node = paired.get(key(target.path))
    if (summary === undefined || node === undefined) return refused("Caliper could not match this rule to the served CSS.")
    const needs = target.property === "initial-value" ? "property" : target.property === "@container" ? "container" : "style"
    if (summary.kind !== needs) {
      return refused(`A ${target.property} knob needs ${needs === "property" ? "an @property rule" : needs === "container" ? "a @container rule" : "a style rule"}.`)
    }
    if (needs === "container") return locateCondition(root, node, sources)
    const served = lastDeclaration(node, target.property)
    if (served === undefined) return refused(`The rule has no ${target.property} declaration in the served CSS.`)
    const start = served.source?.start
    const origin = start ? root.source?.input.origin(start.line, start.column) : false
    if (!origin) return refused("The served CSS has no source map for this declaration. Caliper turns on css.devSourcemap; another CSS pipeline may drop it.")
    if (origin.file === undefined || origin.source === undefined) return refused("The source map does not include the source file's text.")
    const offset = offsetOf(origin.source, origin.line, origin.column)
    if (!sources.has(origin.file)) sources.set(origin.file, parseSource(origin.source, origin.file))
    const sourceRoot = sources.get(origin.file) ?? null
    const declaration = sourceRoot === null ? undefined : declarationAt(sourceRoot, offset)
    if (declaration === undefined || declaration.prop !== target.property) {
      return refused("The source map does not point at this declaration in the source file.")
    }
    const span = valueSpan(origin.source, declaration)
    if (span === null || normal(span.value) !== normal(rawValue(served))) {
      return refused("The source declaration's value differs from the served CSS.")
    }
    const commentNode = (target.property === "initial-value" ? declaration.parent : declaration)?.prev()
    const hints = commentNode?.type === "comment"
      ? parseComment(commentNode.text, origin.source.startsWith("/**", commentNode.source?.start?.offset ?? -1))
      : { hints: {}, note: "", problems: [] }
    return { _tag: "Found", file: origin.file, source: origin.source, ...span, hints }
  })
}

/**
 * The condition of a `@container` rule, as written in its source file: the
 * text between `@container` and `{`.
 *
 * @param {Root} root the served CSS
 * @param {ChildNode} node the served `@container` rule
 * @param {Map<string, Root | null>} sources parsed source files, by path
 * @returns {Found}
 */
function locateCondition(root, node, sources) {
  if (node.type !== "atrule") return refused("Caliper could not match this rule to the served CSS.")
  const start = node.source?.start
  const origin = start ? root.source?.input.origin(start.line, start.column) : false
  if (!origin) return refused("The served CSS has no source map for this rule. Caliper turns on css.devSourcemap; another CSS pipeline may drop it.")
  if (origin.file === undefined || origin.source === undefined) return refused("The source map does not include the source file's text.")
  const offset = offsetOf(origin.source, origin.line, origin.column)
  if (!sources.has(origin.file)) sources.set(origin.file, parseSource(origin.source, origin.file))
  const sourceRoot = sources.get(origin.file) ?? null
  /** @type {import("postcss").AtRule | undefined} */
  let rule
  sourceRoot?.walkAtRules(candidate => {
    if (candidate.source?.start?.offset !== offset) return undefined
    rule = candidate
    return false
  })
  if (rule === undefined || rule.name.toLowerCase() !== "container") return refused("The source map does not point at this rule in the source file.")
  const raw = paramsOf(rule)
  const from = offset + 1 + rule.name.length + (rule.raws.afterName ?? "").length
  if (origin.source.slice(from, from + raw.length) !== raw || normal(raw) !== normal(paramsOf(node))) {
    return refused("The source rule's condition differs from the served CSS.")
  }
  const lead = raw.length - raw.trimStart().length
  const value = raw.trim()
  const commentNode = rule.prev()
  const hints = commentNode?.type === "comment"
    ? parseComment(commentNode.text, origin.source.startsWith("/**", commentNode.source?.start?.offset ?? -1))
    : { hints: {}, note: "", problems: [] }
  return { _tag: "Found", file: origin.file, source: origin.source, start: from + lead, end: from + lead + value.length, value, hints }
}

/** An at-rule's condition as written, comments included. @param {import("postcss").AtRule} rule */
function paramsOf(rule) {
  const raws = /** @type {{ params?: { raw: string } }} */ (rule.raws)
  return raws.params?.raw ?? rule.params
}

/** @param {string} reason @returns {Found} */
function refused(reason) {
  return { _tag: "Refused", reason }
}

/** @param {number[]} path */
function key(path) {
  return path.join(".")
}

/** @param {string} text @param {string} from */
function parseSource(text, from) {
  try {
    return parse(text, { from })
  } catch {
    return null
  }
}

/**
 * @param {Root} root
 * @param {number} offset
 * @returns {Declaration | undefined}
 */
function declarationAt(root, offset) {
  /** @type {Declaration | undefined} */
  let found
  root.walkDecls(declaration => {
    if (declaration.source?.start?.offset === offset) {
      found = declaration
      return false
    }
    return undefined
  })
  return found
}

/**
 * The value's place in the source, without the spaces around it.
 *
 * @param {string} text
 * @param {Declaration} declaration
 * @returns {{ start: number, end: number, value: string } | null}
 */
function valueSpan(text, declaration) {
  const begin = declaration.source?.start?.offset
  if (begin === undefined) return null
  const raw = rawValue(declaration)
  const from = begin + declaration.prop.length + (declaration.raws.between ?? ":").length
  if (text.slice(from, from + raw.length) !== raw) return null
  const lead = raw.length - raw.trimStart().length
  const value = raw.trim()
  return { start: from + lead, end: from + lead + value.length, value }
}

/** @param {Declaration} declaration */
function rawValue(declaration) {
  const raws = /** @type {{ value?: { raw: string } }} */ (declaration.raws)
  return raws.value?.raw ?? declaration.value
}

/** @param {string} value */
function normal(value) {
  return value.replace(/\s+/g, " ").trim()
}

/**
 * @param {string} text
 * @param {number} line 1-based
 * @param {number} column 1-based
 */
function offsetOf(text, line, column) {
  let offset = 0
  for (let index = 1; index < line; index++) offset = text.indexOf("\n", offset) + 1
  return offset + column - 1
}

/**
 * @param {ChildNode} node
 * @param {string} property
 * @returns {Declaration | undefined}
 */
function lastDeclaration(node, property) {
  if (!("nodes" in node) || node.nodes === undefined) return undefined
  /** @type {Declaration | undefined} */
  let last
  for (const child of node.nodes) if (child.type === "decl" && child.prop === property) last = child
  return last
}

/** @param {string} selector */
function normalSelector(selector) {
  return selector
    .replace(/\*(?=[:.#[])/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([>+~,()])\s*/g, "$1")
    .replace(/["']/g, "")
    .trim()
}

/**
 * @param {RuleSummary} rule
 * @param {ChildNode} node
 */
function compatible(rule, node) {
  if (rule.kind === "style") return node.type === "rule" && normalSelector(node.selector) === normalSelector(rule.selector ?? "")
  if (node.type !== "atrule" || node.name.toLowerCase().replace(/^-webkit-/, "") !== rule.kind) return false
  return rule.kind !== "property" || node.params.trim() === rule.name
}

/**
 * Pair each CSSOM rule with a parsed node: in order, within each parent. A
 * parsed rule the browser dropped, such as one it could not read, is skipped.
 *
 * @param {Root} root
 * @param {RuleSummary[]} rules
 * @returns {Map<string, ChildNode>}
 */
function pair(root, rules) {
  /** @type {Map<string, RuleSummary[]>} */
  const children = new Map()
  for (const rule of rules) {
    const parent = key(rule.path.slice(0, -1))
    children.set(parent, [...(children.get(parent) ?? []), rule])
  }
  for (const list of children.values()) list.sort((left, right) => (left.path.at(-1) ?? 0) - (right.path.at(-1) ?? 0))
  /** @type {Map<string, ChildNode>} */
  const map = new Map()
  /** @param {string} parent @param {ChildNode[]} nodes */
  const align = (parent, nodes) => {
    let next = 0
    for (const rule of children.get(parent) ?? []) {
      let index = next
      while (index < nodes.length && !compatible(rule, /** @type {ChildNode} */ (nodes[index]))) index++
      if (index === nodes.length) continue
      const node = /** @type {ChildNode} */ (nodes[index])
      map.set(key(rule.path), node)
      if ("nodes" in node && node.nodes && rule.kind !== "keyframes") align(key(rule.path), rulesOf(node))
      next = index + 1
    }
  }
  align("", rulesOf(root))
  return map
}

/** @param {Container | ChildNode} node @returns {ChildNode[]} */
function rulesOf(node) {
  return "nodes" in node && node.nodes ? node.nodes.filter(child => child.type === "rule" || child.type === "atrule") : []
}
