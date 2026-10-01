// @ts-check
import { describe, expect, test } from "bun:test"
import { planRenders, withViewport } from "../src/render/plan.js"
import { STANDARD_DEVICES } from "../src/client/device-frame.js"

const phone = { width: 393, height: 852 }

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
  // The project lists two devices; planning uses only its list.
  devices: STANDARD_DEVICES.slice(0, 2),
}

describe("planRenders", () => {
  test("renders the default state on the first device when only the part is named", () => {
    const plan = planRenders(project, { part: "src/Button.atom.part.tsx" })
    expect(plan).toEqual({
      _tag: "Planned",
      jobs: [{ part: "src/Button.atom.part.tsx", state: "default", device: "iphone-16", viewport: phone }],
    })
  })

  test("expands * to every state and every device, states first", () => {
    const plan = planRenders(project, { part: "src/Button.atom.part.tsx", state: "*", devices: ["*"] })
    expect(plan._tag === "Planned" && plan.jobs.map(job => `${job.state}@${job.device}`)).toEqual([
      "default@iphone-16",
      "default@pixel-7",
      "Busy@iphone-16",
      "Busy@pixel-7",
    ])
  })

  test("selects all declared states across all parts without duplicate devices", () => {
    const plan = planRenders(project, { part: "*", state: "*", devices: ["iphone-16", "iphone-16"] })
    expect(plan._tag === "Planned" && plan.jobs).toEqual([
      { part: "src/Button.atom.part.tsx", state: "default", device: "iphone-16", viewport: phone },
      { part: "src/Button.atom.part.tsx", state: "Busy", device: "iphone-16", viewport: phone },
      { part: "src/pages/Home.page.part.tsx", state: "default", device: "iphone-16", viewport: phone },
    ])
    expect(planRenders({ ...project, parts: [] }, { part: "*" })._tag).toBe("Invalid")
    expect(planRenders(project, { part: "*", state: "Busy" })._tag).toBe("Invalid")
  })

  test("accepts a list of devices by id", () => {
    const plan = planRenders(project, { part: "src/pages/Home.page.part.tsx", devices: ["pixel-7"] })
    expect(plan._tag === "Planned" && plan.jobs.map(job => [job.device, job.viewport])).toEqual([["pixel-7", { width: 412, height: 915 }]])
  })

  test("refuses a known device the project does not list", () => {
    expect(planRenders(project, { part: "src/pages/Home.page.part.tsx", devices: ["monitor-24"] })._tag).toBe("Invalid")
  })

  test("withViewport gives a job its device's viewport, and refuses a device the project dropped", () => {
    expect(withViewport(project, { part: "p", state: "s", device: "pixel-7" }).viewport).toEqual({ width: 412, height: 915 })
    expect(() => withViewport(project, { part: "p", state: "s", device: "rg353m" })).toThrow('Caliper has no device "rg353m" in this project. Its devices are: iphone-16, pixel-7.')
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

  test("carries the take into every job", () => {
    const plan = planRenders(project, { part: "src/Button.atom.part.tsx", state: "*", take: "3" })
    expect(plan._tag === "Planned" && plan.jobs.map(job => job.take)).toEqual(["3", "3"])
    expect(planRenders(project, { part: "src/Button.atom.part.tsx", take: "x" })._tag).toBe("Invalid")
  })

  test("names the devices when a device is unknown", () => {
    expect(planRenders(project, { part: "src/Button.atom.part.tsx", devices: ["iphone"] })).toEqual({
      _tag: "Invalid",
      reason: 'Caliper has no device "iphone" in this project. Its devices are: iphone-16, pixel-7.',
    })
  })
})
