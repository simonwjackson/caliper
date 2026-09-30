import { expect, test } from "bun:test"
import { createServer } from "node:http"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Check } from "typebox/value"
import { ChecksViewSchema, type ChecksView } from "../src/checks/contract.js"
import { createChecksApi } from "../src/checks/api.js"
import { compareRenders, type checkJobs } from "../src/render/checks.js"
import { createTakeStore } from "../src/takes/store.js"
import { createChecksController } from "../src/client/app/checks"
import type { CheckReport } from "../src/render/check-contract.js"
import type { Project } from "../src/types"

const part = "Button.part.tsx"
const project: Project = { name: "checks-controller", parts: [{ file: part, name: "Button", states: [{ export: "default", label: "Default" }] }], entry: { _tag: "Failed", reason: "", hint: "" }, css: { _tag: "Failed", reason: "", hint: "" }, wrapper: { _tag: "Failed", reason: "", hint: "" } }
const tick = () => new Promise(resolve => setTimeout(resolve, 5))
async function until(condition: () => boolean) { for (let i = 0; i < 200; i++) { if (condition()) return; await tick() } throw new Error("Controller did not settle") }
type Controller = ReturnType<typeof createChecksController>
function readyView(controller: Controller) { const view = controller.getView(); if (view._tag !== "Open" || view.run._tag !== "Ready") throw new Error("Not ready"); return view.run }

/** Real API snapshots and real saved/hash-checked report files. Only browser rendering is substituted. */
async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const f = await setup()
  try { await run(f) } finally { f.controller.destroy(); await f.api.close(); f.server.closeAllConnections(); await new Promise<void>(resolve => f.server.close(() => resolve())); rmSync(f.root, { recursive: true, force: true }) }
}
async function setup() {
  const root = mkdtempSync(join(tmpdir(), "chrome-checks-controller-"))
  writeFileSync(join(root, part), "export default () => <button>Retry</button>")
  const store = createTakeStore(root)
  let interaction = false
  let termination: "Completed" | "Cancelled" | "SourceChanged" = "Completed"
  const savedRun: typeof checkJobs = async input => {
    mkdirSync(input.out, { recursive: true })
    const sample = (name: string) => input.jobs.map((job, index) => {
      const png = join(input.out, `${index}-${name}.png`)
      writeFileSync(png, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(`saved:${job.state}:${job.device}`)]))
      return { ...job, png, viewport: { width: 640, height: 480 }, frame: "Rendered" as const, problems: [], console: [], spill: null, environment: "test", accessibility: { _tag: "Complete" as const, violations: [], incomplete: [] } }
    })
    const first = sample("first"), second = sample("repeat")
    let report: CheckReport = compareRenders({ project: input.project, first, second, baselines: input.baselines })
    if (interaction) {
      report = { ...report, version: 2, run: { id: "authored-run", termination, source: { epoch: "server", generation: 2, fingerprint: "current-source" }, stale: termination === "SourceChanged" }, results: report.results.map(result => ({ ...result, authored: {
        status: "Failed", reason: "Assertion", provenance: result.take ? { kind: "Take", take: result.take, files: [part], changedDeclarations: ["Retry"] } : { kind: "Original", files: [], changedDeclarations: [] },
        checks: [{ name: "Retry", source: { file: part, line: 3 }, status: "Failed", reason: "Assertion", detail: "\u001b[31mWrong label\u001b[0m", durationMs: 10, errors: ["Callback error"], image: result.png, imageSha256: result.sha256 }],
      } })) }
    }
    const reportPath = join(input.out, "report.json")
    writeFileSync(reportPath, JSON.stringify(report))
    return { report, reportPath, results: first.map((result, index) => ({ ...result, checks: report.results[index]!.checks, checkReport: reportPath })) }
  }
  const calls: Array<{ path: string; data?: object }> = []
  const controller = createChecksController({ target: () => ({ part, state: "default", label: "Button default" }), changed: () => {}, request: async <T>(path: string, data?: object): Promise<T> => {
    calls.push({ path, data })
    const response = await fetch(`${url}/${path}`, data ? { method: "POST", headers: { "content-type": "application/json", origin: url }, body: JSON.stringify(data) } : {})
    const value = await response.json()
    if (!response.ok) throw new Error(value.error)
    expect(Check(ChecksViewSchema, value)).toBe(true)
    return value
  } })
  const api = createChecksApi({ store, project: async () => project, chromium: "test", serverUrl: () => "http://localhost", run: savedRun, onChange: () => controller.receive(api.snapshot()) })
  const server = createServer((request, response) => { const url = new URL(request.url!, "http://localhost"); void api.handle(url.pathname, url, request, response) })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing address")
  const url = `http://127.0.0.1:${address.port}`
  const open = async () => { controller.open(); await until(() => { const view = controller.getView(); return view._tag === "Open" && view.runSelected._tag === "Enabled" }); await tick() }
  const start = async () => { await open(); controller.run("selected"); await until(() => { const view = controller.getView(); return view._tag === "Open" && view.run._tag === "Ready" && view.runSelected._tag === "Enabled" }); return readyView(controller) }
  return { root, store, api, server, controller, calls, open, start, authored(value: boolean, end: typeof termination = "Completed") { interaction = value; termination = end } }
}

function load(controller: Controller) { const run = readyView(controller); for (const image of run.rows[0]!.images) controller.imageLoaded(run.id, 0, image.key); return run }

