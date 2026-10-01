// @ts-check
import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Check } from "typebox/value"
import { readPart } from "../src/derive/parts.js"
import { compareRenders, approveBaselines } from "../src/render/checks.js"
import { CheckReportSchema } from "../src/render/check-contract.js"
import { checkDetail, summarizeChecks } from "../src/client/checks-view.js"

const partFile = "src/Example.part.tsx"
const component = "export default function Example() { return null }; export function Empty() { return null };\n"
/** @param {string} declaration */
const read = declaration => readPart("/unused", partFile, component + declaration)

test("literal expectations stay product metadata and do not create states or run code", () => {
  const part = read(`throw new Error('must not run');
export const expectations = {
  Empty: { empty: { reason: "No results means no panel." } },
  default: {
    spill: [{ target: "#caliper-host > div:nth-of-type(1)", edge: "bottom", maxPixels: 200, reason: "Scroll area." }],
    accessibility: [{ rule: "color-contrast", target: [".caption"], reason: "Recorded palette exception." }],
  },
} as const`)
  expect(part.expectationProblems).toBeUndefined()
  expect(part.expectations?.Empty?.empty?.reason).toBe("No results means no panel.")
  expect(part.states.map(state => state.export)).toEqual(["default", "Empty"])
  expect(read("export const note = 'nothing';").expectations).toBeUndefined()
})

test("invalid declarations are visible and accept nothing", () => {
  for (const declaration of [
    "export let expectations = {}",
    "export const expectations = makeIntent()",
    "export const expectations = { ...intent }",
    "export const expectations = { Empty: { empty: { reason } } }",
    "export const expectations = { Empty: { empty: { reason: '' } } }",
    "export const expectations = { Empty: { empty: { reason: '   ' } } }",
    "export const expectations = { Missing: { empty: { reason: 'typo' } } }",
    "export const expectations = { Empty: { empty: { reason: 'x' }, unknown: 'x' } }",
    "export const expectations = { Empty: {} }",
    "export const expectations = { Empty: { spill: [] } }",
    "export const expectations = { Empty: { spill: [{ target: 'a', edge: 'bottom', maxPixels: 0, reason: 'x' }] } }",
    "export const expectations = { Empty: { spill: [{ target: 'a', edge: 'bottom', maxPixels: -1, reason: 'x' }] } }",
    "export const expectations = { Empty: { spill: [{ target: 'a', edge: 'both', maxPixels: 10, reason: 'x' }] } }",
    "export const expectations = { Empty: { accessibility: [{ rule: 'color-contrast', target: [], reason: 'x' }] } }",
    "export const expectations = { Empty: { accessibility: [{ rule: 'color-contrast', reason: 'x' }] } }",
    "export const expectations = { Empty: { empty: { reason: 'x' } }, Empty: { empty: { reason: 'y' } } }",
    "export const expectations = {}; export const expectations = {}",
    "export { data as expectations } from './intent'",
    "export * as expectations from './intent'",
    "export function expectations() {}",
    "export class expectations {}",
    "export const { expectations } = intent",
  ]) {
    const part = read(declaration)
    expect(part.expectations).toBeUndefined()
    expect(part.expectationProblems?.length).toBeGreaterThan(0)
    expect(part.expectationProblems?.[0]).toContain(`${partFile}:`)
  }
  expect(read("export type expectations = {};").expectationProblems).toBeUndefined()
})

test("axe shadow targets preserve their nested selector identity", () => {
  const part = read('export const expectations = { default: { accessibility: [{ rule: "button-name", target: [["#shadow", "button"]], reason: "Scoped shadow exception" }] } }')
  expect(part.expectationProblems).toBeUndefined()
  expect(part.expectations?.default?.accessibility?.[0]?.target).toEqual([["#shadow", "button"]])
})

test("duplicate target rules cannot inflate exception counts or broaden limits", () => {
  const rule = '{ target: "a", edge: "bottom", maxPixels: 20, reason: "scroll" }'
  expect(read(`export const expectations = { default: { spill: [${rule}, ${rule}] } }`).expectationProblems?.[0]).toContain("repeats")
})

/** @param {(samples: import('../src/render/render.js').RenderResult[], report: () => import('../src/render/check-contract.js').CheckReport, root: string) => void} run */
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "caliper-intent-"))
  const samples = ["first", "repeat"].map(name => {
    const png = join(root, `${name}.png`)
    writeFileSync(png, "same image")
    return /** @type {import('../src/render/render.js').RenderResult} */ ({ part: partFile, state: "default", device: "iphone-16", viewport: { width: 640, height: 480 }, frame: "Rendered", png, problems: [], console: [], spill: null, environment: "test", accessibility: { _tag: "Complete", violations: [], incomplete: [] } })
  })
  const report = () => compareRenders({ project: "intent", first: [samples[0]], second: [samples[1]] })
  try { run(samples, report, root) } finally { rmSync(root, { recursive: true, force: true }) }
}
/** @param {import('../src/render/check-contract.js').CheckReport} report @param {string} name */
const check = (report, name) => {
  const result = report.results[0]?.checks.find(result => result.name === name)
  if (!result) throw new Error(`Missing check ${name}`)
  return result
}
const accessibilityRule = { rule: "color-contrast", target: [".caption"], reason: "Palette decision remains an accessibility exception." }
const finding = { id: "color-contrast", impact: "serious", help: "Increase contrast", url: "https://example.org", nodes: [{ target: '[".caption"]', summary: "Contrast 3.3:1" }] }

