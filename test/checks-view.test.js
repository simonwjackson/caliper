// @ts-check
import { expect, test } from "bun:test"
import { canApproveImage, checkDetail, planChecks, reconcileChecks, summarizeChecks } from "../src/client/checks-view.js"

test("checks comparison responds to independent width and height constraints", () => {
  expect(planChecks(80, 60)).toEqual({ columns: 3, compact: false })
  expect(planChecks(42, 40)).toEqual({ columns: 2, compact: false })
  expect(planChecks(20, 60)).toEqual({ columns: 1, compact: false })
  expect(planChecks(80, 12)).toEqual({ columns: 3, compact: true })
  expect(planChecks(18, 18)).toEqual({ columns: 1, compact: true })
  expect(planChecks(35.99, 24).columns).toBe(1)
  expect(planChecks(36, 24).columns).toBe(2)
  expect(planChecks(55.99, 24).columns).toBe(2)
  expect(planChecks(56, 24).columns).toBe(3)
  expect(planChecks(80, 23.99).compact).toBe(true)
  expect(planChecks(80, 24).compact).toBe(false)
})

test("a late HTTP acknowledgement cannot hide a setup failure received over SSE", () => {
  /** @type {import('../src/checks/contract.js').ChecksView} */
  const failed = { _tag: "Failed", id: "run-one", request: { part: "Button.part.tsx", state: "default" }, reason: "Set CHROMIUM" }
  /** @type {import('../src/checks/contract.js').ChecksView} */
  const running = { _tag: "Running", id: "run-one", request: failed.request, total: 2, startedAt: "now" }
  expect(reconcileChecks(failed, running)).toEqual(failed)
  expect(reconcileChecks(running, failed)).toEqual(failed)
  expect(reconcileChecks(failed, { ...running, id: "run-two" })._tag).toBe("Running")
})

test("visible summaries never turn missing or inconclusive checks into passes", () => {
  expect(summarizeChecks([]).label).toBe("Not checked")
  expect(summarizeChecks([{ name: "baseline", status: "NotRun", detail: "" }]).status).toBe("NotRun")
  expect(summarizeChecks([{ name: "render", status: "Passed", detail: "" }, { name: "baseline", status: "Inconclusive", detail: "" }]).status).toBe("Inconclusive")
  const summary = summarizeChecks([{ name: "render", status: "Failed", detail: "" }, { name: "spill", status: "Review", detail: "" }])
  expect(summary.label).toBe("1 failed")
  expect(summary.detail).toContain("1 need review")
})

test("accessibility findings use plain text and do not repeat the same rule for two samples", () => {
  const audit = { _tag: "Complete", violations: [{ id: "button-name", help: "Buttons must have discernible text", impact: "critical", nodes: [{ target: "button", summary: "Add an accessible name" }], url: "https://example.org/rule" }], incomplete: [] }
  const text = checkDetail({ name: "accessibility", status: "Failed", detail: JSON.stringify([audit, audit]) })
  expect(text).toContain("Buttons must have discernible text")
  expect(text).toContain("button-name · critical")
  expect(text.split("Add an accessible name")).toHaveLength(2)
  expect(text).not.toContain('"_tag"')
})

test("visual approval requires matching real renders but does not hide other findings", () => {
  /** @type {import('../src/render/check-contract.js').CheckReport['results'][number]} */
  const result = { part: "Button.part.tsx", state: "default", device: "rg353m", frame: "Rendered", viewport: { width: 640, height: 480 }, png: "first.png", repeatPng: "repeat.png", sha256: "", repeatSha256: "", checks: [
    { name: "render", status: "Passed", detail: "" }, { name: "browser", status: "Passed", detail: "" },
    { name: "determinism", status: "Passed", detail: "" }, { name: "accessibility", status: "Failed", detail: "" },
  ] }
  expect(canApproveImage(result)).toBe(true)
  expect(canApproveImage({ ...result, take: "1" })).toBe(false)
  expect(canApproveImage({ ...result, checks: result.checks.filter(check => check.name !== "determinism") })).toBe(false)
  expect(summarizeChecks(result.checks).status).toBe("Failed")
})
