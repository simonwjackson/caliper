import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTakeStore } from "../src/takes/store.js"
import { createIntegrationReview, type Review } from "../src/takes/integration.js"
import { createIntegrationController } from "../src/client/app/integration"
import type { TakeView } from "../src/types"

const tick = () => new Promise(resolve => setTimeout(resolve, 5))
const ask = { part: "src/Button.part.tsx", state: "default", device: "iphone-16" }
const proposal = { strategy: "variant" as const, summary: "An opt-in quiet button", shared: "Counter and focus behavior", preserved: "Existing callers stay unchanged", usage: '<Button tone="quiet" />', preview: { part: ask.part, state: "Quiet" } }
function setup() {
  const root = mkdtempSync(join(tmpdir(), "chrome-integration-controller-"))
  mkdirSync(join(root, "src"))
  writeFileSync(join(root, ask.part), "export default () => <button>Button</button>")
  writeFileSync(join(root, "src/Button.tsx"), "Original")
  const store = createTakeStore(root)
  const source = store.create(ask)
  store.write(source, "src/Button.tsx", "Experiment")
  const integration = createIntegrationReview(store)
  const take = integration.begin(source)
  integration.submit(take, proposal)
  const snapshot = (): TakeView => ({ ...ask, take, created: store.record(take)!.created, run: { _tag: "Idle" }, files: ["src/Button.tsx"], images: [], log: [], integration: integration.summary(take) })
  const calls: Array<{ path: string; data?: object }> = []
  const controller = createIntegrationController({ changed: () => {}, request: async <T>(path: string, data?: object) => {
    calls.push({ path, data })
    const action = path.split("/").at(-1)
    const value = action === "review" ? integration.review(take) : action === "check" ? await integration.check(take, async () => "All existing state/device renders match two stable baselines") : action === "apply" ? integration.apply(take, (data as { revision: string }).revision, (data as { behaviorReviewed: boolean }).behaviorReviewed) : null
    return value as T
  } })
  controller.sync(snapshot())
  const review = async () => { controller.review(take); await tick(); const view = controller.getView(); if (view._tag !== "Review") throw new Error(JSON.stringify(view)); return view }
  return { root, store, source, take, integration, snapshot, calls, controller, review }
}
async function fixture(run: (f: ReturnType<typeof setup>) => Promise<void>) { const f = setup(); try { await run(f) } finally { f.controller.destroy(); rmSync(f.root, { recursive: true, force: true }) } }

test("real submitted reviews retain exact revision gates and explicit product-behavior attestation", () => fixture(async f => {
  const view = await f.review()
  expect(view.review).toEqual(f.integration.review(f.take))
  expect(view.review.files[0]).toEqual({ path: "src/Button.tsx", before: "Original", after: "Experiment" })
  f.controller.behaviorReviewed(f.take, view.review.revision, true)
  expect(await f.controller.apply(f.take, view.review.revision)).toBe(false)
  f.controller.check(f.take, "old-revision")
  f.controller.check("another-take", view.review.revision)
  expect(f.calls).toHaveLength(1)
  f.controller.check(f.take, view.review.revision); await tick()
  const checked = f.controller.getView(); if (checked._tag !== "Review") throw new Error("Not checked")
  expect(checked.review.checks._tag).toBe("Passed")
  expect(checked.apply._tag).toBe("Disabled")
  expect(checked.behaviorReviewed).toBe(false)
  f.controller.behaviorReviewed(f.take, "old-revision", true)
  expect(await f.controller.apply(f.take, view.review.revision)).toBe(false)
  f.controller.behaviorReviewed(f.take, view.review.revision, true)
  expect(await f.controller.apply(f.take, "old-revision")).toBe(false)
  expect(await f.controller.apply(f.take, view.review.revision)).toBe(true)
  expect(f.calls.at(-1)!.data).toEqual({ revision: view.review.revision, behaviorReviewed: true })
  expect(f.store.record(f.take)).toBeNull()
  expect(f.store.record(f.source)).not.toBeNull()
  expect(readFileSync(join(f.root, "src/Button.tsx"), "utf8")).toBe("Experiment")
}))

