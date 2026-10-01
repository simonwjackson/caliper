import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { createChromeApp } from "../src/client/app/runtime"
import { createAppState, frameKey, reconcileSelection } from "../src/client/app/state"
import { toChromeView } from "../src/client/app/view"
import { parseProject, parseTakes, parseWire, ProjectSchema, FrameReportSchema, ChecksViewSchema } from "../src/client/app/wire"
import { withProject, manifest } from "./project-server.js"
import { createTakeStore } from "../src/takes/store.js"
import type { Regions } from "../src/client/app/view"
import type { TakeView } from "../src/types"

const closed: Regions = { code: { _tag: "Closed" }, checks: { _tag: "Closed" }, knobs: { _tag: "Closed" }, integration: { _tag: "None" } }
const part = "src/Chip.part.tsx"
const files = { "package.json": manifest(), "src/index.ts": "export {}", [part]: "export default function Chip() { return <span>chip</span> }\nexport function Busy() { return <span>busy</span> }" }

describe("the server snapshot to rendering boundary", () => {
  test("converts real project and takes snapshots without changing the wire values", async () => {
    await withProject({ files }, async ({ get, root }) => {
      const store = createTakeStore(root)
      const id = store.create({ part, state: "Busy", device: "iphone-16" })
      store.write(id, "src/note.ts", "export const note = 'review'\n")
      const project = parseProject(await (await get("/__caliper/project.json")).json())
      const takes = parseTakes(await (await get("/__caliper/takes.json")).json())
      const state = { ...createAppState(`#part=${part}&state=takes:Busy&take=${id}`), project, takes, connection: { _tag: "Ready" as const } }
      const before = JSON.stringify([project, takes])
      const view = toChromeView(state, closed)
      expect(view.canvas._tag).toBe("Frames")
      expect(view.focusedTake?.id).toBe(id)
      expect(view.focusedTake?.accept._tag).toBe("Enabled")
      expect(view.navigation.parts[0]?.states[1]?.takes[0]?.id).toBe(id)
      expect(Object.isFrozen(view)).toBe(true)
      expect(Object.isFrozen(view.navigation.parts)).toBe(true)
      expect(JSON.stringify([project, takes])).toBe(before)
      expect(Object.isFrozen(project)).toBe(false)
    })
  })
  test("removed subjects retain review and discard but cannot authorize replacement or prompts", async () => {
    await withProject({ files }, async ({ get, root, write }) => {
      const store = createTakeStore(root)
      const id = store.create({ part, state: "Busy", device: "iphone-16" })
      store.write(id, "src/note.ts", "export const note = 'review'\n")
      write(part, "export default function Chip() { return <span>chip</span> }")
      const project = parseProject(await (await get("/__caliper/project.json")).json())
      const takes = parseTakes(await (await get("/__caliper/takes.json")).json())
      const state = createAppState(`#part=${part}&state=takes:Busy&take=${id}`)
      const reconciled = reconcileSelection({ ...state, project, takes, connection: { _tag: "Ready" }, tools: { ...state.tools, side: "record" } })
      const view = toChromeView(reconciled, closed)
      expect(view.focusedTake?.id).toBe(id)
      expect(view.record._tag).toBe("Open")
      expect(view.navigation.unavailable[0]?.takes[0]?.id).toBe(id)
      expect(view.focusedTake?.accept._tag).toBe("Disabled")
      expect(view.focusedTake?.discard._tag).toBe("Enabled")
      expect(view.composer.start._tag).toBe("Disabled")
      expect(view.canvas._tag).toBe("Empty")
    })
  })
  test("converts a real saved report and stale HTTP history without authorizing image approval", async () => {
    await withProject({ files: { ...files, "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }) }, modules: resolve("node_modules") }, async ({ get, url, write }) => {
      const project = parseProject(await (await get("/__caliper/project.json")).json())
      const before = await fetch(new URL("__caliper/checks/run", url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ part, state: "default" }) })
      expect(before.status).toBe(202)
      const ready = async (stale: boolean) => {
        const deadline = Date.now() + 25_000
        while (Date.now() < deadline) {
          const value = parseWire(ChecksViewSchema, await (await get("/__caliper/checks")).json())
          if (value._tag === "Ready" && !!value.stale === stale) return value
          if (value._tag === "Failed") throw new Error(value.reason)
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        throw new Error("The real saved Checks response did not settle")
      }
      const report = await ready(false)
      const app = createChromeApp({ hash: `#part=${part}&state=default`, request: async <T>(path: string) => await (await get(`/__caliper/${path}`)).json() as T })
      try {
        app.receiveProject(project)
        app.receiveTakes(await (await get("/__caliper/takes.json")).json())
        app.actions.onTool("checks")
        app.receiveChecks(report)
        for (let attempt = 0; attempt < 100; attempt++) {
          const value = app.getSnapshot().checks
          if (value._tag === "Open" && value.run._tag === "Ready" && value.runSelected._tag === "Enabled") break
          await new Promise(resolve => setTimeout(resolve, 5))
        }
        let checks = app.getSnapshot().checks
        if (checks._tag !== "Open" || checks.run._tag !== "Ready") throw new Error("The saved report was not converted")
        const row = checks.run.rows[0]!
        expect(row.images).toHaveLength(2)
        const original = JSON.stringify(report)
        write(part, "export default function Chip() { return <span>changed</span> }\nexport function Busy() { return <span>busy</span> }")
        const history = await ready(true)
        app.receiveChecks(history)
        app.receiveChecks(report)
        app.actions.onImageReviewed(report.id, row.index, true)
        await Promise.resolve()
        checks = app.getSnapshot().checks
        if (checks._tag !== "Open" || checks.run._tag !== "Ready") throw new Error("Stale history was not retained")
        expect(checks.run.id).toBe(report.id)
        expect(checks.run.stale).toBe(true)
        expect(checks.run.rows[0]!.reviewed).toBe(false)
        expect(checks.run.rows[0]!.approval._tag).toBe("Disabled")
        expect(app.getSnapshot().navigation.parts[0]!.states[0]!.badge?.status).toBe("Stale")
        expect(Object.isFrozen(checks.run.rows)).toBe(true)
        expect(JSON.stringify(report)).toBe(original)
      } finally { app.dispose() }
    })
  }, 30_000)
  test("rejects malformed snapshots and reports instead of treating JSON as a typed view", () => {
    expect(() => parseWire(ProjectSchema, { name: "bad", parts: [] })).toThrow("invalid server snapshot")
    expect(() => parseTakes({ agent: { _tag: "Ready" }, takes: [] })).toThrow("invalid server snapshot")
    expect(() => parseWire(FrameReportSchema, { source: "caliper-frame", state: "Passed" })).toThrow()
  })
  test("reused take ids produce different frame identity", () => {
    const take: TakeView = { take: "1", part, state: "default", created: 1, device: "iphone-16", files: [], images: [], log: [], run: { _tag: "Idle" } }
    expect(frameKey(take, take)).not.toBe(frameKey(take, { ...take, created: 2 }))
  })
})

