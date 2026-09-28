// @ts-check
import { Check } from "typebox/value"
import { StateExpectationsSchema } from "../expectation-contract.js"

/** @typedef {import('./render.js').RenderResult} Sample */
/** @typedef {import('./check-contract.js').CheckResult} Result */
/** @typedef {NonNullable<Result['accepted']>[number]} Accepted */

/**
 * Keep raw evidence in detail. Exceptions classify only exact observed targets;
 * they cannot waive missing evidence, browser errors, or render failures.
 * @param {Sample[]} samples
 * @param {Result[]} checks
 * @param {boolean} broken
 */
export function applyExpectations(samples, checks, broken) {
  const problems = samples.flatMap(sample => sample.expectationProblems ?? [])
  if (samples.some(sample => sample.expectations !== undefined && !Check(StateExpectationsSchema, sample.expectations))) problems.push("Invalid expectation data. No exceptions applied.")
  if (problems.length) {
    checks.push({ name: "expectations", status: "Failed", detail: [...new Set(problems)].join("\n") })
    return
  }
  if (samples.some(sample => JSON.stringify(sample.expectations) !== JSON.stringify(samples[0]?.expectations))) {
    checks.push({ name: "expectations", status: "Inconclusive", detail: "Product expectations changed between samples. No exceptions applied. Run checks again without editing files." })
    return
  }
  const expectation = samples[0]?.expectations
  if (!expectation) return
  const render = checks.find(check => check.name === "render")
  if (expectation.empty && render && !broken) {
    const empty = samples.every(sample => sample.frame === "Empty")
    render.status = empty ? "Passed" : "Failed"
    render.detail = `${empty ? "Both samples are empty as declared." : "Expected empty content, but at least one sample rendered content."}\nReason: ${expectation.empty.reason}`
  }
  const spill = checks.find(check => check.name === "spill")
  if (expectation.spill && spill) classifySpill(samples, spill, expectation.spill, broken)
  const accessibility = checks.find(check => check.name === "accessibility")
  if (expectation.accessibility && accessibility) classifyAccessibility(samples, accessibility, expectation.accessibility, broken)
}

/** @param {Result} result @param {Accepted[]} rules @param {Set<number>} matched */
function recordMatches(result, rules, matched) {
  result.accepted = rules.filter((_rule, index) => matched.has(index))
  result.unmatched = rules.filter((_rule, index) => !matched.has(index)).map(rule => `${rule.rule} at ${rule.target}: ${rule.reason}`)
}

/** @param {Sample[]} samples @param {Result} check @param {NonNullable<import('../expectation-contract.js').StateExpectations['spill']>} rules @param {boolean} broken */
function classifySpill(samples, check, rules, broken) {
  const matched = new Set()
  let unresolved = false
  let unavailable = false
  for (const sample of samples) {
    if (!sample.spill) continue
    // Older/truncated measurements cannot establish an exception's coverage.
    if (!sample.spill.complete || !sample.spill.elements.length) { unavailable = true; continue }
    for (const element of sample.spill.elements) {
      const edges = { left: -element.left, top: -element.top, right: element.right - sample.viewport.width, bottom: element.bottom - sample.viewport.height }
      for (const [edge, pixels] of Object.entries(edges)) {
        if (pixels <= 0.5) continue
        const index = rules.findIndex(rule => rule.target === element.target && rule.edge === edge && pixels <= rule.maxPixels)
        if (index < 0) unresolved = true
        else matched.add(index)
      }
    }
  }
  recordMatches(check, rules.map(rule => ({ rule: `${rule.edge} spill ≤ ${rule.maxPixels} CSS px`, target: rule.target, reason: rule.reason })), matched)
  check.status = broken || unavailable ? "Inconclusive" : unresolved || check.unmatched?.length ? "Review" : matched.size ? "Accepted" : "Passed"
}

/** @param {Sample[]} samples @param {Result} check @param {NonNullable<import('../expectation-contract.js').StateExpectations['accessibility']>} rules @param {boolean} broken */
function classifyAccessibility(samples, check, rules, broken) {
  const matched = new Set()
  let unresolved = false
  let unavailable = false
  let incomplete = false
  for (const sample of samples) {
    const audit = sample.accessibility
    if (audit?._tag !== "Complete") { unavailable = true; continue }
    incomplete ||= audit.incomplete.length > 0
    for (const finding of audit.violations) {
      if (!finding.nodes.length) unresolved = true
      for (const node of finding.nodes) {
        const index = rules.findIndex(rule => rule.rule === finding.id && JSON.stringify(rule.target) === node.target)
        if (index < 0) unresolved = true
        else matched.add(index)
      }
    }
  }
  recordMatches(check, rules.map(rule => ({ rule: rule.rule, target: JSON.stringify(rule.target), reason: rule.reason })), matched)
  check.status = unresolved ? "Failed" : broken || unavailable ? "Inconclusive" : incomplete || check.unmatched?.length ? "Review" : matched.size ? "Accepted" : "Passed"
}
