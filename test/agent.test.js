// @ts-check
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai"
import { resolveAgent } from "../src/agent/config.js"
import { createTakeAgents } from "../src/agent/take-agents.js"
import { createTakeStore } from "../src/takes/store.js"

/**
 * @param {Record<string, string>} files
 * @param {(root: string) => Promise<void> | void} run
 */
async function inFolder(files, run) {
  const root = mkdtempSync(join(tmpdir(), "caliper-agent-"))
  try {
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), content)
    }
    await run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe("resolveAgent", () => {
  const home = "/nonexistent-home"

  test("is off when vite.config has no agent", () => {
    expect(resolveAgent({ option: undefined, env: {}, home }).status._tag).toBe("Off")
  })

  test("takes the key from the environment and never shows it", () => {
    const { status, connection } = resolveAgent({
      option: { model: "m", baseUrl: "http://localhost:11434/v1/", reasoning: "high" },
      env: { CALIPER_AGENT_API_KEY: "secret-key" },
      home,
    })
    expect(status).toEqual({
      _tag: "Ready", model: "m", baseUrl: "http://localhost:11434/v1", reasoning: "high", api: "chat-completions",
      baseUrlFrom: "vite.config", keyFrom: "CALIPER_AGENT_API_KEY",
    })
    expect(JSON.stringify(status)).not.toContain("secret-key")
    expect(connection?.apiKey).toBe("secret-key")
  })

  test("reads the key from the variable apiKeyEnv names", () => {
    const { connection } = resolveAgent({ option: { model: "m", baseUrl: "https://x/v1", apiKeyEnv: "MY_KEY" }, env: { MY_KEY: "k" }, home })
    expect(connection?.apiKey).toBe("k")
  })

  test("fails with a hint when there is no key", () => {
    const { status } = resolveAgent({ option: { model: "m", baseUrl: "https://x/v1" }, env: {}, home })
    expect(status).toMatchObject({ _tag: "Failed", reason: "No API key for https://x/v1." })
    expect(status._tag === "Failed" && status.hint).toContain("CALIPER_AGENT_API_KEY")
  })

  test("fails on a missing model or an unknown reasoning level", () => {
    expect(resolveAgent({ option: /** @type {any} */ ({ baseUrl: "https://x/v1" }), env: {}, home }).status._tag).toBe("Failed")
    expect(resolveAgent({ option: /** @type {any} */ ({ model: "m", reasoning: "huge" }), env: {}, home }).status._tag).toBe("Failed")
  })

  test("falls back to the pi proxy file for the base URL and key", async () => {
    await inFolder({ ".pi/agent/cliproxyapi.json": JSON.stringify({ baseUrl: "https://proxy.example/", apiKey: "pi-key" }) }, root => {
      const { status, connection } = resolveAgent({ option: { model: "m" }, env: {}, home: root })
      expect(status).toMatchObject({ _tag: "Ready", baseUrl: "https://proxy.example/v1", keyFrom: "~/.pi/agent/cliproxyapi.json" })
      expect(connection?.apiKey).toBe("pi-key")
    })
  })

  test("never sends the pi proxy key to another endpoint", async () => {
    await inFolder({ ".pi/agent/cliproxyapi.json": JSON.stringify({ baseUrl: "https://proxy.example", apiKey: "pi-key" }) }, root => {
      expect(resolveAgent({ option: { model: "m", baseUrl: "https://other.example/v1" }, env: {}, home: root }).status._tag).toBe("Failed")
      expect(resolveAgent({ option: { model: "m", baseUrl: "https://proxy.example/v1" }, env: {}, home: root }).connection?.apiKey).toBe("pi-key")
    })
  })
})

const ask = { part: "src/Chip.part.tsx", state: "default", device: "rg353m" }
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7])
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 8])
const projectFiles = {
  "src/Chip.part.tsx": "export default function Part() { return null }\n",
  "src/chip.css": ".chip { color: blue }\n",
}

/**
 * A take-agents setup on a scripted model. The render writes a real PNG file
 * and records each request.
 *
 * @param {string} root
 */
