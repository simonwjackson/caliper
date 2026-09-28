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
