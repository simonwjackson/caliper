// @ts-check
import { Check, Errors } from "typebox/value"
import { ExpectationsSchema } from "../expectation-contract.js"
import { readLiteralExport } from "./literal-export.js"

/**
 * Invalid intent accepts nothing. A typo in a state, rule or target must remain
 * visible rather than silently broadening the exception.
 * @param {string} file
 * @param {string} source
 * @param {readonly import('../types').PartState[]} states
 * @returns {Pick<import('../types').Part, 'expectations' | 'expectationProblems'>}
 */
export function readExpectations(file, source, states) {
  const parsed = readLiteralExport(file, source, "expectations")
  if (parsed._tag === "Absent") return {}
  if (parsed._tag === "Invalid") return { expectationProblems: parsed.problems }
  const value = parsed.value
  if (!Check(ExpectationsSchema, value)) return {
    expectationProblems: [...Errors(ExpectationsSchema, value)].map(error => `${parsed.at}: expectations ${error.instancePath}: ${error.message}`),
  }
  const problems = []
  for (const [state, expectation] of Object.entries(value)) {
    if (!states.some(item => item.export === state)) problems.push(`${parsed.at}: expectations.${state} names a state the part does not export.`)
    const keys = [
      ...(expectation.spill ?? []).map(rule => JSON.stringify(["spill", rule.target, rule.edge])),
      ...(expectation.accessibility ?? []).map(rule => JSON.stringify(["accessibility", rule.target, rule.rule])),
    ]
    if (new Set(keys).size !== keys.length) problems.push(`${parsed.at}: expectations.${state} repeats a target and rule.`)
  }
  return problems.length ? { expectationProblems: problems } : { expectations: value }
}
