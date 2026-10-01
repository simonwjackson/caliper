// @ts-check
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai"
import { createTakeAgents, MAX_IDEA_TURNS, MAX_TURNS } from "../src/agent/take-agents.js"
import { planIdeaRenders } from "../src/agent/api.js"
import { createTakeStore } from "../src/takes/store.js"
import { createWorkspaceStore } from "../src/takes/workspaces.js"
import { STANDARD_DEVICES } from "../src/client/device-frame.js"

const files = {
  "src/Home.page.part.tsx": "export default function Home() { return <main>home</main> }\n",
  "src/Settings.page.part.tsx": "export default function Settings() { return <main>settings</main> }\nexport const Saving = () => <main>saving</main>\n",
  "src/home.css": "main { color: blue }\n",
}
const home = { _tag: /** @type {const} */ ("State"), part: "src/Home.page.part.tsx", state: "default" }
const settings = { _tag: /** @type {const} */ ("State"), part: "src/Settings.page.part.tsx", state: "default" }

/** @param {(root: string) => Promise<void>} run */
async function inFolder(run) {
  const root = mkdtempSync(join(tmpdir(), "caliper-ideas-"))
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

/**
 * Idea agents on a scripted model, in a workspace with two rows. The render
 * writes a real PNG and records each request.
 *
 * @param {string} root
 */
function setup(root) {
  const faux = fauxProvider({ models: [{ id: "scripted", reasoning: true, input: ["text", "image"] }] })
  const models = createModels()
  models.setProvider(faux.provider)
  const store = createTakeStore(root)
  const workspaces = createWorkspaceStore(root)
  const workspace = workspaces.create("Can Settings open with the d-pad?").id
  workspaces.pin(workspace, home)
  workspaces.pin(workspace, settings)
  /** @type {Array<{ take: string, state: string, devices: string[], part?: string, related?: boolean }>} */
  const renders = []
  const png = join(root, "shot.png")
  writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  /** @type {any[]} */
  const firsts = []
  /** @type {Set<() => void>} */
  const waiting = new Set()
  const agents = createTakeAgents({
    store, workspaces,
    engine: () => ({ models, model: faux.getModel(), reasoning: "high" }),
    renderFor: take => async request => {
      const { signal: _signal, ...selection } = request
      renders.push({ take, ...selection })
      const rows = request.related ? [home, settings] : [{ part: request.part ?? home.part, state: request.state }]
      return rows.map(row => ({ part: row.part, state: row.state, device: request.devices[0] ?? "", take, viewport: { width: 640, height: 480 }, frame: /** @type {const} */ ("Rendered"), png, problems: [], console: [], spill: null }))
    },
    onChange: () => { for (const resolve of waiting) { waiting.delete(resolve); resolve() } },
  })
  /** @param {string} take */
  const settled = async take => {
    for (;;) {
      let changed = () => {}
      const next = new Promise(resolve => { changed = () => resolve(undefined); waiting.add(changed) })
      const view = (await agents.ideas()).find(view => view.take === take)
      if (view?.run._tag !== "Running") {
        waiting.delete(changed)
        return /** @type {import("../src/types").IdeaView} */ (view)
      }
      await next
    }
  }
  return { faux, store, workspaces, workspace, agents, renders, settled, firsts }
}

const direction = { title: "Places in every header", brief: "Put Find and Settings beside the clock." }

describe("an idea's agent", () => {
  test("starts from the workspace's question and rows, with no part, and writes only into its idea", async () => {
    await inFolder(async root => {
      const { faux, store, workspace, agents, renders, settled } = setup(root)
      /** @type {any} */
      let first = null
      faux.setResponses([
        context => {
          first = context.messages.find(message => message.role === "user")
          return fauxAssistantMessage([fauxToolCall("write_file", { path: "src/home.css", content: "main { color: red }\n" })], { stopReason: "toolUse" })
        },
        fauxAssistantMessage([fauxToolCall("render", { rows: true })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxText("Moved the places into the header.")]),
      ])
      const take = await agents.start({ subject: { _tag: "Idea", workspace }, device: "rg353m", prompt: "Can Settings open with the d-pad?", direction, others: ["A row of places"] })
      const view = await settled(take)
      expect(view).toMatchObject({ take, device: "rg353m", name: "Places in every header", direction, run: { _tag: "Idle" }, files: ["src/home.css"] })
      expect(await agents.views()).toEqual([])
      expect(store.record(take)).toMatchObject({ subject: { _tag: "Idea", workspace }, device: "rg353m" })
      expect(store.original("src/home.css")).toContain("blue")
      const text = first.content.filter((/** @type {any} */ block) => block.type === "text").map((/** @type {any} */ block) => block.text).join("\n")
      expect(text).toContain("Can Settings open with the d-pad?")
      expect(text).toContain("Places in every header")
      expect(text).toContain("A row of places")
      expect(text).toContain("<file path=\"src/Home.page.part.tsx\">")
      expect(text).toContain("<file path=\"src/Settings.page.part.tsx\">")
      expect(first.content.filter((/** @type {any} */ block) => block.type === "image")).toHaveLength(2)
      // Before the first prompt and when the agent asks: every row of the board.
      expect(renders.filter(render => render.related).map(render => render.take)).toEqual([take, take])
    })
  })

  test("asks the workspace an open question in its own name, and takes a follow-up", async () => {
    await inFolder(async root => {
      const { faux, workspaces, workspace, agents, settled } = setup(root)
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("ask_question", { text: "Do Korri's places count as carts?" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxText("Asked.")]),
        fauxAssistantMessage([fauxText("Done again.")]),
      ])
      const take = await agents.start({ subject: { _tag: "Idea", workspace }, device: "rg353m", prompt: "Can Settings open with the d-pad?", direction })
      const view = await settled(take)
      expect(workspaces.read(workspace)?.questions).toEqual([{
        _tag: "Open", id: "1", text: "Do Korri's places count as carts?", asked: expect.any(Number),
        by: { _tag: "Idea", take, created: view.created, title: "Places in every header" },
      }])
      await agents.follow(take, "Make the header quieter.")
      expect((await settled(take)).log.filter(entry => entry._tag === "User").map(entry => entry._tag === "User" && entry.text)).toEqual(["Can Settings open with the d-pad?", "Make the header quieter."])
    })
  })

  test("an idea has a larger turn budget than a take, and its agent is told the budget", async () => {
    await inFolder(async root => {
      const { faux, workspace, agents, settled } = setup(root)
      /** @type {any} */
      let system = null
      // A turn that only reads, again and again: the run stops at the idea's budget.
      faux.setResponses(Array.from({ length: MAX_IDEA_TURNS + 5 }, (_, index) => context => {
        if (index === 0) system = JSON.stringify(context)
        return fauxAssistantMessage([fauxToolCall("read_file", { path: "src/home.css" })], { stopReason: "toolUse" })
      }))
      const take = await agents.start({ subject: { _tag: "Idea", workspace }, device: "rg353m", prompt: "q", direction })
      const view = await settled(take)
      expect(MAX_IDEA_TURNS).toBeGreaterThan(MAX_TURNS)
      expect(view.log.filter(entry => entry._tag === "Tool")).toHaveLength(MAX_IDEA_TURNS)
      expect(view.log.at(-1)).toEqual({ _tag: "Assistant", text: `Stopped after ${MAX_IDEA_TURNS} turns. Send another prompt to go on.` })
      expect(system).toContain(`${MAX_IDEA_TURNS} turns`)
    })
  })

  test("an idea cannot be accepted", async () => {
    await inFolder(async root => {
      const { faux, workspace, agents, settled } = setup(root)
      faux.setResponses([fauxAssistantMessage([fauxText("Nothing to do.")])])
      const take = await agents.start({ subject: { _tag: "Idea", workspace }, device: "rg353m", prompt: "q", direction })
      await settled(take)
      await expect(agents.accept(take)).rejects.toThrow("does not accept")
    })
  })
})

