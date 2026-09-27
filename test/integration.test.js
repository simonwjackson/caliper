// @ts-check
import { describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createIntegrationReview } from "../src/takes/integration.js"
import { createTakeStore } from "../src/takes/store.js"

const ask = { part: "src/Button.part.tsx", state: "default", device: "rg353m", name: "Quiet button" }
const proposal = {
  strategy: /** @type {const} */ ("variant"),
  summary: "Add an explicit quiet variant.",
  shared: "Keep spacing and focus styles shared.",
  preserved: "Default callers retain the original behavior.",
  usage: '<Button variant="quiet" />',
  preview: { part: ask.part, state: "Quiet" },
}

/** @param {(fixture: ReturnType<typeof setup>) => void | Promise<void>} run */
async function fixture(run) {
  const input = setup()
  try { await run(input) } finally { rmSync(input.root, { recursive: true, force: true }) }
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), "caliper-integration-"))
  mkdirSync(join(root, "src"))
  writeFileSync(join(root, ask.part), "export default function Part() {}")
  writeFileSync(join(root, "src/Button.tsx"), "original component")
  writeFileSync(join(root, "src/button.css"), "original styles")
  const store = createTakeStore(root)
  const source = store.create({ ...ask, direction: { title: "Quiet", brief: "Less contrast" }, others: ["Loud"] })
  store.write(source, "src/Button.tsx", "quiet component")
  const integration = createIntegrationReview(store)
  return { root, store, source, integration }
}

/** @param {ReturnType<typeof setup>} input */
async function checked(input) {
  const take = input.integration.begin(input.source)
  input.integration.submit(take, proposal)
  const review = await input.integration.check(take, async () => "Rendered original and Quiet with no browser errors.")
  return { take, review }
}

describe("integration preparation and submission", () => {
  test("keeps legacy takes valid and copies a source into a separate named proposal", () => fixture(({ root, store, source, integration }) => {
    const sourceRecord = readFileSync(join(root, ".caliper/takes", `${source}.json`), "utf8")
    expect(integration.summary(source)).toBeUndefined()
    expect(() => integration.review(source)).toThrow("not an integration")
    const take = integration.begin(source)
    expect(take).not.toBe(source)
    expect(store.read(take, "src/Button.tsx")).toBe("quiet component")
    expect(store.original("src/Button.tsx")).toBe("original component")
    expect(readFileSync(join(root, ".caliper/takes", `${source}.json`), "utf8")).toBe(sourceRecord)
    expect(store.record(take)).toMatchObject({ ...ask, name: "Quiet button alternate", direction: { title: "Quiet", brief: "Less contrast" }, others: ["Loud"] })
    expect(integration.summary(take)).toEqual({ _tag: "Preparing", sourceTake: source })
    expect(() => integration.review(take)).toThrow("still preparing")
    store.write(take, "src/Button.tsx", "proposal only")
    expect(store.read(source, "src/Button.tsx")).toBe("quiet component")
  }))

  test("preserves unknown future ask context and caps the proposal name", () => fixture(({ store, source, integration }) => {
    store.update(source, /** @type {any} */ ({ name: "x".repeat(80), futureContext: { scenario: "working cart" } }))
    const take = integration.begin(source)
    expect(store.record(take)?.name?.length).toBeLessThanOrEqual(80)
    expect(store.record(take)).toMatchObject({ futureContext: { scenario: "working cart" } })
  }))

  test("returns exact before/after text without exposing baseline hashes in summaries", () => fixture(({ store, source, integration }) => {
    const take = integration.begin(source)
    store.write(take, "src/Quiet.tsx", "new component")
    const review = integration.submit(take, proposal)
    expect(review.files).toEqual([
      { path: "src/Button.tsx", before: "original component", after: "quiet component" },
      { path: "src/Quiet.tsx", before: null, after: "new component" },
    ])
    expect(review.revision).toMatch(/^[a-f0-9]{64}$/)
    expect(review.checks).toEqual({ _tag: "NotRun" })
    expect(integration.summary(take)).toEqual({ _tag: "Review", sourceTake: source, proposal })
    expect(Object.keys(review).sort()).toEqual(["checks", "files", "proposal", "revision"])
  }))

  test("rejects invalid schema, blank fields, oversized text, and extra fields", () => fixture(({ source, integration }) => {
    const take = integration.begin(source)
    for (const value of [null, {}, { ...proposal, strategy: "replace" }, { ...proposal, summary: " \n " }, { ...proposal, shared: "" }, { ...proposal, preserved: 2 }, { ...proposal, usage: "x".repeat(4001) }, { ...proposal, extra: true }, { ...proposal, preview: { part: ask.part, state: "\t" } }]) {
      expect(() => integration.submit(take, value)).toThrow("Invalid integration proposal")
    }
  }))

  test("requires a fenced existing product preview", () => fixture(({ source, integration }) => {
    const take = integration.begin(source)
    for (const part of ["../outside.part.tsx", "/tmp/outside.part.tsx", "src/../src/Button.part.tsx", "src/absent.part.tsx", "src/Button.tsx", ".caliper/hidden.part.tsx"]) {
      expect(() => integration.submit(take, { ...proposal, preview: { part, state: "default" } })).toThrow()
    }
  }))

  test("accepts a new product preview and rejects a proposal with no changed files", () => fixture(({ store, source, integration }) => {
    const take = integration.begin(source)
    store.reset(take, "src/Button.tsx")
    store.write(take, "src/button.css", "original styles")
    expect(() => integration.submit(take, proposal)).toThrow("no changed files")
    store.write(take, "src/Quiet.part.tsx", "export default function Quiet() {}")
    expect(integration.submit(take, { ...proposal, preview: { part: "src/Quiet.part.tsx", state: "default" } }).files).toHaveLength(1)
  }))

  test("rejects a project edit made after begin, even before the new target is edited", () => fixture(({ root, store, source, integration }) => {
    const take = integration.begin(source)
    writeFileSync(join(root, "src/button.css"), "newer styles")
    store.write(take, "src/button.css", "alternate styles")
    expect(() => integration.submit(take, proposal)).toThrow('Project source "src/button.css" changed after preparation')
    expect(store.original("src/button.css")).toBe("newer styles")
  }))

  test("rejects later source-take edits and missing source takes", () => fixture(({ store, source, integration }) => {
    const take = integration.begin(source)
    store.write(source, "src/Button.tsx", "new source direction")
    expect(() => integration.submit(take, proposal)).toThrow("source take changed")
    store.discard(source)
    expect(() => integration.submit(take, proposal)).toThrow("missing")
    expect(() => integration.begin(source)).toThrow("missing")
  }))
})