test("real saved snapshots retain exact image review/approval, device scope and unrelated findings", () => fixture(async f => {
  await f.start()
  const run = readyView(f.controller)
  expect(run.rows).toHaveLength(2)
  expect(run.rows[0]!.approval._tag).toBe("Disabled")
  f.controller.imageReviewed(run.id, 0, true)
  f.controller.approve(run.id, 0)
  expect(f.calls.some(call => call.path === "checks/approve")).toBe(false)
  load(f.controller)
  expect(readyView(f.controller).rows[0]!.approval._tag).toBe("Enabled")
  f.controller.imageReviewed(run.id, 0, true)
  f.controller.approve(run.id, 0)
  await until(() => readyView(f.controller).rows[0]!.approved)
  expect(f.calls.find(call => call.path === "checks/approve")!.data).toEqual({ id: run.id, index: 0, reviewed: true })
  expect(readyView(f.controller).rows[1]!.approved).toBe(false)
  expect(f.controller.badge(part, "missing")).toBeNull()
  expect(f.controller.badge(part, "default", "1")).toBeNull()
  expect(readyView(f.controller).reportUrl).toBe(`checks/report?id=${run.id}`)
}))

test("authored evidence never satisfies first/repeat eligibility; close/unmount and failures revoke review", () => fixture(async f => {
  f.authored(true)
  const run = await f.start()
  expect(run.badge.status).toBe("Failed")
  const row = run.rows[0]!
  expect(row.authored[0]!.detail).toContain("Wrong label")
  expect(row.authored[0]!.detail).not.toContain("\u001b[")
  expect(row.provenance).toContain("real files")
  f.controller.imageLoaded(run.id, 0, row.authored[0]!.image!.key)
  f.controller.imageReviewed(run.id, 0, true)
  expect(readyView(f.controller).rows[0]!.reviewed).toBe(false)
  load(f.controller)
  f.controller.imageReviewed(run.id, 0, true)
  f.controller.imageFailed(run.id, 0, row.images[0]!.key)
  expect(readyView(f.controller).rows[0]!.reviewed).toBe(false)
  expect(readyView(f.controller).rows[0]!.approval._tag).toBe("Disabled")
  f.controller.close()
  expect(f.controller.getView()._tag).toBe("Closed")
  await f.open()
  expect(readyView(f.controller).rows[0]!.approval._tag).toBe("Disabled")
  f.controller.imageLoaded(run.id, 0, "first")
  expect(readyView(f.controller).rows[0]!.approval._tag).toBe("Disabled")
}))

test("source-change history cannot become current after a late response; take reports cannot become baselines", () => fixture(async f => {
  const run = await f.start()
  load(f.controller)
  f.controller.imageReviewed(run.id, 0, true)
  const wire = f.api.snapshot(); expect(wire._tag).toBe("Ready"); if (wire._tag !== "Ready") throw new Error("Not ready")
  f.controller.receive({ ...wire, stale: true })
  f.controller.receive(wire)
  expect(readyView(f.controller).stale).toBe(true)
  expect(readyView(f.controller).rows[0]!.reviewed).toBe(false)
  expect(f.controller.badge(part, "default")!.status).toBe("Stale")
  f.controller.approve(run.id, 0)
  expect(f.calls.some(call => call.path === "checks/approve")).toBe(false)
  const report: CheckReport = structuredClone(wire.report)
  for (const result of report.results) result.take = "1"
  f.controller.receive({ ...wire, id: crypto.randomUUID(), request: { ...wire.request, take: "1" }, report })
  load(f.controller)
  expect(readyView(f.controller).rows[0]!.approval._tag).toBe("Disabled")
  expect(f.controller.badge(part, "default")).toBeNull()
  expect(f.controller.badge(part, "default", "1")).not.toBeNull()
}))

test("partial authored termination remains inconclusive history", () => fixture(async f => {
  f.authored(true, "Cancelled")
  const run = await f.start()
  expect(run.runDetail).toContain("partial observations")
  expect(run.runDetail).toContain("Cancelled")
  expect(run.badge.detail).toContain("inconclusive")
}))

test("late HTTP acknowledgements cannot rewind SSE; separate close/stop and stale ids recheck availability", async () => {
  const id = crypto.randomUUID()
  const running: ChecksView = { _tag: "Running", id, request: { part, state: "default" }, startedAt: "now", total: 2 }
  let resolveRun: (value: ChecksView) => void = () => {}
  const delayed = new Promise<ChecksView>(resolve => { resolveRun = resolve })
  const calls: Array<{ path: string; data?: object }> = []
  const controller = createChecksController({ changed: () => {}, target: () => ({ part, state: "default", take: "3", label: "Take 3" }), request: async <T>(path: string, data?: object) => { calls.push({ path, data }); return (path === "checks/run" ? await delayed : path === "checks/cancel" ? { ...running, stopping: true } : { _tag: "Idle" }) as T } })
  controller.open(); await tick()
  controller.run("all")
  expect(calls[1]!.data).toEqual({ part: "*", state: "*", take: "3" })
  controller.receive(running)
  controller.stop("wrong-id")
  expect(calls).toHaveLength(2)
  controller.close()
  expect(calls).toHaveLength(2)
  controller.receive({ _tag: "Failed", id, request: running.request, reason: "Set CHROMIUM" })
  resolveRun(running); await tick()
  controller.open(); await tick()
  // Reopen HTTP reads are allowed to reflect current server state; a terminal
  // same-run SSE remains authoritative over the original acknowledgement.
  controller.receive({ _tag: "Failed", id, request: running.request, reason: "Set CHROMIUM" })
  controller.receive(running)
  const view = controller.getView()
  expect(view._tag === "Open" && view.run._tag).toBe("Failed")
  controller.receive({ ...running, id: crypto.randomUUID() })
  const active = controller.getView(); if (active._tag !== "Open" || active.run._tag !== "Running") throw new Error("Not running")
  controller.stop(active.run.id); await tick()
  expect(calls.at(-1)!.path).toBe("checks/cancel")
  controller.destroy()
})
