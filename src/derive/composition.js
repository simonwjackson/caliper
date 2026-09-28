// @ts-check
import { readLiteralExport } from "./literal-export.js"
import { Check } from "typebox/value"
import { CompositionSchema } from "../scenario-contract.js"
import { sameState, stateExists, subjectsOf } from "../client/scenarios.js"

/** @typedef {import("../types").Part} Part */

/**
 * Read literal composition metadata without evaluating any project code.
 * An unsupported declaration is different from an absent declaration.
 *
 * @param {string} file
 * @param {string} source
 * @returns {Pick<Part, "composition" | "compositionProblems">}
 */
export function readComposition(file, source) {
  const parsed = readLiteralExport(file, source, "composition")
  if (parsed._tag === "Absent") return {}
  if (parsed._tag === "Invalid") return { compositionProblems: parsed.problems }
  if (!Check(CompositionSchema, parsed.value)) return {
    compositionProblems: [`${parsed.at}: composition must map state exports to arrays of { part: "root-relative.part.tsx", state: "export" } with no extra fields.`],
  }
  return { composition: parsed.value }
}

/** @param {string} path */
function safePartPath(path) {
  return !/[\\:#?\u0000]/.test(path) && path.endsWith(".part.tsx")
    && path.split("/").every(segment => segment !== "" && segment !== "." && segment !== ".." && !["node_modules", ".git", ".caliper"].includes(segment))
}

/**
 * Validate after discovering all parts. Invalid declarations supply no
 * relationships; their errors remain available to Setup and the frame.
 *
 * @param {readonly Part[]} parts
 * @returns {Part[]}
 */
export function validateCompositions(parts) {
  const checked = parts.map(part => {
    if (part.composition === undefined) return part
    /** @type {string[]} */
    const problems = []
    for (const [state, children] of Object.entries(part.composition)) {
      const parent = { part: part.file, state }
      const at = `${part.file}: composition.${state}`
      if (!stateExists(parts, parent)) problems.push(`${at} names a state the part does not export.`)
      const seen = new Set()
      for (const child of children) {
        if (!safePartPath(child.part)) problems.push(`${at} has unsafe part path "${child.part}". Use a Vite-root-relative part path without traversal or URL syntax.`)
        else if (!parts.some(part => part.file === child.part)) problems.push(`${at} names missing part "${child.part}".`)
        else if (!stateExists(parts, child)) problems.push(`${at} names missing state "${child.state}" in ${child.part}.`)
        if (sameState(parent, child)) problems.push(`${at} cannot contain itself.`)
        const key = JSON.stringify([child.part, child.state])
        if (seen.has(key)) problems.push(`${at} repeats ${child.part} state "${child.state}". Declare each child state once, even when several instances use it.`)
        seen.add(key)
      }
    }
    return problems.length === 0 ? part : invalid(part, problems)
  })
  return checked.map(part => {
    if (part.composition === undefined) return part
    const problems = Object.entries(part.composition).flatMap(([state, children]) => {
      const parent = { part: part.file, state }
      return children.filter(child => subjectsOf(checked, child).some(descendant => sameState(descendant, parent)))
        .map(child => `${part.file}: composition.${state} forms a cycle through ${child.part} state "${child.state}".`)
    })
    return problems.length === 0 ? part : invalid(part, problems)
  })
}

/** @param {Part} part @param {string[]} problems @returns {Part} */
function invalid(part, problems) {
  const { composition: _composition, ...rest } = part
  return { ...rest, compositionProblems: [...(part.compositionProblems ?? []), ...problems] }
}