test("refresh revokes attestation; later proposal or project edits cannot authorize apply", () => fixture(async f => {
  const view = await f.review()
  f.controller.check(f.take, view.review.revision); await tick()
  f.controller.behaviorReviewed(f.take, view.review.revision, true)
  await f.review()
  expect(f.controller.getView()).toMatchObject({ _tag: "Review", behaviorReviewed: false, apply: { _tag: "Disabled" } })
  f.controller.behaviorReviewed(f.take, view.review.revision, true)
  f.store.write(f.take, "src/Button.tsx", "Changed after review")
  expect(await f.controller.apply(f.take, view.review.revision)).toBe(false)
  expect(f.controller.getView()).toMatchObject({ _tag: "Unloaded", notices: [{ kind: "error", text: expect.stringContaining("proposal changed") }] })
  expect(readFileSync(join(f.root, "src/Button.tsx"), "utf8")).toBe("Original")
  f.integration.submit(f.take, proposal)
  const revised = await f.review()
  expect(revised.review.revision).not.toBe(view.review.revision)
  f.controller.check(f.take, revised.review.revision); await tick()
  f.controller.behaviorReviewed(f.take, revised.review.revision, true)
  writeFileSync(join(f.root, "src/Button.tsx"), "Newer project")
  expect(await f.controller.apply(f.take, revised.review.revision)).toBe(false)
  expect(readFileSync(join(f.root, "src/Button.tsx"), "utf8")).toBe("Newer project")
}))

test("a code change to the selected take revokes its loaded review without resetting selection", () => fixture(async f => {
  const view = await f.review()
  f.controller.check(f.take, view.review.revision); await tick()
  f.controller.behaviorReviewed(f.take, view.review.revision, true)
  expect(f.controller.getView()).toMatchObject({ _tag: "Review", behaviorReviewed: true, apply: { _tag: "Enabled" } })
  // The file list and proposal metadata do not change when this file is edited again.
  f.store.write(f.take, "src/Button.tsx", "Changed after review")
  f.controller.receive({ take: f.take, file: "src/Button.tsx" })
  expect(f.controller.getView()).toMatchObject({ _tag: "Unloaded", load: { _tag: "Enabled" } })
  f.controller.sync(f.snapshot())
  expect(f.controller.getView()._tag).toBe("Unloaded")
  expect(await f.controller.apply(f.take, view.review.revision)).toBe(false)
  expect(f.calls.some(call => call.path.endsWith("/apply"))).toBe(false)
}))

test("code events ignore other takes but revoke a review for any real-file edit", () => fixture(async f => {
  const view = await f.review()
  f.controller.receive({ take: f.source, file: "src/Button.tsx" })
  expect(f.controller.getView()).toMatchObject({ _tag: "Review", review: { revision: view.review.revision } })
  f.controller.receive({ take: null, file: "src/unrelated.ts" })
  expect(f.controller.getView()).toMatchObject({ _tag: "Unloaded", sourceTake: f.source })
  f.controller.sync(f.snapshot())
  await f.review()
  expect(f.controller.getView()._tag).toBe("Review")
}))

test("code changes reject late review and check responses without resetting selection", () => fixture(async f => {
  let release: (value: Review) => void = () => {}
  let hold = true
  let publications = 0
  const controller = createIntegrationController({ changed: () => publications++, request: async <T>() => {
    if (!hold) return f.integration.review(f.take) as T
    return await new Promise<Review>(resolve => { release = resolve }) as T
  } })
  try {
    controller.sync(f.snapshot())
    controller.review(f.take)
    const old = f.integration.review(f.take)
    controller.receive({ take: f.take, file: "src/Button.tsx" })
    release(old); await tick()
    expect(controller.getView()).toMatchObject({ _tag: "Unloaded", load: { _tag: "Enabled" } })
    hold = false
    controller.review(f.take); await tick()
    expect(controller.getView()._tag).toBe("Review")
    hold = true
    controller.check(f.take, old.revision)
    controller.receive({ take: null, file: "src/Button.tsx" })
    release({ ...old, checks: { _tag: "Passed", summary: "Late checks" } }); await tick()
    expect(controller.getView()._tag).toBe("Unloaded")
    expect(await controller.apply(f.take, old.revision)).toBe(false)
    controller.destroy()
    const before = publications
    controller.receive({ take: null, file: "src/Button.tsx" })
    expect(publications).toBe(before)
  } finally { controller.destroy() }
}))