describe("what an idea renders", () => {
  const project = /** @type {import("../src/types").Project} */ (/** @type {unknown} */ ({
    name: "p", devices: STANDARD_DEVICES,
    parts: [
      { file: home.part, name: "Home", states: [{ export: "default", label: "Default" }] },
      { file: settings.part, name: "Settings", states: [{ export: "default", label: "Default" }, { export: "Saving", label: "Saving" }] },
      { file: "src/Places.part.tsx", name: "Places", states: [{ export: "default", label: "Default" }] },
    ],
  }))
  const device = STANDARD_DEVICES[0]?.id ?? ""

  test("every row of the board, once each", () => {
    const jobs = planIdeaRenders(project, [home, settings], { state: "default", devices: [device], related: true }, "4")
    expect(jobs.map(job => [job.part, job.state, job.take])).toEqual([[home.part, "default", "4"], [settings.part, "default", "4"]])
  })

  test("the first row by default, and any state the idea's files declare, including a part it adds", () => {
    expect(planIdeaRenders(project, [home, settings], { state: "default", devices: [device] }, "4").map(job => job.part)).toEqual([home.part])
    expect(planIdeaRenders(project, [home], { part: settings.part, state: "Saving", devices: [device] }, "4").map(job => job.state)).toEqual(["Saving"])
    expect(planIdeaRenders(project, [home], { part: "src/Places.part.tsx", state: "default", devices: [device] }, "4").map(job => job.part)).toEqual(["src/Places.part.tsx"])
    expect(() => planIdeaRenders(project, [home], { part: "src/Nope.part.tsx", state: "default", devices: [device] }, "4")).toThrow()
  })

  test("a row whose state is gone is named, not skipped", () => {
    expect(() => planIdeaRenders(project, [{ part: home.part, state: "Gone" }], { state: "default", devices: [device], related: true }, "4")).toThrow("Gone")
  })
})
