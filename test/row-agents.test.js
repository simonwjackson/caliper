// @ts-check
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai"
import { createRowAgents, MAX_ROW_TURNS } from "../src/agent/row-agents.js"
import { createWorkspaceStore } from "../src/takes/workspaces.js"

/**
 * Workspaces slice 2: a row agent writes one scratch row, renders it in Today
 * with its checks, and touches nothing else.
 */

const files = {
  "src/Home.page.part.tsx": "export default function Home() { return <main>home</main> }\n",
  "src/Home.tsx": "export const Home = () => <main><button>Settings</button></main>\n",
}
const ROW = 'import { Home } from "../../../../src/Home"\nexport const name = "Home by keyboard"\nexport default function Row() { return <Home /> }\n'

/** @param {(root: string) => Promise<void>} run */
async function inFolder(run) {
  const root = mkdtempSync(join(tmpdir(), "caliper-rows-"))
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

/** @param {string} root */
function setup(root) {
  const faux = fauxProvider({ models: [{ id: "scripted", reasoning: true, input: ["text", "image"] }] })
  const models = createModels()
  models.setProvider(faux.provider)
  const workspaces = createWorkspaceStore(root)
  const workspace = workspaces.create("Can Settings open with the d-pad?").id
  workspaces.pin(workspace, { part: "src/Home.page.part.tsx", state: "default" })
  /** @type {Array<{ workspace: string, file: string, device: string }>} */
  const renders = []
  /** @type {Array<{ workspace: string, file: string }>} */
  const done = []
  const png = join(root, "shot.png")
  writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  /** @type {Set<() => void>} */
  const waiting = new Set()
  const agents = createRowAgents({
    workspaces,
    engine: () => ({ models, model: faux.getModel(), reasoning: "high" }),
    renderRow: async (id, file, device) => {
      renders.push({ workspace: id, file, device })
      return [{
        part: `.caliper/workspaces/${id}/${file}`, state: "default", device, viewport: { width: 640, height: 480 }, frame: /** @type {const} */ ("Rendered"), png, problems: [], console: [], spill: null,
        authored: { status: /** @type {const} */ ("Failed"), reason: "", provenance: { kind: /** @type {const} */ ("Original"), files: [], changedDeclarations: [] },
          checks: [{ name: "A opens Settings", source: { file: "row", line: 4 }, status: /** @type {const} */ ("Failed"), reason: /** @type {const} */ ("CheckError"), detail: "No control named Settings is reachable.", durationMs: 9, errors: [] }] },
      }]
    },
    project: async () => ({ parts: [{ file: "src/Home.page.part.tsx", name: "Home", states: [{ export: "default", label: "Default" }] }], devices: [] }),
    onChange: () => { for (const resolve of waiting) { waiting.delete(resolve); resolve() } },
    onDone: (id, file) => done.push({ workspace: id, file }),
  })
  /** @param {string} file */
  const settled = async file => {
    for (;;) {
      let changed = () => {}
      const next = new Promise(resolve => { changed = () => resolve(undefined); waiting.add(changed) })
      const view = (await agents.views()).find(view => view.workspace === workspace && view.file === file)
      if (view?.run._tag !== "Running") {
        waiting.delete(changed)
        return /** @type {NonNullable<typeof view>} */ (view)
      }
      await next
    }
  }
  return { faux, workspaces, workspace, agents, renders, done, settled }
}

describe("a row agent", () => {
  test("writes its own row file from what you ask, renders it in Today with its checks, and changes nothing else", async () => {
    await inFolder(async root => {
      const { faux, workspaces, workspace, agents, renders, done, settled } = setup(root)
      /** @type {any} */
      let first = null
      /** @type {string} */
      let system = ""
      faux.setResponses([
        context => {
          first = context.messages.find(message => message.role === "user")
          system = JSON.stringify(context)
          return fauxAssistantMessage([fauxToolCall("read_file", { path: "src/Home.tsx" })], { stopReason: "toolUse" })
        },
        fauxAssistantMessage([fauxToolCall("write_row", { content: ROW })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("render_row", {})], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxText("The row renders Home. Its check fails in Today: Settings is not reachable.")]),
      ])
      const file = await agents.start({ workspace, brief: "Home by keyboard. Check that A opens Settings.", device: "rg353m" })
      expect(file).toBe("rows/1.part.tsx")
      const view = await settled(file)
      expect(view.run).toEqual({ _tag: "Idle" })
      expect(readFileSync(join(root, ".caliper/workspaces/1/rows/1.part.tsx"), "utf8")).toBe(ROW)
      expect(workspaces.read(workspace)?.rows.at(-1)).toEqual({ _tag: "Scratch", file, brief: "Home by keyboard. Check that A opens Settings." })
      expect(renders).toEqual([{ workspace, file, device: "rg353m" }])
      expect(done).toEqual([{ workspace, file }])
      expect(readFileSync(join(root, "src/Home.tsx"), "utf8")).toBe(files["src/Home.tsx"])
      const text = first.content.filter((/** @type {any} */ block) => block.type === "text").map((/** @type {any} */ block) => block.text).join("\n")
      expect(text).toContain("Can Settings open with the d-pad?")
      expect(text).toContain("Home by keyboard. Check that A opens Settings.")
      expect(text).toContain(".caliper/workspaces/1/rows/1.part.tsx")
      expect(text).toContain("../../../../src/")
      expect(text).toContain("src/Home.page.part.tsx")
      expect(system).toContain("Never weaken a check so that Today passes")
      expect(system).toContain(String(MAX_ROW_TURNS))
      expect(view.log.map(entry => entry._tag === "Tool" ? `${entry.name}:${entry.outcome}` : entry._tag)).toEqual(["User", "read_file:Done", "write_row:Done", "render_row:Done", "Assistant"])
      const rendered = view.log.find(entry => entry._tag === "Tool" && entry.name === "render_row")
      expect(rendered?._tag === "Tool" && rendered.detail).toContain("0 of 1 checks pass")
    })
  })

  test("cannot write a product file or another row, and edits its own row in place", async () => {
    await inFolder(async root => {
      const { faux, workspace, agents, settled } = setup(root)
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("write_row", { content: ROW })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("edit_row", { old_text: "Home by keyboard", new_text: "Home by d-pad" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("write_file", { path: "src/Home.tsx", content: "hacked" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxText("Done.")]),
      ])
      const file = await agents.start({ workspace, brief: "Home by d-pad.", device: "rg353m" })
      const view = await settled(file)
      expect(readFileSync(join(root, ".caliper/workspaces/1/rows/1.part.tsx"), "utf8")).toContain('name = "Home by d-pad"')
      expect(readFileSync(join(root, "src/Home.tsx"), "utf8")).toBe(files["src/Home.tsx"])
      expect(view.log.some(entry => entry._tag === "Tool" && entry.name === "write_file" && entry.outcome === "Failed")).toBe(true)
    })
  })

  test("a follow-up keeps the conversation; delete stops the agent and removes the row and its file", async () => {
    await inFolder(async root => {
      const { faux, workspaces, workspace, agents, settled } = setup(root)
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("write_row", { content: ROW })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxText("Written.")]),
        fauxAssistantMessage([fauxText("Renamed.")]),
      ])
      const file = await agents.start({ workspace, brief: "Home by keyboard.", device: "rg353m" })
      await settled(file)
      await agents.follow(workspace, file, "Call it Home by d-pad.")
      const after = await settled(file)
      expect(after.log.filter(entry => entry._tag === "User").map(entry => entry._tag === "User" && entry.text)).toEqual(["Home by keyboard.", "Call it Home by d-pad."])
      await agents.remove(workspace, file)
      expect(workspaces.read(workspace)?.rows.some(row => row._tag === "Scratch")).toBe(false)
      expect(existsSync(join(root, ".caliper/workspaces/1/rows/1.part.tsx"))).toBe(false)
      expect((await agents.views()).length).toBe(0)
    })
  })

  test("stops after its turn budget, and says so", async () => {
    await inFolder(async root => {
      const { faux, workspace, agents, settled } = setup(root)
      faux.setResponses(Array.from({ length: MAX_ROW_TURNS + 2 }, () => fauxAssistantMessage([fauxToolCall("read_row", {})], { stopReason: "toolUse" })))
      const file = await agents.start({ workspace, brief: "Loop.", device: "rg353m" })
      const view = await settled(file)
      expect(view.log.filter(entry => entry._tag === "Tool")).toHaveLength(MAX_ROW_TURNS)
      expect(view.log.at(-1)).toEqual({ _tag: "Assistant", text: `Stopped after ${MAX_ROW_TURNS} turns. Send another prompt to go on.` })
    })
  })
})
