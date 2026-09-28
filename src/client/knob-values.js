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

/**
 * @param {...(KnobHints | undefined)} layers lowest first
 * @returns {KnobHints}
 */
export function mergeHints(...layers) {
  return Object.assign({}, ...layers.filter(Boolean))
}
