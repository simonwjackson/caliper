// @ts-check
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { approveBaselines, compareRenders } from "../src/render/checks.js"

/** @param {(root: string, sample: (name: string, bytes?: string) => import('../src/render/render.js').RenderResult) => void} run */
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "caliper-checks-"))
  /** @param {string} name @param {string} [bytes] @returns {import('../src/render/render.js').RenderResult} */
  const sample = (name, bytes = "image") => {
    const png = join(root, `${name}.png`)
    writeFileSync(png, bytes)
    return { part: "src/Button.part.tsx", state: "default", device: "rg353m", viewport: { width: 640, height: 480 }, frame: "Rendered", png,
      problems: [], console: [], spill: null, environment: "chromium:123;linux:x64;dpr:1;axe:4;checks:1",
      accessibility: { _tag: "Complete", violations: [], incomplete: [] } }
  }
  try { run(root, sample) } finally { rmSync(root, { recursive: true, force: true }) }
}
/** @param {import('../src/render/check-contract.js').CheckReport} report @param {string} name */
const status = (report, name) => report.results[0]?.checks.find(check => check.name === name)?.status
/** @param {string} root @param {import('../src/render/check-contract.js').CheckReport} report */
const save = (root, report) => { const path = join(root, "report.json"); writeFileSync(path, JSON.stringify(report)); return path }

test("checks distinguish a stable render from an unconfigured baseline", () => fixture((_root, sample) => {
  const report = compareRenders({ project: "app", first: [sample("first")], second: [sample("repeat")] })
  expect(report.results[0]?.checks.map(check => check.status)).toEqual(["Passed", "Passed", "Passed", "Passed", "Passed", "NotRun"])
  expect(report.coverage).toContain("do not prove interactions")
}))

test("approval uses saved images, matches later checks, and preserves changed images for review", () => fixture((root, sample) => {
  const baselines = join(root, "baselines")
  const first = [sample("first")], second = [sample("repeat")]
  const report = compareRenders({ project: "app", first, second, baselines })
  expect(status(report, "baseline")).toBe("Review")
  expect(approveBaselines(save(root, report), baselines).approved).toBe(1)
  expect(status(compareRenders({ project: "app", first, second, baselines }), "baseline")).toBe("Passed")
  expect(status(compareRenders({ project: "app", first: [sample("changed", "changed")], second: [sample("changed-repeat", "changed")], baselines }), "baseline")).toBe("Review")
  expect(status(compareRenders({ project: "another app", first, second, baselines }), "baseline")).toBe("Review")
}))

test("unstable and broken samples cannot establish determinism or become baselines", () => fixture((root, sample) => {
  const first = sample("first"), second = sample("repeat", "different")
  let report = compareRenders({ project: "app", first: [first], second: [second] })
  expect(status(report, "determinism")).toBe("Inconclusive")
  expect(status(report, "baseline")).toBe("Inconclusive")
  expect(() => approveBaselines(save(root, report), join(root, "baselines"))).toThrow("unstable")
  second.console.push("late browser error")
  report = compareRenders({ project: "app", first: [first], second: [second] })
  expect(status(report, "browser")).toBe("Failed")
  first.frame = "Failed"
  expect(status(compareRenders({ project: "app", first: [first], second: [second] }), "render")).toBe("Failed")
}))

test("empty and scrolling states need review, not an invented assertion of intent", () => fixture((root, sample) => {
  const first = sample("first"), second = sample("repeat")
  for (const item of [first, second]) {
    item.frame = "Empty"
    item.problems = [{ kind: "warning", title: `${item.part} rendered nothing: its component returned null or an empty tree.`, detail: "" }]
    item.spill = { left: 0, top: 0, right: 640, bottom: 900, elements: [] }
  }
  const baselines = join(root, "baselines")
  const report = compareRenders({ project: "app", first: [first], second: [second], baselines })
  expect(status(report, "render")).toBe("Review")
  expect(status(report, "spill")).toBe("Review")
  approveBaselines(save(root, report), baselines)
  const approved = compareRenders({ project: "app", first: [first], second: [second], baselines })
  expect(status(approved, "baseline")).toBe("Passed")
  expect(status(approved, "render")).toBe("Review")
  second.problems.push({ kind: "warning", title: "Missing global CSS", detail: "" })
  expect(status(compareRenders({ project: "app", first: [first], second: [second] }), "render")).toBe("Failed")
}))