test("running preparation and same-id recreation invalidate pending results, not just take numbers", () => fixture(async f => {
  let release: (value: Review) => void = () => {}
  const delayed = new Promise<Review>(resolve => { release = resolve })
  const controller = createIntegrationController({ changed: () => {}, request: async <T>() => await delayed as T })
  const snapshot = f.snapshot()
  controller.sync(snapshot)
  controller.review(f.take)
  controller.sync({ ...snapshot, created: snapshot.created + 1 })
  release(f.integration.review(f.take)); await tick()
  expect(controller.getView()._tag).toBe("Unloaded")
  controller.sync({ ...snapshot, run: { _tag: "Running" } })
  expect(controller.getView()._tag).toBe("Preparing")
  controller.review(f.take)
  controller.sync(null)
  expect(controller.getView()._tag).toBe("None")
  controller.destroy()
}))

test("ordinary stream updates preserve review; changed proposals and check response revisions revoke gates", () => fixture(async f => {
  const view = await f.review()
  f.controller.sync({ ...f.snapshot(), log: [{ _tag: "Assistant", text: "Stream update" }] })
  expect(f.controller.getView()).toMatchObject({ _tag: "Review", review: { revision: view.review.revision } })
  f.controller.sync({ ...f.snapshot(), integration: { _tag: "Review", sourceTake: f.source, proposal: { ...proposal, summary: "Changed metadata" } } })
  expect(f.controller.getView()._tag).toBe("Unloaded")
  const controller = createIntegrationController({ changed: () => {}, request: async <T>(path: string) => ({ ...f.integration.review(f.take), ...(path.endsWith("check") ? { revision: "other-revision", checks: { _tag: "Passed", summary: "Must not apply" } } : {}) }) as T })
  controller.sync(f.snapshot()); controller.review(f.take); await tick()
  controller.check(f.take, view.review.revision); await tick()
  expect(controller.getView()).toMatchObject({ _tag: "Unloaded", notices: [{ text: expect.stringContaining("proposal changed") }] })
  expect(await controller.apply(f.take, view.review.revision)).toBe(false)
  controller.destroy()
}))

test("a successful apply still reports success when SSE removes the selection before its acknowledgement", () => fixture(async f => {
  let controller: ReturnType<typeof createIntegrationController>
  controller = createIntegrationController({ changed: () => {}, request: async <T>(path: string) => {
    if (path.endsWith("apply")) { controller.sync(null); return { files: [] } as T }
    return { ...f.integration.review(f.take), checks: { _tag: "Passed", summary: "Reviewed render checks" } } as T
  } })
  controller.sync(f.snapshot()); controller.review(f.take); await tick()
  const view = controller.getView(); if (view._tag !== "Review") throw new Error("Not reviewed")
  controller.behaviorReviewed(f.take, view.review.revision, true)
  expect(await controller.apply(f.take, view.review.revision)).toBe(true)
  expect(controller.getView()._tag).toBe("None")
  controller.destroy()
}))

test("invalid review payloads cannot fabricate a passing exact revision", () => fixture(async f => {
  const controller = createIntegrationController({ changed: () => {}, request: async <T>() => ({ revision: "fabricated", checks: { _tag: "Passed" }, proposal, files: [] }) as T })
  controller.sync(f.snapshot()); controller.review(f.take); await tick()
  expect(controller.getView()).toMatchObject({ _tag: "Unloaded", notices: [{ text: expect.stringContaining("invalid alternate review snapshot") }] })
  controller.behaviorReviewed(f.take, "fabricated", true)
  expect(await controller.apply(f.take, "fabricated")).toBe(false)
  expect(readFileSync(join(f.root, "src/Button.tsx"), "utf8")).toBe("Original")
  controller.destroy()
}))
