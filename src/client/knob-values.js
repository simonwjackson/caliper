// @ts-check

/**
 * What a knob's control is, from standard CSS alone (decision 26). Pure: the
 * chrome's knobs panel reads the CSSOM, and this module decides what it means.
 *
 * @typedef {import("../types").KnobHints} KnobHints
 * @typedef {{ _tag: "Number", type: string } | { _tag: "Color" } | { _tag: "Idents", options: string[] } | { _tag: "Any" } | { _tag: "Other", syntax: string }} Syntax
 * @typedef {{ number: number, unit: string, step: number, min?: number, max?: number }} Scale
 * @typedef {({ _tag: "Number" } & Scale)
 *   | { _tag: "Color", value: string, hex: string | null }
 *   | { _tag: "Token", token: string, namespace: string }
 *   | { _tag: "Choice", options: string[], value: string }
 *   | { _tag: "Skip", reason: string }} Control
 *   `Color.hex` is the value as `#rrggbb`, for a colour input; null when it is written another way.
 */

const NUMERIC = new Set(["length", "number", "integer", "percentage", "length-percentage", "angle", "time", "resolution", "flex"])
/** CSS math functions. A value built with one is an output of other values. */
const FORMULA = /\b(calc|min|max|clamp|round|mod|rem|abs|sign|sin|cos|tan|asin|acos|atan|atan2|pow|sqrt|hypot|log|exp)\(/i
const TOKEN = /^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$/
const NUMBER = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/i
const IDENT = /^-?[A-Za-z_][A-Za-z0-9_-]*$/
/** Pixels of drag for one step. */
const PX_PER_STEP = 2

/** @param {string} syntax @returns {Syntax} */
export function parseSyntax(syntax) {
  const text = syntax.trim().replace(/^["']|["']$/g, "").trim()
  if (text === "*") return { _tag: "Any" }
  if (text === "<color>") return { _tag: "Color" }
  const type = /^<([a-z-]+)>$/.exec(text)?.[1]
  if (type !== undefined && NUMERIC.has(type)) return { _tag: "Number", type }
  const options = text.split("|").map(option => option.trim())
  if (options.length > 0 && options.every(option => IDENT.test(option))) return { _tag: "Idents", options }
  return { _tag: "Other", syntax: text }
}

/**
 * @param {{ syntax: string, value: string, hints: KnobHints }} input
 * @returns {Control}
 */
export function controlFor({ syntax, value, hints }) {
  if (hints.ignore) return skip("Hidden by @knob ignore.")
  const text = value.trim()
  const formula = FORMULA.exec(text)?.[1]
  if (formula !== undefined) return skip(`Computed with ${formula.toLowerCase()}(), so it is an output, not an input.`)
  const token = TOKEN.exec(text)?.[1]
  if (token !== undefined) return { _tag: "Token", token, namespace: namespaceOf(token) }
  if (/\bvar\(/i.test(text)) return skip(`Combines other tokens: ${text}.`)
  const parsed = parseSyntax(syntax)
  switch (parsed._tag) {
    case "Number": {
      const number = parseNumber(text)
      if (number === null) return skip(`${text} is not a number Caliper can scrub.`)
      return {
        _tag: "Number",
        ...number,
        step: hints.step ?? stepFor(text),
        ...(hints.min === undefined ? {} : { min: hints.min }),
        ...(hints.max === undefined ? {} : { max: hints.max }),
      }
    }
    case "Color":
      return { _tag: "Color", value: text, hex: hexOf(text) }
    case "Idents":
      return parsed.options.includes(text)
        ? { _tag: "Choice", options: parsed.options, value: text }
        : skip(`${text} is not one of ${parsed.options.join(", ")}.`)
    case "Any":
    case "Other":
      return skip(`Caliper has no control for the syntax ${parsed._tag === "Any" ? "*" : parsed.syntax} yet.`)
  }
}

/** @param {string} reason @returns {Control} */
function skip(reason) {
  return { _tag: "Skip", reason }
}

/** @param {string} text @returns {{ number: number, unit: string } | null} */
export function parseNumber(text) {
  const match = NUMBER.exec(text.trim())
  if (!match) return null
  return { number: Number(match[1]), unit: (match[2] ?? "").toLowerCase() }
}

/** One unit of the last digit the value is written with. @param {string} text */
function stepFor(text) {
  const decimals = /\.(\d+)/.exec(text)?.[1]?.length ?? 0
  return Number((10 ** -decimals).toFixed(decimals))
}

/** @param {number} step */
function decimalsOf(step) {
  const text = String(step)
  if (text.includes("e-")) return Number(text.split("e-")[1])
  return text.split(".")[1]?.length ?? 0
}

/**
 * @param {number} number
 * @param {string} unit
 * @param {number} step
 */
export function formatNumber(number, unit, step) {
  const text = number.toFixed(decimalsOf(step)).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
  return `${text === "-0" ? "0" : text}${unit}`
}

/**
 * The number a drag of `dx` CSS px reaches from `scale.number`.
 *
 * @param {Scale} scale
 * @param {number} dx
 */
export function scrub(scale, dx) {
  const steps = Math.round(dx / PX_PER_STEP)
  return clampTo(scale, scale.number + steps * scale.step)
}

/**
 * A number kept inside the hinted range, on the step's precision.
 *
 * @param {Scale} scale
 * @param {number} number
 */
export function clampTo(scale, number) {
  const low = scale.min ?? -Infinity
  const high = scale.max ?? Infinity
  return Number(Math.min(high, Math.max(low, number)).toFixed(decimalsOf(scale.step)))
}

/** @param {string} text @returns {string | null} */
function hexOf(text) {
  const six = /^#([0-9a-f]{6})$/i.exec(text)?.[1]
  if (six !== undefined) return `#${six.toLowerCase()}`
  const three = /^#([0-9a-f]{3})$/i.exec(text)?.[1]
  if (three !== undefined) return `#${[...three.toLowerCase()].map(digit => digit + digit).join("")}`
  return null
}

/**
 * A value valid for the syntax that differs from `current`, to find which
 * declaration wins by knockout (decision 23). Null when no such value exists.
 *
 * @param {string} syntax
 * @param {string} current
 * @returns {string | null}
 */
export function sentinelFor(syntax, current) {
  const parsed = parseSyntax(syntax)
  switch (parsed._tag) {
    case "Color": return "rgb(1, 2, 3)"
    case "Number": return {
      length: "4321px", number: "4321", integer: "4321", percentage: "43.21%", "length-percentage": "4321px",
      angle: "123deg", time: "4321ms", resolution: "43dppx", flex: "43fr",
    }[parsed.type] ?? null
    case "Idents": return parsed.options.find(option => option !== current.trim()) ?? null
    case "Any":
    case "Other": return "caliper-knockout"
  }
}

/** `--pico-pixel-rows` reads "Pixel rows": the first segment is usually the project's prefix. @param {string} name */
export function labelFor(name) {
  const segments = name.replace(/^--/, "").split("-").filter(Boolean)
  const words = segments.length > 1 ? segments.slice(1) : segments
  const text = words.join(" ")
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The tokens a reference picks among: `--p8-black` names the `--p8-` tokens. @param {string} token */
export function namespaceOf(token) {
  const first = /^--([^-]+)-/.exec(token)?.[1]
  return first === undefined ? "--" : `--${first}-`
}

const SIZE_FEATURE = /^(?:(min|max)-)?(width|height|inline-size|block-size)$/i
const LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?[a-z]+$/i
const COMPARISON = /^(?:<=|>=|<|>|=)$/
/** `30em < width` reads `width > 30em`. @type {Record<string, string>} */
const FLIPPED = { "<": ">", ">": "<", "<=": ">=", ">=": "<=", "=": "=" }
const NOT_A_NAME = /^(?:not|and|or|none)$/i

/**
 * The thresholds of a `@container` condition (decision 26): each length in a
 * size feature, with its place in the condition and a label. Lengths in a
 * `style()` or `scroll-state()` query are not thresholds, and neither is a
 * ratio or a unitless zero.
 *
 * @param {string} condition as written after `@container`
 * @returns {Array<{ start: number, end: number, text: string, label: string }>}
 */
export function thresholdsOf(condition) {
  const name = /^\s*([A-Za-z_-][\w-]*)\s+/.exec(condition)?.[1]
  const container = name === undefined || NOT_A_NAME.test(name) ? "Container" : labelFor(`--${name}`)
  /** @type {Array<{ start: number, end: number, text: string, label: string }>} */
  const found = []
  for (const group of condition.matchAll(/\(([^()]*)\)/g)) {
    const open = group.index ?? 0
    // A function's own parentheses, as in style(--gap: 10px), hold no size feature.
    if (/[\w-]/.test(condition.charAt(open - 1))) continue
    const tokens = [...(group[1] ?? "").matchAll(/<=|>=|<|>|=|:|[^\s<>=:]+/g)]
      .map(token => ({ text: token[0], start: open + 1 + (token.index ?? 0) }))
    const texts = tokens.map(token => token.text)
    if (texts.length === 3 && texts[1] === ":") {
      const feature = SIZE_FEATURE.exec(texts[0] ?? "")
      const value = /** @type {{ text: string, start: number }} */ (tokens[2])
      if (feature === null || !LENGTH.test(value.text)) continue
      const comparison = feature[1] === undefined ? "=" : feature[1].toLowerCase() === "min" ? ">=" : "<="
      found.push({ start: value.start, end: value.start + value.text.length, text: value.text, label: `${container} ${feature[2]?.toLowerCase()} ${comparison}` })
      continue
    }
    // A range: operands with a comparison between each pair.
    if (texts.length < 3 || texts.length % 2 === 0 || !texts.every((text, index) => (index % 2 === 1) === COMPARISON.test(text))) continue
    const at = texts.findIndex((text, index) => index % 2 === 0 && /^(width|height|inline-size|block-size)$/i.test(text))
    if (at === -1) continue
    const feature = (texts[at] ?? "").toLowerCase()
    tokens.forEach((token, index) => {
      if (index % 2 === 1 || index === at || !LENGTH.test(token.text)) return
      const comparison = index < at ? FLIPPED[texts[index + 1] ?? "="] : texts[index - 1]
      found.push({ start: token.start, end: token.start + token.text.length, text: token.text, label: `${container} ${feature} ${comparison}` })
    })
  }
  return found
}

/**
 * The condition with one threshold's length replaced, the rest as written.
 *
 * @param {string} condition
 * @param {number} index
 * @param {string} value
 */
export function replaceThreshold(condition, index, value) {
  const found = thresholdsOf(condition)[index]
  return found === undefined ? condition : `${condition.slice(0, found.start)}${value}${condition.slice(found.end)}`
}

/**
 * The declarations of a block's text, as `[property, value]`, without
 * `!important`. A semicolon inside a string or a function does not split.
 *
 * @param {string} text
 * @returns {Array<[string, string]>}
 */
export function declarationsIn(text) {
  /** @type {Array<[string, string]>} */
  const found = []
  let depth = 0
  /** @type {string | null} */
  let quote = null
  let start = 0
  const push = (/** @type {number} */ end) => {
    const chunk = text.slice(start, end)
    const colon = chunk.indexOf(":")
    if (colon > 0) found.push([chunk.slice(0, colon).trim(), chunk.slice(colon + 1).replace(/!\s*important\s*$/i, "").trim()])
  }
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index)
    if (quote !== null) {
      if (char === "\\") index++
      else if (char === quote) quote = null
    } else if (char === '"' || char === "'") quote = char
    else if (char === "(") depth++
    else if (char === ")") depth--
    else if (char === ";" && depth === 0) {
      push(index)
      start = index + 1
    }
  }
  push(text.length)
  return found
}

/**
 * Which properties name each custom property in a `var()`, from declaration
 * blocks: style rules, `@keyframes` frames and inline styles.
 *
 * @param {Iterable<string>} blocks
 * @returns {Map<string, Set<string>>}
 */
export function referenceGraph(blocks) {
  /** @type {Map<string, Set<string>>} */
  const graph = new Map()
  for (const block of blocks) {
    for (const [property, value] of declarationsIn(block)) {
      for (const match of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
        const name = /** @type {string} */ (match[1])
        const readers = graph.get(name) ?? new Set()
        readers.add(property)
        graph.set(name, readers)
      }
    }
  }
  return graph
}

/**
 * The standard longhands that read a custom property: those that name it in
 * a `var()`, directly or through other custom properties.
 *
 * @param {Map<string, Set<string>>} graph from `referenceGraph`
 * @param {string} name
 * @param {(property: string) => string[]} longhands a shorthand's longhands
 * @returns {string[]}
 */
export function readersOf(graph, name, longhands) {
  const seen = new Set([name])
  const queue = [name]
  /** @type {Set<string>} */
  const found = new Set()
  while (queue.length > 0) {
    const next = /** @type {string} */ (queue.shift())
    for (const property of graph.get(next) ?? []) {
      if (!property.startsWith("--")) for (const longhand of longhands(property)) found.add(longhand)
      else if (!seen.has(property)) {
        seen.add(property)
        queue.push(property)
      }
    }
  }
  return [...found]
}

/**
 * The syntax a plain custom property's control uses, read from its value.
 *
 * @param {string} value
 * @param {boolean} isColor whether the browser reads the value as a colour
 */
export function syntaxOfValue(value, isColor) {
  const number = parseNumber(value)
  if (number !== null) return number.unit === "" ? "<number>" : number.unit === "%" ? "<percentage>" : "<length>"
  return isColor ? "<color>" : "*"
}

const KEYWORD_COLOR = /^(currentcolor|transparent|inherit|initial|unset|revert|revert-layer)$/i

/**
 * The type of a literal: one length, percentage, number or colour, with no
 * `var()` and no math. Null for anything else, such as `12px 8px` or `auto`.
 *
 * @param {string} value
 * @param {boolean} isColor whether the browser reads the value as a colour
 * @returns {"length" | "percentage" | "number" | "color" | null}
 */
export function literalType(value, isColor) {
  const text = value.trim()
  if (/\bvar\(/i.test(text) || FORMULA.test(text)) return null
  const number = parseNumber(text)
  if (number !== null) return number.unit === "" ? "number" : number.unit === "%" ? "percentage" : "length"
  return isColor && !KEYWORD_COLOR.test(text) ? "color" : null
}

/**
 * Test values for knockout on a literal, in the order to try them: the
 * first one the property accepts and that differs from the literal.
 *
 * @param {"length" | "percentage" | "number" | "color"} type
 */
export function literalSentinels(type) {
  return {
    length: ["4321px", "3px"],
    percentage: ["43.21%", "3%"],
    number: ["4321", "0.4321", "3"],
    color: ["rgb(1, 2, 3)", "rgb(4, 5, 6)"],
  }[type]
}

/**
 * A name for the token a literal becomes: the namespace of the tokens beside
 * it, the rule's last class (or element) without that namespace, and the
 * property. The user confirms or changes it.
 *
 * @param {string} selector
 * @param {string} property
 * @param {string} namespace such as `--pico-`
 */
export function suggestTokenName(selector, property, namespace) {
  const last = selector.split(",").at(-1) ?? ""
  const compound = last.trim().split(/\s*[\s>+~]\s*/).at(-1) ?? ""
  const classes = [...compound.matchAll(/\.([\w-]+)/g)].map(match => match[1] ?? "")
  const subject = classes.at(-1) ?? /^[a-z][\w-]*/i.exec(compound)?.[0] ?? ""
  const prefix = namespace.replace(/^--/, "")
  const trimmed = prefix !== "" && subject.startsWith(prefix) ? subject.slice(prefix.length) : subject
  return `${namespace}${[trimmed, property].filter(Boolean).join("-")}`
}

/**
 * @param {...(KnobHints | undefined)} layers lowest first
 * @returns {KnobHints}
 */
export function mergeHints(...layers) {
  return Object.assign({}, ...layers.filter(Boolean))
}