test("accessibility reports unavailable, incomplete, and violations from either sample", () => fixture((_root, sample) => {
  const first = sample("first"), second = sample("repeat")
  const check = () => compareRenders({ project: "app", first: [first], second: [second] })
  second.accessibility = { _tag: "Unavailable", reason: "axe timed out" }
  expect(status(check(), "accessibility")).toBe("Inconclusive")
  const finding = { id: "button-name", impact: "critical", help: "Name the button", url: "https://example.org", nodes: [{ target: "button", summary: "Missing name" }] }
  second.accessibility = { _tag: "Complete", violations: [], incomplete: [finding] }
  expect(status(check(), "accessibility")).toBe("Review")
  second.accessibility.violations.push(finding)
  expect(status(check(), "accessibility")).toBe("Failed")
  expect(check().results[0]?.checks.find(check => check.name === "accessibility")?.detail).toContain("button-name")
}))

test("a failed render cannot pass accessibility or layout checks", () => fixture((_root, sample) => {
  const first = sample("first"), second = sample("repeat")
  first.frame = "Failed"
  let report = compareRenders({ project: "app", first: [first], second: [second] })
  expect(status(report, "accessibility")).toBe("Inconclusive")
  expect(status(report, "spill")).toBe("Inconclusive")
  first.accessibility = { _tag: "Complete", violations: [{ id: "button-name", impact: "critical", help: "Name the button", url: "https://example.org", nodes: [] }], incomplete: [] }
  report = compareRenders({ project: "app", first: [first], second: [second] })
  expect(status(report, "accessibility")).toBe("Failed")
}))

test("approval refuses take evidence and changed screenshot bytes", () => fixture((root, sample) => {
  const first = sample("first"), second = sample("repeat")
  const report = compareRenders({ project: "app", first: [first], second: [second] })
  writeFileSync(first.png, "new bytes")
  expect(() => approveBaselines(save(root, report), join(root, "baselines"))).toThrow("images changed")
  const take = compareRenders({ project: "app", first: [{ ...sample("take"), take: "1" }], second: [{ ...sample("take-repeat"), take: "1" }] })
  expect(() => approveBaselines(save(root, take), join(root, "baselines"))).toThrow("Take images")
}))

test("environment changes and corrupt baselines are inconclusive, never passes", () => fixture((root, sample) => {
  const baselines = join(root, "baselines")
  const first = sample("first"), second = sample("repeat")
  approveBaselines(save(root, compareRenders({ project: "app", first: [first], second: [second] })), baselines)
  first.environment = second.environment = "other browser"
  expect(status(compareRenders({ project: "app", first: [first], second: [second], baselines }), "baseline")).toBe("Inconclusive")
  const record = readdirSync(baselines).find(file => file.endsWith(".json"))
  expect(record).toBeDefined()
  writeFileSync(join(baselines, /** @type {string} */ (record)), "{}")
  expect(status(compareRenders({ project: "app", first: [first], second: [second], baselines }), "baseline")).toBe("Inconclusive")
}))

test("checks reject empty, duplicate, missing and mismatched-environment coverage", () => fixture((_root, sample) => {
  const first = sample("first"), second = sample("repeat")
  expect(() => compareRenders({ project: "app", first: [], second: [] })).toThrow("nonempty")
  expect(() => compareRenders({ project: "app", first: [first, first], second: [second, second] })).toThrow("duplicates")
  expect(() => compareRenders({ project: "app", first: [first], second: [{ ...second, state: "Missing" }] })).toThrow("same nonempty")
  expect(() => compareRenders({ project: "app", first: [first], second: [{ ...second, environment: "changed" }] })).toThrow("environment")
}))

test("a failed multi-state approval leaves existing accepted records untouched", () => fixture((root, sample) => {
  const baselines = join(root, "baselines")
  mkdirSync(baselines)
  const first = sample("first"), second = sample("repeat")
  const report = compareRenders({ project: "app", first: [first], second: [second] })
  approveBaselines(save(root, report), baselines)
  const record = join(baselines, /** @type {string} */ (readdirSync(baselines).find(file => file.endsWith(".json"))))
  const before = readFileSync(record, "utf8")
  const changed = sample("changed", "new"), changedRepeat = sample("changed-repeat", "new")
  const broken = sample("broken"), brokenRepeat = sample("broken-repeat")
  broken.state = brokenRepeat.state = "Broken"
  broken.frame = "Failed"
  const next = compareRenders({ project: "app", first: [changed, broken], second: [changedRepeat, brokenRepeat] })
  expect(() => approveBaselines(save(root, next), baselines)).toThrow("broken")
  expect(readFileSync(record, "utf8")).toBe(before)
}))