describe("reviewed checks and apply", () => {
  test("new callers invalidate a successful check", () => fixture(async input => {
    const { take, review } = await checked(input)
    writeFileSync(join(input.root, "src/NewCaller.part.tsx"), "export default function Part() {}")
    expect(() => input.integration.apply(take, review.revision, true)).toThrow("was added after preparation")
    expect(input.store.original("src/Button.tsx")).toBe("original component")
  }))

  test("requires checks, exact revision, and explicit human behavior review", () => fixture(async input => {
    const { source, store, integration } = input
    const take = integration.begin(source)
    const submitted = integration.submit(take, proposal)
    expect(() => integration.apply(take, submitted.revision, true)).toThrow("successful checks")
    const review = await integration.check(take, async () => "Rendered both states")
    expect(() => integration.apply(take, "old revision", true)).toThrow("revision does not match")
    expect(() => integration.apply(take, review.revision, false)).toThrow("product behavior and typecheck")
    expect(store.original("src/Button.tsx")).toBe("original component")
  }))

  for (const strategy of /** @type {const} */ (["variant", "component"])) {
    test(`applies a checked ${strategy} after restart and preserves the source take`, () => fixture(async ({ root, store, source, integration }) => {
      const sourceRecord = store.record(source)
      const take = integration.begin(source)
      if (strategy === "component") store.write(take, "src/Quiet.tsx", "separate component")
      integration.submit(take, { ...proposal, strategy })
      const review = await integration.check(take, async () => "Rendered original and alternate")
      const restarted = createIntegrationReview(createTakeStore(root))
      expect(restarted.review(take)).toEqual(review)
      const changed = restarted.apply(take, review.revision, true)
      expect(changed).toEqual(strategy === "variant" ? ["src/Button.tsx"] : ["src/Button.tsx", "src/Quiet.tsx"])
      expect(store.original("src/Button.tsx")).toBe("quiet component")
      expect(store.record(take)).toBeNull()
      expect(store.record(source)).toEqual(sourceRecord)
      expect(store.read(source, "src/Button.tsx")).toBe("quiet component")
    }))
  }

  test("persists verification failures and requires a new successful check", () => fixture(async ({ root, source, integration }) => {
    const take = integration.begin(source)
    integration.submit(take, proposal)
    const result = await integration.check(take, async () => { throw new Error("Quiet frame threw ReferenceError") })
    expect(result.checks).toEqual({ _tag: "Failed", reason: "Quiet frame threw ReferenceError" })
    const restarted = createIntegrationReview(createTakeStore(root))
    expect(restarted.review(take).checks).toEqual(result.checks)
    expect(() => restarted.apply(take, result.revision, true)).toThrow("successful checks")
    expect((await restarted.check(take, async () => "Rendered")).checks._tag).toBe("Passed")
  }))

  test("a changed copy requires resubmission and discards the previous successful check", () => fixture(async input => {
    const { take, review } = await checked(input)
    input.store.write(take, "src/Button.tsx", "edited after checking")
    expect(() => input.integration.review(take)).toThrow("Resubmit")
    const restarted = createIntegrationReview(createTakeStore(input.root))
    expect(() => restarted.apply(take, review.revision, true)).toThrow("Resubmit")
    const submitted = restarted.submit(take, proposal)
    expect(submitted.revision).not.toBe(review.revision)
    expect(submitted.checks._tag).toBe("NotRun")
    expect(() => restarted.apply(take, submitted.revision, true)).toThrow("successful checks")
  }))

  test("changes to proposal text require a new check even with the same copies", () => fixture(async input => {
    const { take, review } = await checked(input)
    const next = input.integration.submit(take, { ...proposal, usage: "Use the separate quiet choice" })
    expect(next.revision).not.toBe(review.revision)
    expect(next.checks._tag).toBe("NotRun")
    expect(() => input.integration.apply(take, next.revision, true)).toThrow("successful checks")
  }))

  test("rejects tampered proposal metadata and successful checks for another revision", () => fixture(async input => {
    const { take, review } = await checked(input)
    const state = input.store.record(take)?.integration
    if (state?._tag !== "Review") throw new Error("Expected Review")
    input.store.update(take, { integration: { ...state, checkedRevision: "other" } })
    expect(input.integration.review(take).checks._tag).toBe("NotRun")
    expect(() => input.integration.apply(take, review.revision, true)).toThrow("successful checks")
    input.store.update(take, { integration: { ...state, proposal: { ...proposal, summary: "Tampered" } } })
    expect(() => input.integration.review(take)).toThrow("Resubmit")
  }))

  test("stale project sources block both checking and applying after restart", () => fixture(async input => {
    const { take, review } = await checked(input)
    writeFileSync(join(input.root, "src/Button.tsx"), "new project source")
    const restarted = createIntegrationReview(createTakeStore(input.root))
    await expect(restarted.check(take, async () => "must not run")).rejects.toThrow("changed after preparation")
    expect(() => restarted.apply(take, review.revision, true)).toThrow("changed after preparation")
    expect(input.store.original("src/Button.tsx")).toBe("new project source")
  }))

  test("a new project file cannot be overwritten by a previously reviewed addition", () => fixture(async input => {
    const take = input.integration.begin(input.source)
    input.store.write(take, "src/Quiet.tsx", "proposed new file")
    input.integration.submit(take, proposal)
    const review = await input.integration.check(take, async () => "Rendered")
    writeFileSync(join(input.root, "src/Quiet.tsx"), "created independently")
    expect(() => input.integration.apply(take, review.revision, true)).toThrow("added after preparation")
    expect(input.store.original("src/Button.tsx")).toBe("original component")
  }))

  test("locks its own in-flight checks and rejects edits during verification", () => fixture(async input => {
    const { take, review } = await checked(input)
    /** @type {() => void} */
    let finish = () => {}
    const pending = input.integration.check(take, () => new Promise(resolve => { finish = () => resolve("Rendered") }))
    expect(input.integration.review(take).checks._tag).toBe("NotRun")
    await expect(input.integration.check(take, async () => "Duplicate")).rejects.toThrow("check in progress")
    expect(() => input.integration.submit(take, proposal)).toThrow("check in progress")
    expect(() => input.integration.apply(take, review.revision, true)).toThrow("check in progress")
    input.store.write(take, "src/Button.tsx", "changed during render")
    finish()
    await expect(pending).rejects.toThrow("Resubmit")
    const state = input.store.record(take)?.integration
    expect(state?._tag === "Review" && state.checks._tag).toBe("Failed")
    expect(input.integration.submit(take, proposal).checks._tag).toBe("NotRun")
  }))

  test("rejects project edits during verification and persists a failed check", () => fixture(async input => {
    const take = input.integration.begin(input.source)
    input.integration.submit(take, proposal)
    await expect(input.integration.check(take, async () => {
      writeFileSync(join(input.root, "src/button.css"), "concurrent project edit")
      return "Rendered"
    })).rejects.toThrow("changed after preparation")
    const state = input.store.record(take)?.integration
    expect(state?._tag === "Review" && state.checks._tag).toBe("Failed")
  }))

  test("restores earlier writes and preserves the proposal when a later copy fails", () => fixture(async input => {
    const take = input.integration.begin(input.source)
    input.store.write(take, "src/Added.tsx", "new file")
    input.store.write(take, "src/button.css", "new styles")
    input.integration.submit(take, proposal)
    const review = await input.integration.check(take, async () => "Rendered")
    const blocked = join(input.root, "src/button.css")
    // This suite runs as a normal user. A read-only later target gives a real
    // filesystem copy failure after the new file and Button have been written.
    chmodSync(blocked, 0o444)
    try {
      if (process.getuid?.() === 0) return // root bypasses Unix file permissions
      expect(() => input.integration.apply(take, review.revision, true)).toThrow("Original target contents restored")
      expect(input.store.original("src/Button.tsx")).toBe("original component")
      expect(input.store.original("src/button.css")).toBe("original styles")
      expect(existsSync(join(input.root, "src/Added.tsx"))).toBe(false)
      expect(input.store.record(take)).not.toBeNull()
      expect(input.integration.review(take).checks._tag).toBe("Passed")
    } finally { chmodSync(blocked, 0o644) }
    expect(input.integration.apply(take, review.revision, true)).toHaveLength(3)
  }))
})

