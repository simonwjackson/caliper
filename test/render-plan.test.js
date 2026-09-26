// @ts-check
import { describe, expect, test } from "bun:test"
import { planRenders } from "../src/render/plan.js"

/** @type {import("../src/types").Project} */
const project = {
  name: "fixture-app",
  parts: [
    { file: "src/Button.atom.part.tsx", name: "Button", states: [{ export: "default", label: "Default" }, { export: "Busy", label: "Busy", line: 4 }] },
    { file: "src/pages/Home.page.part.tsx", name: "Home", states: [{ export: "default", label: "Default" }] },
  ],
  entry: { _tag: "Failed", reason: "", hint: "" },
  css: { _tag: "Failed", reason: "", hint: "" },
  wrapper: { _tag: "Failed", reason: "", hint: "" },
}

describe("planRenders", () => {
  test("renders the default state on the first device when only the part is named", () => {
    const plan = planRenders(project, { part: "src/Button.atom.part.tsx" })
    expect(plan).toEqual({
      _tag: "Planned",
      jobs: [{ part: "src/Button.atom.part.tsx", state: "default", device: "rg353m" }],
    })
  })

  test("expands * to every state and every device, states first", () => {
    const plan = planRenders(project, { part: "src/Button.atom.part.tsx", state: "*", devices: ["*"] })
    expect(plan._tag === "Planned" && plan.jobs.map(job => `${job.state}@${job.device}`)).toEqual([
      "default@rg353m",
      "default@odin2portal",
      "Busy@rg353m",
      "Busy@odin2portal",
    ])
  })

  test("accepts a list of devices by id", () => {
    const plan = planRenders(project, { part: "src/pages/Home.page.part.tsx", devices: ["odin2portal"] })
    expect(plan._tag === "Planned" && plan.jobs.map(job => job.device)).toEqual(["odin2portal"])
  })

  test("names the parts that match when the part is unknown", () => {
    expect(planRenders(project, { part: "Button" })).toEqual({
      _tag: "Invalid",
      reason: '"Button" is not a part of fixture-app. Parts that match: src/Button.atom.part.tsx',
    })
  })

  test("names the part's states when the state is unknown", () => {
    expect(planRenders(project, { part: "src/Button.atom.part.tsx", state: "Empty" })).toEqual({
      _tag: "Invalid",
      reason: 'src/Button.atom.part.tsx has no state "Empty". Its states are: default, Busy.',
    })
  })

  test("names the devices when a device is unknown", () => {
    expect(planRenders(project, { part: "src/Button.atom.part.tsx", devices: ["iphone"] })).toEqual({
      _tag: "Invalid",
      reason: 'Caliper has no device "iphone". Its devices are: rg353m, odin2portal.',
    })
  })
})