function setup(root) {
  const faux = fauxProvider({ models: [{ id: "scripted", reasoning: true, input: ["text", "image"] }] })
  const models = createModels()
  models.setProvider(faux.provider)
  const store = createTakeStore(root)
  /** @type {Array<{ take: string, state: string, devices: string[], part?: string, related?: boolean }>} */
  const renders = []
  const png = join(root, "shot.png")
  writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  /** @type {Array<() => void>} */
  const waiting = []
  const agents = createTakeAgents({
    store,
    engine: () => ({ models, model: faux.getModel(), reasoning: "high" }),
    renderFor: (take, subject) => async request => {
      const { signal: _signal, ...selection } = request
      renders.push({ take, ...selection })
      return [{ part: request.part ?? subject.context?.part ?? subject.part, state: request.state, device: request.devices[0] ?? "", take, viewport: { width: 640, height: 480 }, frame: "Rendered", png, problems: [], console: [], spill: null }]
    },
    onChange: () => { for (const resolve of waiting.splice(0)) resolve() },
  })
  /** @param {string} take */
  const settled = async take => {
    while (agents.views().find(view => view.take === take)?.run._tag === "Running") {
      await new Promise(resolve => waiting.push(() => resolve(undefined)))
    }
    return /** @type {import("../src/types").TakeView} */ (agents.views().find(view => view.take === take))
  }
  return { faux, store, agents, renders, settled }
}

