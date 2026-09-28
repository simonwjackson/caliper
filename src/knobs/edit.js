// @ts-check
import { createHash } from "node:crypto"

/**
 * One knob write: replace the value of one declaration, and only in the text
 * the knob was located in. The version is the precondition; a file that
 * changed since then gets no write, because its offsets may have moved.
 *
 * @typedef {{ version: string, start: number, end: number, expected: string, value: string }} KnobEdit
 * @typedef {{ _tag: "Edited", text: string } | { _tag: "Conflict", reason: string }} EditResult
 */

/**
 * The version of a file's text, as the knobs API names it.
 *
 * @param {string} text
 */
export function versionOf(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16)
}

/**
 * @param {string} text the file as it is now
 * @param {KnobEdit} edit
 * @returns {EditResult}
 */
export function editSource(text, edit) {
  if (versionOf(text) !== edit.version) {
    return { _tag: "Conflict", reason: "The file changed after the knob read it. Caliper did not write your value." }
  }
  if (text.slice(edit.start, edit.end) !== edit.expected) {
    return { _tag: "Conflict", reason: "The declaration is not where the knob found it. Caliper did not write your value." }
  }
  return { _tag: "Edited", text: `${text.slice(0, edit.start)}${edit.value}${text.slice(edit.end)}` }
}

/**
 * The edits that promote a literal to a token (decision 26): a new
 * declaration `name: literal` goes after the anchor, a custom property
 * declaration in the rule the user chose, and `var(name)` replaces the
 * literal. Both spans carry the version of their file; a file that changed
 * since gets no edit, and neither file is written.
 *
 * @typedef {{ file: string, version: string, start: number, end: number, expected: string }} Span
 * @param {{ texts: Map<string, string>, name: string, literal: Span, home: Span }} input
 *   `texts` holds each file as it is now
 * @returns {{ _tag: "Edited", texts: Map<string, string> } | { _tag: "Conflict", reason: string }}
 */
export function promoteSource({ texts, name, literal, home }) {
  for (const span of [literal, home]) {
    const text = texts.get(span.file) ?? ""
    if (versionOf(text) !== span.version) return { _tag: "Conflict", reason: `${span.file} changed after the knob read it. Caliper did not create the token.` }
    if (text.slice(span.start, span.end) !== span.expected) return { _tag: "Conflict", reason: `The declaration in ${span.file} is not where the knob found it. Caliper did not create the token.` }
  }
  const homeText = texts.get(home.file) ?? ""
  const escaped = name.replace(/[-]/g, "\\-")
  if (new RegExp(`(^|[{;\\s])${escaped}\\s*:`).test(homeText)) return { _tag: "Conflict", reason: `${home.file} already declares ${name}. Pick another name.` }
  let at = home.end
  while (homeText.charAt(at) === " " || homeText.charAt(at) === "\t") at++
  const closed = homeText.charAt(at) === ";"
  const lineStart = homeText.lastIndexOf("\n", home.start - 1) + 1
  const indent = /^[ \t]*/.exec(homeText.slice(lineStart))?.[0] ?? ""
  /** @type {Array<{ file: string, start: number, end: number, text: string }>} */
  const edits = [
    closed
      ? { file: home.file, start: at + 1, end: at + 1, text: `\n${indent}${name}: ${literal.expected};` }
      : { file: home.file, start: home.end, end: home.end, text: `;\n${indent}${name}: ${literal.expected}` },
    { file: literal.file, start: literal.start, end: literal.end, text: `var(${name})` },
  ]
  const [first, second] = edits
  if (first && second && first.file === second.file && first.start < second.end && second.start < first.end) {
    return { _tag: "Conflict", reason: "The token cannot go inside the literal it replaces." }
  }
  const next = new Map(texts)
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    const text = next.get(edit.file) ?? ""
    next.set(edit.file, `${text.slice(0, edit.start)}${edit.text}${text.slice(edit.end)}`)
  }
  return { _tag: "Edited", texts: next }
}

/**
 * Why a value cannot go into a declaration as it is, or null. A value that
 * ends the declaration or the rule would change more than one knob.
 *
 * @param {string} value
 * @returns {string | null}
 */
export function valueProblem(value) {
  if (value.trim() === "") return "The value is empty."
  if (value !== value.trim()) return "The value starts or ends with a space."
  if (/[;{}\n\r]|!important|\/\*/i.test(value)) return `"${value}" would change more than this declaration.`
  let depth = 0
  for (const char of value) {
    if (char === "(") depth++
    if (char === ")") depth--
    if (depth < 0) break
  }
  if (depth !== 0) return `"${value}" has unbalanced parentheses.`
  return null
}
