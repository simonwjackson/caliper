// @ts-check
import { describe, expect, test } from "bun:test"
import { planTakeRenders } from "../src/agent/api.js"
import { createTakeStore } from "../src/takes/store.js"
import { createIntegrationReview } from "../src/takes/integration.js"
import { manifest, withProject } from "./project-server.js"

const subject = { part: "src/Chip.atom.part.tsx", state: "Missing" }
const context = { part: "src/Home.page.part.tsx", state: "NoArtwork" }
const alternate = { part: "src/Alternate.page.part.tsx", state: "default" }
/** @type {import("../src/types").Project} */
const project = {
  name: "composed alternate",
  entry: { _tag: "Failed", reason: "unused", hint: "unused" },
  css: { _tag: "Failed", reason: "unused", hint: "unused" },
  wrapper: { _tag: "Failed", reason: "unused", hint: "unused" },
  parts: [
    { file: subject.part, name: "Chip", layer: "atom", states: [{ export: "default", label: "Default" }, { export: subject.state, label: "Missing" }] },
    { file: context.part, name: "Home", layer: "page", states: [{ export: "default", label: "Default" }, { export: context.state, label: "No artwork" }], composition: { [context.state]: [subject] } },
    { file: alternate.part, name: "Alternate", layer: "page", states: [{ export: "default", label: "Default" }] },
  ],
}
const ask = { ...subject, context, device: "rg353m" }

const files = {
  "package.json": manifest(),
  "src/index.ts": 'export {}',
  [subject.part]: 'export default function Chip() { return null }\nexport function Missing() { return null }',
  [context.part]: `export default function Home() { return null }\nexport function NoArtwork() { return null }\nexport const composition = { NoArtwork: [${JSON.stringify(subject)}] }`,
}
const proposal = {
  strategy: /** @type {const} */ ("component"),
  summary: "An additional product-owned scenario",
  shared: "Original child implementation",
  preserved: "All existing states and callers",
  usage: "Render Alternate explicitly",
  preview: alternate,
}

/** @param {string} url @param {string} take @param {string} action @param {unknown} [body] */
const post = (url, take, action, body = {}) => fetch(new URL(`/__caliper/takes/${take}/${action}`, url), {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
})

describe("composed context and alternate integration coexist", () => {
  test("an integration keeps its composed default and explicitly renders a new alternate", () => {
    expect(planTakeRenders(project, ask, { state: context.state, devices: [ask.device] }, "2", true))
      .toEqual([{ ...context, device: ask.device, take: "2" }])
    expect(planTakeRenders(project, ask, { ...alternate, devices: [ask.device] }, "2", true))
      .toEqual([{ ...alternate, device: ask.device, take: "2" }])
    expect(() => planTakeRenders(project, ask, { ...alternate, devices: [ask.device] }, "1"))
      .toThrow("not the take's subject")
  })

  test("integration related checks still follow declared scenarios, not unrelated parts", () => {
    expect(planTakeRenders(project, ask, { state: "*", devices: [ask.device], related: true }, "2", true)
      .map(job => `${job.part}:${job.state}`).sort()).toEqual([
      `${subject.part}:Missing`, `${subject.part}:default`, `${context.part}:NoArtwork`,
    ].sort())
    expect(() => planTakeRenders(project, ask, { ...alternate, devices: [ask.device], related: true }, "2", true))
      .toThrow("without a part override")
  })

  test("preparation keeps the name and composed context; invalid declarations cannot be checked or applied", async () => {
    await withProject({ files }, async ({ root, url }) => {
      const store = createTakeStore(root)
      const source = store.create({ ...ask, name: "Outlined missing artwork" })
      const integration = createIntegrationReview(store)
      const take = integration.begin(source)
      expect(store.record(take)?.context).toEqual(context)
      expect(store.record(take)?.name).toBe("Outlined missing artwork alternate")
      store.write(take, alternate.part, 'export default function Alternate() { return null }\nexport const composition = { default: [{ part: "src/Gone.part.tsx", state: "default" }] }')
      integration.submit(take, proposal)
      const checked = await post(url, take, "check")
      expect(checked.status).toBe(200)
      const review = await checked.json()
      expect(review.checks._tag).toBe("Failed")
      expect(review.checks.reason).toContain("invalid composition declarations")
      // Simulate an older persisted render check: apply must revalidate metadata too.
      const previouslyChecked = await integration.check(take, async () => "Previous render check")
      const applied = await post(url, take, "apply", { revision: previouslyChecked.revision, behaviorReviewed: true })
      expect(applied.status).toBe(400)
      expect((await applied.json()).error).toContain("invalid composition declarations")
      expect(store.original(alternate.part)).toBe(null)
      expect(store.record(source)?.context).toEqual(context)
    })
  })

  test("integration checks reject a proposal that removes its existing composed context", async () => {
    await withProject({ files }, async ({ root, url }) => {
      const store = createTakeStore(root)
      const source = store.create(ask)
      const integration = createIntegrationReview(store)
      const take = integration.begin(source)
      store.write(take, context.part, 'export default function Home() { return null }\nexport function NoArtwork() { return null }')
      store.write(take, alternate.part, 'export default function Alternate() { return null }')
      integration.submit(take, proposal)
      const checked = await post(url, take, "check")
      expect(checked.status).toBe(200)
      const review = await checked.json()
      expect(review.checks._tag).toBe("Failed")
      expect(review.checks.reason).toContain("not a declared context")
      expect(store.original(context.part)).toBe(files[context.part])
    })
  })
})