describe("a take's agent", () => {
  test("generates a name through the model tool and persists it across restart", async () => {
    await inFolder(projectFiles, async root => {
      const { faux, agents, settled } = setup(root)
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("name_take", { name: "Warm chip" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxText("Named the design.")]),
      ])
      const take = agents.start({ ...ask, prompt: "Warm it up" })
      expect((await settled(take)).name).toBe("Warm chip")
      expect(setup(root).agents.views().find(view => view.take === take)?.name).toBe("Warm chip")
    })
  })

  test("reports a missing name without inventing a generated title", async () => {
    await inFolder(projectFiles, async root => {
      const { faux, agents, settled } = setup(root)
      faux.setResponses([fauxAssistantMessage([fauxText("No name.")])])
      const view = await settled(agents.start({ ...ask, prompt: "Do something" }))
      expect(view.name).toBeUndefined()
      expect(view.nameIssue).toContain("No generated name")
    })
  })

  test("uses a planned title without needing another model call", async () => {
    await inFolder(projectFiles, async root => {
      const { faux, agents, settled } = setup(root)
      faux.setResponses([fauxAssistantMessage([fauxText("Done.")])])
      const view = await settled(agents.start({ ...ask, prompt: "Go", direction: { title: "Quiet contrast", brief: "Reduce emphasis." } }))
      expect(view.name).toBe("Quiet contrast")
      expect(view.nameIssue).toBeUndefined()
    })
  })

  test("prepares an alternate separately and cannot replace through accept", async () => {
    await inFolder(projectFiles, async root => {
      const { faux, agents, store, settled } = setup(root)
      const source = store.create(ask)
      store.write(source, "src/chip.css", ".chip { color: red }")
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("reset_file", { path: "src/chip.css" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("write_file", { path: "src/Alternate.part.tsx", content: "export default function Alternate() { return <span>alternate</span> }" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("submit_integration", { strategy: "component", summary: "A separate chip", shared: "No behavior duplicated", preserved: "The existing chip is unchanged", usage: "Import the alternate chip", preview: { part: "src/Alternate.part.tsx", state: "default" } })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxText("Ready for review.")]),
      ])
      const proposal = agents.alternate(source)
      expect(proposal).not.toBe(source)
      const view = await settled(proposal)
      expect(view.integration?._tag).toBe("Review")
      expect(store.read(source, "src/chip.css")).toContain("red")
      expect(store.original("src/chip.css")).toContain("blue")
      expect(() => agents.accept(proposal)).toThrow("integration proposal")
      expect(store.record(source)).not.toBeNull()
      const review = await agents.integration.check(proposal, async () => "Fixture render checks passed.")
      agents.apply(proposal, review.revision, true)
      /** @type {any} */
      let seen
      faux.setResponses([context => { seen = context; return fauxAssistantMessage([fauxText("New experiment.")]) }])
      const next = agents.start({ ...ask, part: "src/Alternate.part.tsx", prompt: "A new subject" })
      expect(next).toBe(proposal)
      await settled(next)
      expect(seen.messages.filter((/** @type {any} */ message) => message.role === "user")).toHaveLength(1)
      expect(seen.messages.find((/** @type {any} */ message) => message.role === "user").content[0].text).toContain("The editing subject is src/Alternate.part.tsx")
    })
  })

  test("edits a copy in its take, renders it, and reports", async () => {
    await inFolder(projectFiles, async root => {
      const { faux, agents, renders, settled } = setup(root)
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("edit_file", { path: "src/chip.css", old_text: "blue", new_text: "red" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("render", {})], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxText("Made the chip red in src/chip.css.")]),
      ])
      const take = agents.start({ ...ask, prompt: "Make the chip red" })
      expect(agents.views()[0]?.run._tag).toBe("Running")
      const view = await settled(take)

      expect(view.run).toEqual({ _tag: "Idle" })
      expect(view.files).toEqual(["src/chip.css"])
      expect(readFileSync(join(root, ".caliper/takes", take, "src/chip.css"), "utf8")).toContain("red")
      expect(readFileSync(join(root, "src/chip.css"), "utf8")).toContain("blue")
      // One render before the first request, one from the tool.
      expect(renders).toEqual([
        { take, state: "default", devices: ["rg353m"] },
        { take, state: "default", devices: ["rg353m"] },
      ])
      expect(view.log.map(entry => entry._tag === "Tool" ? `${entry.name} ${entry.subject} ${entry.outcome}` : entry._tag)).toEqual([
        "User", "edit_file src/chip.css Done", "render as asked Done", "Assistant",
      ])
      expect(view.log.at(-1)).toEqual({ _tag: "Assistant", text: "Made the chip red in src/chip.css." })
    })
  })

  test("sends the part source and the current render in the first request, at the configured reasoning level", async () => {
    await inFolder(projectFiles, async root => {
      const { faux, agents, settled } = setup(root)
      /** @type {any} */
      let seen = null
      faux.setResponses([(context, options) => {
        seen = { context, options }
        return fauxAssistantMessage([fauxText("ok")])
      }])
      await settled(agents.start({ ...ask, prompt: "Look" }))
      const user = seen.context.messages.find((/** @type {any} */ message) => message.role === "user")
      const kinds = user.content.map((/** @type {any} */ block) => block.type)
      expect(kinds).toEqual(["text", "text", "image"])
      expect(user.content[0].text).toContain("export default function Part()")
      expect(seen.options.reasoning).toBe("high")
    })
  })

  test("gives the model the images attached to each prompt, labelled apart from the render", async () => {
    await inFolder(projectFiles, async root => {
      const { faux, agents, settled } = setup(root)
      /** @type {any[]} */
      const seen = []
      faux.setResponses([
        context => { seen.push(context.messages.at(-1)); return fauxAssistantMessage([fauxText("ok")]) },
        context => { seen.push(context.messages.at(-1)); return fauxAssistantMessage([fauxText("ok")]) },
      ])
      const mock = { name: "mock.png", mimeType: /** @type {const} */ ("image/png"), bytes: PNG_BYTES }
      const take = agents.start({ ...ask, prompt: "Match this", images: [mock] })
      await settled(take)
      const first = seen[0].content
      expect(first.map((/** @type {any} */ block) => block.type)).toEqual(["text", "text", "image", "text", "image"])
      expect(first[3].text).toBe("Images I attached to this prompt: mock.png. They are reference material, not the part as it renders now.")
      expect(first[4]).toEqual({ type: "image", data: PNG_BYTES.toString("base64"), mimeType: "image/png" })
      agents.follow(take, "And this", [{ name: "second.jpg", mimeType: "image/jpeg", bytes: JPEG_BYTES }])
      const view = await settled(take)
      const next = seen[1].content
      expect(next.map((/** @type {any} */ block) => block.type)).toEqual(["text", "text", "image"])
      expect(next[0].text).toBe("And this")
      expect(next[1].text).toBe("Images I attached to this prompt: second.jpg. They are reference material, not the part as it renders now.")
      expect(next[2].data).toBe(JPEG_BYTES.toString("base64"))
      expect(view.log.filter(entry => entry._tag === "User")).toEqual([
        { _tag: "User", text: "Match this", images: ["1.png"] },
        { _tag: "User", text: "And this", images: ["2.jpg"] },
      ])
    })
  })

  test("after a restart, the agent's first message carries every image of the take", async () => {
    await inFolder(projectFiles, async root => {
      const before = setup(root)
      before.faux.setResponses([fauxAssistantMessage([fauxText("ok")])])
      const take = before.agents.start({ ...ask, prompt: "Match this", images: [{ name: "mock.png", mimeType: "image/png", bytes: PNG_BYTES }] })
      await before.settled(take)
      const { faux, agents, settled } = setup(root)
      /** @type {any} */
      let seen = null
      faux.setResponses([context => { seen = context.messages.at(-1); return fauxAssistantMessage([fauxText("ok")]) }])
      agents.follow(take, "Go on")
      await settled(take)
      // The render comes first, then the image from the earlier prompt.
      expect(seen.content.map((/** @type {any} */ block) => block.type)).toEqual(["text", "text", "image", "text", "image"])
      expect(seen.content[3].text).toBe("Images I attached to earlier prompts in this take: mock.png. They are reference material, not the part as it renders now.")
      expect(seen.content[4].data).toBe(PNG_BYTES.toString("base64"))
    })
  })

  test("a composed take persists its preview and gives the model both sources and context-default rendering", async () => {
    await inFolder({ ...projectFiles, "src/Home.part.tsx": "export function Ready() { return <main>home</main> }" }, async root => {
      const { faux, store, agents, renders, settled } = setup(root)
      let seen = ""
      faux.setResponses([
        context => {
          seen = JSON.stringify(context)
          return fauxAssistantMessage([fauxToolCall("render", {})], { stopReason: "toolUse" })
        },
        fauxAssistantMessage([fauxToolCall("render", { part: ask.part })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("render", { related: true, device: "*" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxText("Checked the declared scenarios.")]),
      ])
      const context = { part: "src/Home.part.tsx", state: "Ready" }
      const take = agents.start({ ...ask, context, prompt: "Change the chip in Home" })
      const view = await settled(take)
      expect(view.context).toEqual(context)
      expect(store.record(take)?.context).toEqual(context)
      expect(seen).toContain("The editing subject is src/Chip.part.tsx")
      expect(seen).toContain("The preview is src/Home.part.tsx")
      expect(seen).toContain("<main>home</main>")
      expect(seen).toContain("export default function Part()")
      expect(renders).toEqual([
        { take, state: "Ready", devices: ["rg353m"] },
        { take, state: "Ready", devices: ["rg353m"] },
        { take, part: ask.part, state: "default", devices: ["rg353m"] },
        { take, state: "Ready", devices: ["*"], related: true },
      ])
      expect(view.log.some(entry => entry._tag === "Tool" && entry.subject === "all declared related scenarios")).toBe(true)
    })
  })

  test("old take records remain isolated when the server reloads them", async () => {
    await inFolder(projectFiles, async root => {
      const { store } = setup(root)
      const take = store.create(ask)
      const { agents, faux, settled } = setup(root)
      expect(agents.views()[0]?.context).toBeUndefined()
      faux.setResponses([fauxAssistantMessage([fauxText("Continued.")])])
      agents.follow(take, "Go on")
      expect((await settled(take)).run).toEqual({ _tag: "Idle" })
    })
  })

  test("a take started from a plan follows its direction and knows what its siblings try", async () => {
    await inFolder(projectFiles, async root => {
      const { faux, agents, settled } = setup(root)
      /** @type {any} */
      let seen = null
      faux.setResponses([context => {
        seen = context
        return fauxAssistantMessage([fauxText("ok")])
      }])
      const direction = { title: "Shared fixtures", brief: "Use the project's fixture catalog." }
      const take = agents.start({ ...ask, prompt: "More variety", direction, others: ["Hard cases", "New layout"] })
      const view = await settled(take)
      const text = seen.messages.find((/** @type {any} */ message) => message.role === "user").content[0].text
      expect(text).toContain("This take's direction: Shared fixtures. Use the project's fixture catalog.")
      expect(text).toContain('Other takes of this prompt try: "Hard cases", "New layout"')
      expect(view.direction).toEqual(direction)
      expect(text).not.toContain("strange direction")
    })
  })

  test("a take that follows the strange direction is told not to drift back to the usual pattern", async () => {
    await inFolder(projectFiles, async root => {
      const { faux, agents, settled } = setup(root)
      /** @type {any} */
      let seen = null
      faux.setResponses([context => {
        seen = context
        return fauxAssistantMessage([fauxText("ok")])
      }])
      const direction = { title: "Shelf as a timeline", brief: "Order by last play.", strange: /** @type {const} */ (true) }
      const view = await settled(agents.start({ ...ask, prompt: "More variety", direction, others: ["Hard cases"] }))
      const text = seen.messages.find((/** @type {any} */ message) => message.role === "user").content[0].text
      expect(text).toContain("This is the strange direction")
      expect(view.direction).toEqual(direction)
    })
  })

  test("cannot write outside the project; the tool fails and the agent goes on", async () => {
    await inFolder(projectFiles, async root => {
      const { faux, agents, settled } = setup(root)
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("write_file", { path: "../escape.css", content: "x" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxText("I could not write that file.")]),
      ])
      const view = await settled(agents.start({ ...ask, prompt: "Escape" }))
      const tool = view.log.find(entry => entry._tag === "Tool")
      expect(tool).toMatchObject({ name: "write_file", outcome: "Failed" })
      expect(tool?._tag === "Tool" && tool.detail).toContain("outside the project")
      expect(view.run._tag).toBe("Idle")
    })
  })

  test("shows the model's error as a failed run", async () => {
    await inFolder(projectFiles, async root => {
      const { faux, agents, settled } = setup(root)
      faux.setResponses([fauxAssistantMessage([], { stopReason: "error", errorMessage: "401 Unauthorized" })])
      const view = await settled(agents.start({ ...ask, prompt: "Go" }))
      expect(view.run).toEqual({ _tag: "Failed", reason: "401 Unauthorized" })
    })
  })

  test("fails the take, not the server, when the agent has no connection", async () => {
    await inFolder(projectFiles, async root => {
      const store = createTakeStore(root)
      const agents = createTakeAgents({
        store,
        engine: () => { throw new Error("No API key for https://x/v1.") },
        renderFor: () => async () => [],
        onChange: () => {},
      })
      const take = agents.start({ ...ask, prompt: "Go" })
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(agents.views().find(view => view.take === take)?.run).toEqual({ _tag: "Failed", reason: "No API key for https://x/v1." })
    })
  })

  test("a follow-up prompt continues the same conversation", async () => {
    await inFolder(projectFiles, async root => {
      const { faux, agents, settled } = setup(root)
      faux.setResponses([fauxAssistantMessage([fauxText("First.")])])
      const take = agents.start({ ...ask, prompt: "One" })
      await settled(take)
      /** @type {any} */
      let seen = null
      faux.setResponses([context => {
        seen = context
        return fauxAssistantMessage([fauxText("Second.")])
      }])
      agents.follow(take, "Two")
      const view = await settled(take)
      expect(seen.messages.filter((/** @type {any} */ message) => message.role === "user")).toHaveLength(2)
      expect(view.log.map(entry => entry._tag === "Tool" ? entry.name : entry._tag === "Edit" ? `Edit: ${entry.file}` : `${entry._tag}: ${entry.text.slice(0, 5)}`)).toEqual([
        "User: One", "Assistant: First", "User: Two", "Assistant: Secon",
      ])
    })
  })

  test("accept copies the take into the project; discard throws it away", async () => {
    await inFolder(projectFiles, async root => {
      const { faux, agents, settled } = setup(root)
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("write_file", { path: "src/chip.css", content: ".chip { color: red }\n" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxText("Done.")]),
        fauxAssistantMessage([fauxToolCall("write_file", { path: "src/chip.css", content: ".chip { color: green }\n" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxText("Done.")]),
      ])
      const first = agents.start({ ...ask, prompt: "Red" })
      await settled(first)
      const second = agents.start({ ...ask, prompt: "Green" })
      await settled(second)
      expect(agents.accept(first)).toEqual(["src/chip.css"])
      agents.discard(second)
      expect(readFileSync(join(root, "src/chip.css"), "utf8")).toContain("red")
      expect(agents.views()).toEqual([])
    })
  })
})