describe("stable app actions", () => {
  test("stable callbacks keep explicit prompt and plan inputs independent of rendering snapshots", async () => {
    await withProject({ files }, async ({ get }) => {
      const project = parseProject(await (await get("/__caliper/project.json")).json())
      const app = createChromeApp({ hash: `#part=${part}&state=Busy`, request: async () => { throw new Error("No effects requested") } })
      const actions = app.actions
      try {
        app.receiveProject(project)
        app.receiveTakes({ agent: { _tag: "Ready", model: "local", baseUrl: "http://localhost", reasoning: "off", api: "chat-completions", baseUrlFrom: "test", keyFrom: "test" }, skills: { skills: [], problems: [] }, accepted: [], takes: [], workspaces: [] })
        actions.onPrompt("Describe the state")
        actions.onCount(3)
        const first = app.getSnapshot()
        actions.onFilter("Chip")
        expect(app.actions).toBe(actions)
        expect(app.getSnapshot().composer.prompt).toBe("Describe the state")
        expect(app.getSnapshot().composer.count).toBe(3)
        expect(first.navigation.filter).toBe("")
        actions.onPartExpanded(part, false)
        expect(app.getSnapshot().navigation.parts[0]?.expanded).toBe(false)
        expect(app.getSnapshot().selection._tag).toBe("State")
        app.unreachable()
        expect(app.getSnapshot().composer.start._tag).toBe("Disabled")
        expect(app.getSnapshot().navigation.parts).toHaveLength(1)
      } finally { app.dispose() }
    })
  })
  test("cancelling a pending plan discards its response but keeps the prompt", async () => {
    await withProject({ files }, async ({ get }) => {
      const project = parseProject(await (await get("/__caliper/project.json")).json())
      let finish: ((value: unknown) => void) | undefined
      const pending = new Promise<unknown>(resolve => { finish = resolve })
      const app = createChromeApp({ hash: `#part=${part}&state=Busy`, request: async <T>() => await pending as T })
      try {
        app.receiveProject(project)
        app.receiveTakes({ agent: { _tag: "Ready", model: "local", baseUrl: "http://localhost", reasoning: "off", api: "chat-completions", baseUrlFrom: "test", keyFrom: "test" }, skills: { skills: [], problems: [] }, accepted: [], takes: [], workspaces: [] })
        app.actions.onPrompt("Keep the prompt")
        app.actions.onCount(3)
        app.actions.onStart()
        expect(app.getSnapshot().plan._tag).toBe("Planning")
        app.actions.onPlanCancel()
        finish?.({ directions: [{ title: "late", brief: "Never displayed" }] })
        await new Promise(resolve => setTimeout(resolve, 10))
        expect(app.getSnapshot().plan._tag).toBe("None")
        expect(app.getSnapshot().composer.prompt).toBe("Keep the prompt")
      } finally { app.dispose() }
    })
  })
})
