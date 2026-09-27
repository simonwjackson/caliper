// @ts-check
import { describe, expect, test } from "bun:test"
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai"
import { planTakeRenders, validateTakeContext } from "../src/agent/api.js"
import { planDirections } from "../src/agent/planner.js"

const subject = { part: "src/Chip.part.tsx", state: "Missing" }
const preview = { part: "src/Home.part.tsx", state: "NoArtwork" }
/** @type {import("../src/types").Project} */
const project = {
  name: "scenarios",
  entry: { _tag: "Failed", reason: "unused", hint: "unused" },
  css: { _tag: "Failed", reason: "unused", hint: "unused" },
  wrapper: { _tag: "Failed", reason: "unused", hint: "unused" },
  parts: [
    { file: subject.part, name: "Chip", states: [{ export: "default", label: "Default" }, { export: "Missing", label: "Missing" }] },
    { file: preview.part, name: "Home", states: [{ export: "default", label: "Default" }, { export: "NoArtwork", label: "No artwork" }, { export: "Unrelated", label: "Unrelated" }], composition: {
      default: [{ part: subject.part, state: "default" }], NoArtwork: [subject],
    } },
    { file: "src/Shell.part.tsx", name: "Shell", states: [{ export: "default", label: "Default" }], composition: { default: [preview, subject] } },
    { file: "src/Other.part.tsx", name: "Other", states: [{ export: "default", label: "Default" }] },
  ],
}
const request = { state: preview.state, devices: ["rg353m"] }

describe("take context validation and render planning", () => {
  test("an old isolated take renders its subject without a migration", () => {
    expect(planTakeRenders(project, subject, { ...request, state: subject.state }, "1")).toEqual([
      { ...subject, device: "rg353m", take: "1" },
    ])
  })

  test("the default render shows the declared preview, and an override shows the subject", () => {
    const ask = { ...subject, context: preview }
    expect(planTakeRenders(project, ask, request, "1")).toEqual([{ ...preview, device: "rg353m", take: "1" }])
    expect(planTakeRenders(project, ask, { ...request, ...subject }, "1")).toEqual([{ ...subject, device: "rg353m", take: "1" }])
  })

  test("related checks cover every subject state and all declared contexts without duplicate jobs", () => {
    const jobs = planTakeRenders(project, { ...subject, context: preview }, { ...request, related: true, devices: ["rg353m", "rg353m"] }, "2")
    expect(jobs.map(job => `${job.part}:${job.state}`).sort()).toEqual([
      "src/Chip.part.tsx:Missing", "src/Chip.part.tsx:default",
      "src/Home.part.tsx:NoArtwork", "src/Home.part.tsx:default", "src/Shell.part.tsx:default",
    ])
    expect(jobs.every(job => job.take === "2" && job.device === "rg353m")).toBe(true)
  })

  test("a wildcard renders related states only, not every state of a context part", () => {
    expect(planTakeRenders(project, { ...subject, context: preview }, { ...request, state: "*" }, "1").map(job => job.state).sort())
      .toEqual(["NoArtwork", "default"])
  })

  test("unknown parts, unrelated states and ambiguous related overrides fail", () => {
    const ask = { ...subject, context: preview }
    expect(() => planTakeRenders(project, ask, { ...request, part: "src/Other.part.tsx", state: "default" }, "1")).toThrow("not the take's subject")
    expect(() => planTakeRenders(project, ask, { ...request, state: "Unrelated" }, "1")).toThrow("not the take's subject")
    expect(() => planTakeRenders(project, ask, { ...request, part: "../secret", state: "*" }, "1")).toThrow("No declared states")
    expect(() => planTakeRenders(project, ask, { ...request, related: true, part: subject.part }, "1")).toThrow("without a part override")
  })

  test("removing a declaration or state invalidates the recorded context instead of falling back", () => {
    const parts = project.parts.map(part => ({ ...part, composition: {} }))
    expect(() => validateTakeContext(parts, { ...subject, context: preview })).toThrow("not a declared context")
    expect(() => validateTakeContext(project.parts, { ...subject, context: { ...preview, state: "Deleted" } })).toThrow("no longer exists")
    expect(() => validateTakeContext(project.parts, { ...subject, state: "Deleted" })).toThrow("subject")
    expect(() => validateTakeContext(project.parts, { ...subject, context: /** @type {any} */ (null) })).toThrow("needs a part path")
  })
})

test("the planner distinguishes its editing subject from the screenshot's composed scenario", async () => {
  const provider = fauxProvider({ models: [{ id: "planner", reasoning: true, input: ["text", "image"] }] })
  const models = createModels()
  models.setProvider(provider.provider)
  let seen = ""
  provider.setResponses([context => {
    seen = JSON.stringify(context)
    return fauxAssistantMessage([fauxToolCall("propose_directions", { directions: [{ title: "Spacing", brief: "Change only the chip spacing." }] })], { stopReason: "toolUse" })
  }])
  await planDirections({
    engine: { models, model: provider.getModel(), reasoning: "medium" },
    prompt: "Make the chip clearer", count: 2, ...subject, device: "rg353m", preview,
    context: [{ type: "text", text: '<file path="src/Chip.part.tsx">chip fixture</file>' }, { type: "text", text: '<file path="src/Home.part.tsx">home fixture</file>' }],
  })
  expect(seen).toContain("The editing subject is src/Chip.part.tsx")
  expect(seen).toContain("The preview is src/Home.part.tsx")
  expect(seen).toContain("not a replacement of the page")
  expect(seen).toContain("chip fixture")
  expect(seen).toContain("home fixture")
})
