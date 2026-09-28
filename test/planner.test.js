// @ts-check
import { describe, expect, test } from "bun:test"
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai"
import { cleanPlan, planDirections } from "../src/agent/planner.js"

/** @param {import("@earendil-works/pi-ai").FauxResponseStep[]} responses */
function engineWith(responses) {
  const faux = fauxProvider({ models: [{ id: "planner", reasoning: true, input: ["text", "image"] }] })
  const models = createModels()
  models.setProvider(faux.provider)
  faux.setResponses(responses)
  return /** @type {import("../src/agent/model.js").Engine} */ ({ models, model: faux.getModel(), reasoning: "medium" })
}

const input = {
  prompt: "More variety",
  count: 3,
  part: "src/Home.part.tsx",
  state: "default",
  device: "rg353m",
  context: [{ type: /** @type {const} */ ("text"), text: "<file>…</file>" }],
}

describe("the planner", () => {
  test("returns the directions the model proposes, and shows it the request and the part", async () => {
    /** @type {any} */
    let seen = null
    const engine = engineWith([(context, options) => {
      seen = { context, options }
      return fauxAssistantMessage([fauxToolCall("propose_directions", {
        directions: [
          { title: "Shared fixtures", brief: "Use the fixture catalog." },
          { title: "Hard cases", brief: "Long titles and no art." },
          { title: "Denser shelf", brief: "Smaller carts, more per row." },
        ],
      })], { stopReason: "toolUse" })
    }])
    const plan = await planDirections({ engine, ...input })
    expect(plan.directions.map(direction => direction.title)).toEqual(["Shared fixtures", "Hard cases", "Denser shelf"])
    expect(plan.note).toBeUndefined()
    const byRole = (/** @type {string} */ role) => seen.context.messages.find((/** @type {any} */ message) => message.role === role)
    expect(JSON.stringify(byRole("system"))).toContain("Propose up to 3 directions")
    expect(byRole("user").content[0].text).toContain("More variety")
    expect(byRole("user").content[1].text).toBe("<file>…</file>")
    expect(seen.options.reasoning).toBe("medium")
  })

  test("shows the model the images attached to the prompt, after the part", async () => {
    /** @type {any} */
    let seen = null
    const engine = engineWith([context => {
      seen = context.messages.find(message => message.role === "user")
      return fauxAssistantMessage([fauxToolCall("propose_directions", { directions: [{ title: "A", brief: "one" }, { title: "B", brief: "two" }] })], { stopReason: "toolUse" })
    }])
    const images = [{ name: "mock.png", mimeType: /** @type {const} */ ("image/png"), bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }]
    await planDirections({ engine, ...input, images })
    expect(seen.content.map((/** @type {any} */ block) => block.type)).toEqual(["text", "text", "text", "image"])
    expect(seen.content[2].text).toBe("Images I attached to this prompt: mock.png. They are reference material, not the part as it renders now.")
    expect(seen.content[3]).toEqual({ type: "image", data: "iVBORw==", mimeType: "image/png" })
  })

  test("may return fewer directions than asked for, with a reason", async () => {
    const engine = engineWith([fauxAssistantMessage([fauxToolCall("propose_directions", {
      directions: [{ title: "Use the fixtures", brief: "The one sensible answer." }],
      note: "The request is a narrow data change.",
    })], { stopReason: "toolUse" })])
    expect(await planDirections({ engine, ...input })).toEqual({
      directions: [{ title: "Use the fixtures", brief: "The one sensible answer." }],
      note: "The request is a narrow data change.",
    })
  })

  test("fails visibly when the model answers without proposing, or the request fails", async () => {
    await expect(planDirections({ engine: engineWith([fauxAssistantMessage([fauxText("Here are some ideas.")])]), ...input }))
      .rejects.toThrow("The planner did not propose any directions.")
    await expect(planDirections({ engine: engineWith([fauxAssistantMessage([], { stopReason: "error", errorMessage: "401" })]), ...input }))
      .rejects.toThrow("The planner failed: 401")
  })

  test("cleanPlan drops empty and repeated directions and keeps at most the count", () => {
    expect(cleanPlan({
      directions: [
        { title: "A", brief: "one" },
        { title: "a", brief: "same title" },
        { title: "", brief: "no title" },
        { title: "B", brief: "" },
        { title: "C", brief: "three" },
        { title: "D", brief: "four" },
      ],
      note: "ignored when the count is met",
    }, 2)).toEqual({ directions: [{ title: "A", brief: "one" }, { title: "C", brief: "three" }] })
    expect(() => cleanPlan({ directions: [] }, 2)).toThrow("no usable directions")
  })
})