test("declared empty passes only on two genuine empty observations; failures stay failures", () => fixture((samples, report, root) => {
  for (const sample of samples) {
    sample.expectations = { empty: { reason: "No panel in this state." } }
    sample.frame = "Empty"
    sample.problems = [{ kind: "warning", title: `${partFile} rendered nothing: its component returned null or an empty tree.`, detail: "" }]
  }
  expect(check(report(), "render").status).toBe("Passed")
  expect(check(report(), "render").detail).toContain("No panel")
  const saved = join(root, "report.json")
  writeFileSync(saved, JSON.stringify(report()))
  expect(approveBaselines(saved, join(root, "baselines")).approved).toBe(1)
  samples[1].frame = "Rendered"
  samples[1].problems = []
  expect(check(report(), "render").status).toBe("Failed")
  samples[1].frame = "Failed"
  expect(check(report(), "render").status).toBe("Failed")
}))

test("accessibility exceptions preserve evidence, count once across samples, and stay distinct from passes", () => fixture((samples, report) => {
  for (const sample of samples) {
    sample.expectations = { accessibility: [accessibilityRule] }
    sample.accessibility = { _tag: "Complete", violations: [finding], incomplete: [] }
  }
  const result = check(report(), "accessibility")
  expect(result.status).toBe("Accepted")
  expect(result.accepted).toHaveLength(1)
  expect(result.detail).toContain("3.3:1")
  expect(checkDetail(result)).toContain(accessibilityRule.reason)
  expect(checkDetail(result)).toContain("Increase contrast")
  expect(Check(CheckReportSchema, report())).toBe(true)
  expect(summarizeChecks([result]).status).toBe("Accepted")
  expect(summarizeChecks([result]).label).toContain("1 accepted exception")
  expect(summarizeChecks([{ name: "browser", status: "Failed", detail: "bad" }, result]).status).toBe("Failed")
}))

test("an exception never accepts a new node, another rule, or uncertain audits", () => fixture((samples, report) => {
  for (const sample of samples) {
    sample.expectations = { accessibility: [accessibilityRule] }
    sample.accessibility = { _tag: "Complete", violations: [finding], incomplete: [] }
  }
  samples[1].accessibility = { _tag: "Complete", violations: [finding, { ...finding, nodes: [{ target: '[".other"]', summary: "New contrast failure" }] }], incomplete: [] }
  expect(check(report(), "accessibility").status).toBe("Failed")
  expect(check(report(), "accessibility").accepted).toHaveLength(1)
  samples[1].accessibility = { _tag: "Complete", violations: [{ ...finding, id: "button-name" }], incomplete: [] }
  expect(check(report(), "accessibility").status).toBe("Failed")
  samples[1].accessibility = { _tag: "Unavailable", reason: "no axe" }
  expect(check(report(), "accessibility").status).toBe("Inconclusive")
  samples[1].accessibility = { _tag: "Complete", violations: [], incomplete: [finding] }
  expect(check(report(), "accessibility").status).toBe("Review")
  samples[0].frame = "Failed"
  expect(check(report(), "accessibility").status).toBe("Inconclusive")
}))

test("unused exceptions ask for removal instead of silently surviving a fixed finding", () => fixture((samples, report) => {
  for (const sample of samples) sample.expectations = { accessibility: [accessibilityRule] }
  const result = check(report(), "accessibility")
  expect(result.status).toBe("Review")
  expect(result.accepted).toEqual([])
  expect(checkDetail(result)).toContain("Unused declaration")
  expect(result.unmatched?.[0]).toContain(".caption")
}))

test("spill exceptions cover every measured element and edge within an explicit limit", () => fixture((samples, report) => {
  const target = "#caliper-host > div:nth-of-type(1)"
  for (const sample of samples) {
    sample.expectations = { spill: [{ target, edge: "bottom", maxPixels: 100, reason: "Local scroll region." }] }
    sample.spill = { left: 0, top: 0, right: 640, bottom: 560, complete: true, elements: [{ element: "div", target, left: 0, top: 0, right: 640, bottom: 560 }] }
  }
  expect(check(report(), "spill").status).toBe("Accepted")
  expect(check(report(), "spill").accepted).toHaveLength(1)
  const spill = samples[1].spill
  if (!spill) throw new Error("fixture spill")
  spill.elements[0].bottom = 581
  expect(check(report(), "spill").status).toBe("Review")
  spill.elements[0].bottom = 560
  spill.elements[0].right = 650
  expect(check(report(), "spill").status).toBe("Review")
  spill.elements[0].right = 640
  spill.elements.push({ element: "div", target: "another target", left: 0, top: 0, right: 650, bottom: 480 })
  expect(check(report(), "spill").status).toBe("Review")
  spill.complete = false
  expect(check(report(), "spill").status).toBe("Inconclusive")
  samples[0].spill = samples[1].spill = null
  expect(check(report(), "spill").status).toBe("Review")
}))

test("invalid or changed declarations accept nothing and leave raw failures visible", () => fixture((samples, report) => {
  for (const sample of samples) {
    sample.accessibility = { _tag: "Complete", violations: [finding], incomplete: [] }
    sample.expectations = { accessibility: [accessibilityRule] }
  }
  samples[1].expectationProblems = ["Example.part.tsx:2: invalid state"]
  expect(check(report(), "expectations").status).toBe("Failed")
  expect(check(report(), "accessibility").status).toBe("Failed")
  expect(check(report(), "accessibility").accepted).toBeUndefined()
  delete samples[1].expectationProblems
  delete samples[1].expectations
  expect(check(report(), "expectations").status).toBe("Inconclusive")
  expect(check(report(), "accessibility").status).toBe("Failed")
  expect(Check(CheckReportSchema, report())).toBe(true)
}))