describe("chains of takes", () => {
  /**
   * Take 1 from a prompt, take 2 made from 1, take 3 made from 2, and take 4
   * from another prompt. Each chain take edits the chip.
   * @param {ReturnType<typeof createTakeStore>} store
   */
  const chainOfThree = store => {
    /** @param {string} take */
    const identity = take => ({ take, created: /** @type {import("../src/takes/store.js").TakeRecord} */ (store.record(take)).created })
    /** @param {string[]} lineage */
    const from = lineage => {
      const ids = lineage.map(identity)
      return { ...ask, parent: /** @type {{ take: string, created: number }} */ (ids.at(-1)), chain: /** @type {{ take: string, created: number }} */ (ids[0]), history: { prompt: null, lineage: ids, passes: [] }, marks: [] }
    }
    const one = store.create({ ...ask, prompt: "Red" })
    store.write(one, "src/chip.css", ".chip { color: red }\n")
    const two = store.fork(one, from([one]))
    store.write(two, "src/chip.css", ".chip { color: darkred }\n")
    const three = store.fork(two, from([one, two]))
    const four = store.create({ ...ask, prompt: "Green" })
    store.write(four, "src/chip.css", ".chip { color: green }\n")
    return { one, two, three, four, identity }
  }

  test("views carry each take's parent, chain and lineage", async () => {
    await inFolder(projectFiles, root => {
      const { agents, store } = setup(root)
      const { one, two, three, four, identity } = chainOfThree(store)
      const view = (/** @type {string} */ take) => agents.views().find(candidate => candidate.take === take)
      expect(view(one)).not.toHaveProperty("chain")
      expect(view(four)).not.toHaveProperty("lineage")
      expect(view(three)).toMatchObject({ parent: identity(two), chain: identity(one), lineage: [identity(one), identity(two)] })
    })
  })

  test("accept copies the accepted take and removes its whole chain; other chains stay", async () => {
    await inFolder(projectFiles, root => {
      const { agents, store } = setup(root)
      const { two, four } = chainOfThree(store)
      expect(agents.accept(two)).toEqual(["src/chip.css"])
      expect(readFileSync(join(root, "src/chip.css"), "utf8")).toContain("darkred")
      expect(agents.views().map(view => view.take)).toEqual([four])
      expect(store.accepted().map(record => record.take)).toEqual([two])
    })
  })

  test("accepting the chain's first take removes the takes made from it", async () => {
    await inFolder(projectFiles, root => {
      const { agents, store } = setup(root)
      const { one, four } = chainOfThree(store)
      agents.accept(one)
      expect(readFileSync(join(root, "src/chip.css"), "utf8")).toContain("color: red")
      expect(agents.views().map(view => view.take)).toEqual([four])
    })
  })

  test("discard removes one take; the takes made from it keep their lineage", async () => {
    await inFolder(projectFiles, root => {
      const { agents, store } = setup(root)
      const { one, two, three, four, identity } = chainOfThree(store)
      agents.discard(two)
      expect(agents.views().map(view => view.take)).toEqual([one, three, four])
      expect(agents.views().find(view => view.take === three)).toMatchObject({ lineage: [identity(one), { take: two }] })
    })
  })
})

