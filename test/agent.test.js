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
  /** @type {Array<{ take: string, state: string, devices: string[] }>} */
  const renders = []
  const png = join(root, "shot.png")
  writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  /** @type {Array<() => void>} */
  const waiting = []
  const agents = createTakeAgents({
    store,
    engine: () => ({ models, model: faux.getModel(), reasoning: "high" }),
    renderFor: take => async request => {
      renders.push({ take, ...request })
      return [{ part: ask.part, state: request.state, device: request.devices[0] ?? "", take, viewport: { width: 640, height: 480 }, frame: "Rendered", png, problems: [], console: [], spill: null }]
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
      expect(view.log.map(entry => entry._tag === "Tool" ? entry.name : `${entry._tag}: ${entry.text.slice(0, 5)}`)).toEqual([
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