describe("integration path safety", () => {
  test("refuses symlink copies, including dangling links that store.files would omit", () => fixture(({ root, source, integration }) => {
    const folder = join(root, ".caliper/takes", source, "src")
    symlinkSync(join(root, "missing-secret"), join(folder, "escape.tsx"))
    expect(() => integration.begin(source)).toThrow("symbolic link")
  }))

  test("refuses project symlink targets before any source write", () => fixture(async input => {
    const { take, review } = await checked(input)
    const target = join(input.root, "src/Button.tsx")
    const outside = mkdtempSync(join(tmpdir(), "caliper-outside-"))
    try {
      writeFileSync(join(outside, "secret"), "do not overwrite")
      rmSync(target)
      symlinkSync(join(outside, "secret"), target)
      expect(() => input.integration.apply(take, review.revision, true)).toThrow()
      expect(readFileSync(join(outside, "secret"), "utf8")).toBe("do not overwrite")
      expect(input.store.record(take)).not.toBeNull()
    } finally { rmSync(outside, { recursive: true, force: true }) }
  }))

  test("rejects symlinked take metadata before reading or changing it", () => fixture(input => {
    const record = join(input.root, ".caliper/takes", `${input.source}.json`)
    const real = readFileSync(record, "utf8")
    const outside = join(input.root, "other.json")
    writeFileSync(outside, real)
    rmSync(record)
    symlinkSync(outside, record)
    expect(() => input.integration.begin(input.source)).toThrow("symbolic link")
    expect(readFileSync(outside, "utf8")).toBe(real)
  }))

  test("rejects changed copy folders and preview symlinks on review", () => fixture(async input => {
    const { take, review } = await checked(input)
    const folder = join(input.root, ".caliper/takes", take, "src")
    rmSync(folder, { recursive: true })
    symlinkSync(join(input.root, "src"), folder)
    expect(() => input.integration.apply(take, review.revision, true)).toThrow("symbolic link")
    expect(input.store.original("src/Button.tsx")).toBe("original component")
  }))
})
