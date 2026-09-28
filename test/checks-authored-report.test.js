// @ts-check
import { expect, test } from "bun:test"
import { Check } from "typebox/value"
import { CheckReportSchema } from "../src/render/check-contract.js"
import { ChecksViewSchema } from "../src/checks/contract.js"
import { authoredDetail, canApproveImage, reconcileChecks, summarizeResult, summarizeReport } from "../src/client/checks-view.js"

const authored = {
  status: "Failed", reason: "Assertion", provenance: { kind: "Original", files: [], changedDeclarations: [] },
  checks: [{ name: "retry loads the library", source: { file: "Button.part.tsx", line: 4 }, status: "Failed", reason: "Assertion", detail: "Not visible", durationMs: 12, errors: [] }],
}
const result = {
  part: "Button.part.tsx", state: "default", device: "rg353m", frame: "Rendered", viewport: { width: 640, height: 480 },
  png: "first.png", repeatPng: "repeat.png", sha256: "a".repeat(64), repeatSha256: "a".repeat(64),
  checks: ["render", "browser", "determinism"].map(name => ({ name, status: "Passed", detail: "" })),
}
const legacy = { version: 1, project: "app", environment: "test", createdAt: "now", coverage: "Listed checks", results: [result] }
const run = { id: "run", termination: "Completed", source: { epoch: "server", generation: 0, fingerprint: "source" }, stale: false }
const report = { ...legacy, version: 2, run, results: [{ ...result, authored }] }

test("report v2 requires run identity and authored observations while v1 stays readable", () => {
  expect(Check(CheckReportSchema, legacy)).toBe(true)
  expect(Check(CheckReportSchema, report)).toBe(true)
  expect(Check(CheckReportSchema, { ...report, version: 1 })).toBe(false)
  expect(Check(CheckReportSchema, { ...report, run: undefined })).toBe(false)
  expect(Check(CheckReportSchema, { ...report, results: [result] })).toBe(false)
  expect(Check(CheckReportSchema, { ...report, results: [{ ...result, authored: { ...authored, status: "Accepted" } }] })).toBe(false)
  expect(Check(CheckReportSchema, { ...report, run: { ...run, termination: "Passed" } })).toBe(false)
})

test("authored failures share the summary but never change visual baseline eligibility", () => {
  if (!Check(CheckReportSchema, report)) throw new Error("Invalid test report")
  const item = report.results[0]
  if (!item) throw new Error("Missing result")
  expect(summarizeResult(item).status).toBe("Failed")
  expect(summarizeResult(item).label).toBe("1 failed")
  expect(summarizeReport(report).status).toBe("Failed")
  expect(canApproveImage(item)).toBe(true)
})

test("no declarations and interrupted or stale runs cannot appear to pass", () => {
  const untested = { ...report, results: [{ ...result, authored: { ...authored, status: "NotRun", reason: "NoDeclarations", checks: [] } }] }
  if (!Check(CheckReportSchema, untested)) throw new Error("Invalid test report")
  expect(summarizeReport(untested).status).toBe("NotRun")
  const passed = { ...report, results: [{ ...result, authored: { ...authored, status: "Passed", checks: [{ ...authored.checks[0], status: "Passed" }] } }] }
  if (!Check(CheckReportSchema, passed) || passed.version !== 2) throw new Error("Invalid test report")
  expect(summarizeReport(passed).status).toBe("Passed")
  expect(summarizeReport({ ...passed, run: { ...passed.run, termination: "Cancelled" } }).status).toBe("Inconclusive")
  expect(summarizeReport({ ...passed, run: { ...passed.run, stale: true } }).status).toBe("Inconclusive")
})

test("authored assertion details remove terminal color codes without changing saved observations", () => {
  const check = { name: "Retry", source: { file: "Button.part.tsx", line: 4 }, status: /** @type {const} */ ("Failed"), reason: "CheckError", durationMs: 12,
    detail: "Expected:\n\u001b[32m  Wrong label\u001b[39m\nReceived:\n\u001b[31m  Retry\u001b[39m", errors: ["\u001b[2mBrowser detail\u001b[22m"] }
  const text = authoredDetail(check)
  expect(text).toContain("Expected:\n  Wrong label\nReceived:\n  Retry")
  expect(text).toContain("Browser error: Browser detail")
  expect(text).not.toContain("\u001b[")
  expect(check.detail).toContain("\u001b[32m")
})

test("cancelled no-report outcomes validate and cannot rewind to Running", () => {
  const id = crypto.randomUUID(), request = { part: "Button.part.tsx", state: "default" }
  const cancelled = { _tag: "Cancelled", id, request, reason: "Stopped by user" }
  const running = { _tag: "Running", id, request, startedAt: "now", total: 2, progress: { phase: "Authored", completed: 1, total: 2 }, stopping: true }
  expect(Check(ChecksViewSchema, cancelled)).toBe(true)
  expect(Check(ChecksViewSchema, running)).toBe(true)
  if (!Check(ChecksViewSchema, cancelled) || !Check(ChecksViewSchema, running)) throw new Error("Invalid test views")
  expect(reconcileChecks(cancelled, running)).toEqual(cancelled)
})
