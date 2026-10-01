// @ts-check
import { describe, expect, test } from "bun:test"
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai"
import { cleanPlan, planDirections, planIdeas } from "../src/agent/planner.js"

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
  device: "iphone-16",
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

  test("with 3 or more takes, asks for one strange direction and keeps its mark", async () => {
    /** @type {any} */
    let seen = null
    const engine = engineWith([context => {
      seen = context
      return fauxAssistantMessage([fauxToolCall("propose_directions", {
        directions: [
          { title: "Shared fixtures", brief: "Use the fixture catalog." },
          { title: "Hard cases", brief: "Long titles and no art." },
          { title: "Shelf as a timeline", brief: "Order the games by last play on one line.", strange: true },
        ],
      })], { stopReason: "toolUse" })
    }])
    const plan = await planDirections({ engine, ...input })
    expect(plan.directions[2]).toEqual({ title: "Shelf as a timeline", brief: "Order the games by last play on one line.", strange: true })
    expect(plan.directions.filter(direction => direction.strange)).toHaveLength(1)
    const system = JSON.stringify(seen.messages.find((/** @type {any} */ message) => message.role === "system") ?? seen.systemPrompt)
    expect(system).toContain("strange direction")
  })

  test("with 2 takes, does not ask for a strange direction", async () => {
    /** @type {any} */
    let seen = null
    const engine = engineWith([context => {
      seen = context
      return fauxAssistantMessage([fauxToolCall("propose_directions", {
        directions: [{ title: "A", brief: "one" }, { title: "B", brief: "two" }],
      })], { stopReason: "toolUse" })
    }])
    await planDirections({ engine, ...input, count: 2 })
    const system = JSON.stringify(seen.messages.find((/** @type {any} */ message) => message.role === "system") ?? seen.systemPrompt)
    expect(system).not.toContain("strange direction")
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

  test("cleanPlan keeps one strange mark, and none below 3 takes", () => {
    const three = [
      { title: "A", brief: "one", strange: true },
      { title: "B", brief: "two", strange: true },
      { title: "C", brief: "three", strange: "yes" },
    ]
    expect(cleanPlan({ directions: three }, 3)).toEqual({
      directions: [{ title: "A", brief: "one", strange: true }, { title: "B", brief: "two" }, { title: "C", brief: "three" }],
    })
    expect(cleanPlan({ directions: three.slice(0, 2) }, 2)).toEqual({
      directions: [{ title: "A", brief: "one" }, { title: "B", brief: "two" }],
    })
  })

  test("cleanPlan keeps the note that says why no direction is strange", () => {
    const plain = [{ title: "A", brief: "one" }, { title: "B", brief: "two" }, { title: "C", brief: "three" }]
    expect(cleanPlan({ directions: plain, note: "A precise fix has no strange answer." }, 3))
      .toEqual({ directions: plain, note: "A precise fix has no strange answer." })
    expect(cleanPlan({ directions: [...plain.slice(0, 2), { ...plain[2], strange: true }], note: "Not needed." }, 3))
      .toEqual({ directions: [...plain.slice(0, 2), { ...plain[2], strange: true }] })
  })
})

describe("the planner for a workspace", () => {
  const question = {
    question: "A person can open Settings using only the d-pad, A and B.",
    count: 3,
    rows: [{ part: "src/Home.page.part.tsx", state: "default" }, { part: "src/Settings.page.part.tsx", state: "default" }],
    device: "rg353m",
    context: [{ type: /** @type {const} */ ("text"), text: "<file path=\"src/Home.page.part.tsx\">…</file>" }],
  }

  test("plans ideas from the question and its rows, and names the workspace", async () => {
    /** @type {any} */
    let seen = null
    const engine = engineWith([context => {
      seen = context
      return fauxAssistantMessage([fauxToolCall("propose_ideas", {
        name: "Settings with the d-pad",
        directions: [
          { title: "A row of places", brief: "Find and Settings under the shelf." },
          { title: "Places in every header", brief: "Find and Settings beside the clock." },
          { title: "Settings is a cart", brief: "Stand Settings on the shelf.", strange: true },
        ],
      })], { stopReason: "toolUse" })
    }])
    const plan = await planIdeas({ engine, ...question })
    expect(plan).toEqual({
      name: "Settings with the d-pad",
      directions: [
        { title: "A row of places", brief: "Find and Settings under the shelf." },
        { title: "Places in every header", brief: "Find and Settings beside the clock." },
        { title: "Settings is a cart", brief: "Stand Settings on the shelf.", strange: true },
      ],
    })
    const user = seen.messages.find((/** @type {any} */ message) => message.role === "user")
    expect(user.content[0].text).toContain("A person can open Settings using only the d-pad, A and B.")
    expect(user.content[0].text).toContain("src/Home.page.part.tsx, state \"default\"")
    expect(user.content[0].text).toContain("src/Settings.page.part.tsx, state \"default\"")
    expect(user.content[1].text).toContain("src/Home.page.part.tsx")
    const system = JSON.stringify(seen.systemPrompt ?? seen.messages)
    expect(system).toContain("reuse")
    expect(system).toContain("strange direction")
  })

  test("leaves the name out when the model gives none, and fails visibly with no directions", async () => {
    const engine = engineWith([fauxAssistantMessage([fauxToolCall("propose_ideas", { directions: [{ title: "A", brief: "one" }, { title: "B", brief: "two" }] })], { stopReason: "toolUse" })])
    expect(await planIdeas({ engine, ...question, count: 2 })).toEqual({ directions: [{ title: "A", brief: "one" }, { title: "B", brief: "two" }] })
    await expect(planIdeas({ engine: engineWith([fauxAssistantMessage([fauxText("Some ideas.")])]), ...question }))
      .rejects.toThrow("The planner did not propose any ideas.")
  })
})
