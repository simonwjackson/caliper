import { expect, test } from "bun:test"
import { createChecksController } from "../src/client/app/checks"
import type { ChecksView as Wire } from "../src/checks/contract.js"

const tick = () => new Promise(resolve => setTimeout(resolve, 5))
function evidence(): Extract<Wire, { _tag: "Ready" }> {
  return { _tag: "Ready", id: crypto.randomUUID(), request: { part: "Button.part.tsx", state: "default" }, approved: [], stale: false, report: { version: 1, project: "app", environment: "test", createdAt: "now", coverage: "Listed scenarios only", results: [{ part: "Button.part.tsx", state: "default", device: "iphone-16", frame: "Rendered", viewport: { width: 640, height: 480 }, png: "/saved/first.png", repeatPng: "/saved/repeat.png", sha256: "a".repeat(64), repeatSha256: "a".repeat(64), checks: [{ name: "render", status: "Passed", detail: "" }, { name: "browser", status: "Passed", detail: "" }, { name: "determinism", status: "Passed", detail: "" }, { name: "accessibility", status: "Failed", detail: "A finding unrelated to approval" }] }] } }
}
function current(controller: ReturnType<typeof createChecksController>) {
  const view = controller.getView()
  if (view._tag !== "Open" || view.run._tag !== "Ready") throw new Error("Not ready")
  return view.run
}

test("same-run evidence replacement invalidates loaded/reviewed identity and old callbacks", async () => {
  const ready = evidence()
  const calls: string[] = []
  const controller = createChecksController({ changed: () => {}, target: () => ({ ...ready.request, label: "Button" }), request: async <T>(path: string) => { calls.push(path); return ready as T } })
  controller.open(); await tick()
  const original = current(controller).rows[0]!
  for (const shot of original.images) controller.imageLoaded(ready.id, 0, shot.key)
  controller.imageReviewed(ready.id, 0, true)
  expect(current(controller).rows[0]!.reviewed).toBe(true)
  const replacement = structuredClone(ready)
  replacement.report.results[0]!.png = "/saved/replacement-first.png"
  controller.receive(replacement)
  expect(current(controller).rows[0]!.reviewed).toBe(false)
  for (const shot of original.images) controller.imageLoaded(ready.id, 0, shot.key)
  controller.imageReviewed(ready.id, 0, true)
  controller.approve(ready.id, 0)
  expect(calls).toEqual(["checks"])
  expect(current(controller).rows[0]!.approval._tag).toBe("Disabled")
  const row = current(controller).rows[0]!
  for (const shot of row.images) controller.imageLoaded(ready.id, 0, shot.key)
  expect(current(controller).rows[0]!.approval._tag).toBe("Enabled")
  expect(current(controller).rows[0]!.badge.status).toBe("Failed")
  // Snapshots and received payloads are not live writable controller state.
  replacement.report.results[0]!.png = "/tampered.png"
  expect(current(controller).rows[0]!.images[0]!.key).not.toContain("tampered")
  controller.destroy()
})

test("a late refresh cannot rewind newer SSE or authorize unknown run/index keys", async () => {
  const ready = evidence()
  let resolveRefresh: (wire: Wire) => void = () => {}
  const refreshing = new Promise<Wire>(resolve => { resolveRefresh = resolve })
  let calls = 0
  const controller = createChecksController({ changed: () => {}, target: () => ({ ...ready.request, label: "Button" }), request: async <T>() => { calls++; return await refreshing as T } })
  controller.open()
  controller.receive(ready)
  resolveRefresh({ _tag: "Idle" }); await tick()
  expect(current(controller).id).toBe(ready.id)
  for (const shot of current(controller).rows[0]!.images) {
    controller.imageLoaded("other-run", 0, shot.key)
    controller.imageLoaded(ready.id, 1, shot.key)
    controller.imageLoaded(ready.id, 0.5, shot.key)
  }
  controller.imageReviewed(ready.id, 0, true)
  controller.approve(ready.id, 0)
  expect(calls).toBe(1)
  expect(current(controller).rows[0]!.reviewed).toBe(false)
  controller.destroy()
})

test("destroy makes pending read completions and later image callbacks inert", async () => {
  const ready = evidence()
  let release: (wire: Wire) => void = () => {}
  const pending = new Promise<Wire>(resolve => { release = resolve })
  let changed = 0
  let requests = 0
  const controller = createChecksController({ changed: () => { changed++ }, target: () => ({ ...ready.request, label: "Button" }), request: async <T>() => { requests++; return await pending as T } })
  controller.open()
  controller.destroy()
  const count = changed
  release(ready); await tick()
  controller.receive(ready)
  controller.open()
  controller.imageLoaded(ready.id, 0, "first")
  controller.run("all")
  expect(changed).toBe(count)
  expect(requests).toBe(1)
  expect(controller.getView()._tag).toBe("Closed")
})

test("wire schema validation rejects fabricated reports before publishing evidence", () => {
  const controller = createChecksController({ changed: () => {}, target: () => null, request: async <T>() => ({ _tag: "Idle" }) as T })
  const malformed = { ...evidence(), report: { version: 2, results: [] } }
  expect(() => controller.receive(malformed as unknown as Wire)).toThrow("invalid checks snapshot")
  expect(controller.badge("Button.part.tsx", "default")).toBeNull()
  controller.destroy()
})