describe("hand edits in a take", () => {
  test("a hand edit saves to the take, and the real file does not change", async () => {
    await inFolder(projectFiles, async root => {
      const { agents, store } = setup(root)
      // A take with no agent yet: after a server restart, its conversation is gone.
      const take = store.create(ask)
      agents.editByHand(take, "src/chip.css", ".chip { color: teal }\n")
      const view = agents.views().find(candidate => candidate.take === take)
      expect(view).toMatchObject({ run: { _tag: "Idle" }, files: ["src/chip.css"], log: [{ _tag: "Edit", file: "src/chip.css" }] })
      expect(readFileSync(join(root, ".caliper/takes", take, "src/chip.css"), "utf8")).toContain("teal")
      expect(readFileSync(join(root, "src/chip.css"), "utf8")).toContain("blue")
    })
  })

  test("editing a file back to the real content removes the take's copy", async () => {
    await inFolder(projectFiles, async root => {
      const { agents, store } = setup(root)
      const take = store.create(ask)
      agents.editByHand(take, "src/chip.css", ".chip { color: teal }\n")
      expect(agents.editByHand(take, "src/chip.css", projectFiles["src/chip.css"])).toEqual([])
      // One entry per run of edits to the same file.
      expect(agents.views()[0]?.log).toEqual([{ _tag: "Edit", file: "src/chip.css" }])
    })
  })

  test("refuses a hand edit outside the project", async () => {
    await inFolder(projectFiles, async root => {
      const { agents, store } = setup(root)
      const take = store.create(ask)
      expect(() => agents.editByHand(take, "../outside.css", "x")).toThrow("outside the project")
      expect(agents.views()[0]?.files).toEqual([])
    })
  })

  test("the agent's first message says which files you already edited", async () => {
    await inFolder(projectFiles, async root => {
      const { faux, agents, settled, store } = setup(root)
      /** @type {any} */
      let seen = null
      faux.setResponses([context => {
        seen = context
        return fauxAssistantMessage([fauxText("ok")])
      }])
      const take = store.create(ask)
      agents.editByHand(take, "src/chip.css", ".chip { color: teal }\n")
      agents.follow(take, "Now make it bigger")
      await settled(take)
      const user = seen.messages.find((/** @type {any} */ message) => message.role === "user")
      expect(user.content[0].text).toStartWith('I already edited "src/chip.css" by hand in this take.')
      expect(user.content[0].text).toContain("Now make it bigger")
    })
  })

  test("a follow-up prompt says which files you edited since the agent's last turn, once", async () => {
    await inFolder(projectFiles, async root => {
      const { faux, agents, settled } = setup(root)
      faux.setResponses([fauxAssistantMessage([fauxText("First.")])])
      const take = agents.start({ ...ask, prompt: "One" })
      await settled(take)
      agents.editByHand(take, "src/chip.css", ".chip { color: teal }\n")
      /** @type {string[]} */
      const prompts = []
      const answer = (/** @type {any} */ context) => {
        prompts.push(context.messages.at(-1).content.at(0)?.text ?? context.messages.at(-1).content)
        return fauxAssistantMessage([fauxText("ok")])
      }
      faux.setResponses([answer, answer])
      agents.follow(take, "Two")
      await settled(take)
      agents.follow(take, "Three")
      await settled(take)
      expect(prompts).toEqual([
        'I edited "src/chip.css" by hand since your last turn. Read it again before you change it.\n\nTwo',
        "Three",
      ])
    })
  })

  test("refuses a hand edit while the take's agent works", async () => {
    await inFolder(projectFiles, async root => {
      const { faux, agents, settled } = setup(root)
      faux.setResponses([fauxAssistantMessage([fauxText("Done.")])])
      const take = agents.start({ ...ask, prompt: "Go" })
      expect(() => agents.editByHand(take, "src/chip.css", "x")).toThrow("agent is working")
      await settled(take)
    })
  })
})
