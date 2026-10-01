import { afterEach, describe, expect, test } from "bun:test"
import { createChromeApp } from "../src/client/app/runtime"
import type { Request } from "../src/client/app/runtime"
import type { IdeaView, Project, TakesSnapshot, WorkspaceView } from "../src/types"
import { STANDARD_DEVICES } from "../src/client/device-frame.js"

const home = "src/Home.page.part.tsx"
const settings = "src/Settings.page.part.tsx"
const created = 1_790_726_400_000

function project(): Project {
  return {
    name: "pico",
    parts: [
      { file: home, name: "Home", layer: "page", states: [{ export: "default", label: "Default" }, { export: "Empty", label: "Empty", line: 9 }] },
      { file: settings, name: "Settings", layer: "page", states: [{ export: "default", label: "Default" }] },
    ],
    entry: { _tag: "Derived", value: { file: "src/main.tsx" }, source: { file: "index.html", line: 6 }, via: "module script" },
    css: { _tag: "Derived", value: { stylesheets: [], unresolved: [] }, source: { file: "src/main.tsx", line: 1 }, via: "entry imports" },
    wrapper: { _tag: "Overridden", value: { elements: [] }, option: "wrap" },
    devices: STANDARD_DEVICES,
  }
}
const idea = (take: string, overrides: Partial<IdeaView> = {}): IdeaView => ({
  take, created: created + Number(take), device: "iphone-16", name: `Idea ${take} name`, direction: { title: `Idea ${take} name`, brief: "A brief." },
  run: { _tag: "Idle" }, files: ["src/Home.tsx"], images: [], log: [], ...overrides,
})
function workspace(overrides: Partial<Extract<WorkspaceView, { _tag: "Ready" }>> = {}): WorkspaceView {
  return { _tag: "Ready", id: "1", created, question: "", status: { _tag: "Open" }, rows: [], questions: [], ideas: [], scratch: [], checks: [], ...overrides }
}
function snapshot(workspaces: readonly WorkspaceView[]): TakesSnapshot {
  return {
    agent: { _tag: "Ready", model: "local", baseUrl: "http://localhost:8080/v1", reasoning: "off", api: "chat-completions", baseUrlFrom: "test", keyFrom: "test" },
    skills: { skills: [], problems: [] }, accepted: [], takes: [], workspaces,
  }
}

type Call = { path: string; body: object | undefined }
const apps = new Set<ReturnType<typeof createChromeApp>>()
afterEach(() => { for (const app of apps) app.dispose(); apps.clear() })
function harness(workspaces: readonly WorkspaceView[], routes: Record<string, (call: Call) => unknown> = {}, hash = `#part=${home}`) {
  let served = snapshot(workspaces)
  const calls: Call[] = []
  const request: Request = async <T>(path: string, body?: object): Promise<T> => {
    const call = { path, body: body === undefined ? undefined : structuredClone(body) }
    calls.push(call)
    if (routes[path]) return await routes[path](call) as T
    if (path === "project.json") return project() as T
    if (path === "takes.json") return served as T
    if (body !== undefined) return {} as T
    throw new Error(`Unexpected request: ${path}`)
  }
  const app = createChromeApp({ request, hash, origin: "http://caliper.test", confirm: () => true })
  apps.add(app)
  app.receiveProject(project()); app.receiveTakes(served)
  return {
    app, calls, posts: () => calls.filter(call => call.body !== undefined),
    serve: (next: readonly WorkspaceView[]) => { served = snapshot(next); app.receiveTakes(served) },
  }
}
async function settle() { for (let index = 0; index < 60; index++) await Promise.resolve() }

describe("workspaces in the app", () => {
  test("the parts panel lists every workspace, and a pin shows on every state only while an open one is selected", () => {
    const { app } = harness([workspace({ question: "Can Settings open with the d-pad?", rows: [{ _tag: "State", part: home, state: "default" }] }), workspace({ id: "2", name: "Cart art", status: { _tag: "Closed", at: created, promoted: [] } }), { _tag: "Damaged", id: "3", reason: "It is not JSON." }])
    let nav = app.getSnapshot().navigation
    expect(nav.workspaces.items.map(item => [item.name, item.meta, item.problem])).toEqual([
      ["Can Settings open with the d-pad?", "Open · no ideas yet", ""], ["Cart art", "Closed · 0 answers", ""], ["Workspace 3", "Cannot be read", "It is not JSON."],
    ])
    expect(nav.parts.flatMap(part => part.states.map(state => state.pin._tag))).toEqual(["None", "None", "None"])
    expect(nav.scenario._tag).toBe("Selected")
    app.actions.onWorkspace("1")
    nav = app.getSnapshot().navigation
    expect(nav.workspaces.items[0]?.selected).toBe(true)
    // The preview scenario belongs to the canvas, which the board replaces.
    expect(nav.scenario._tag).toBe("None")
    expect(nav.parts.find(part => part.file === home)?.pinned).toBe(1)
    expect(nav.parts.find(part => part.file === home)?.states.map(state => state.pin)).toEqual([
      { _tag: "Pin", pinned: true, availability: { _tag: "Enabled" } }, { _tag: "Pin", pinned: false, availability: { _tag: "Enabled" } },
    ])
    expect(app.getSnapshot().canvas._tag).toBe("Empty")
    // A closed workspace takes no more rows.
    app.actions.onWorkspace("2")
    expect(app.getSnapshot().navigation.parts.flatMap(part => part.states.map(state => state.pin._tag))).toEqual(["None", "None", "None"])
    // Showing a state leaves the board.
    app.actions.onState({ part: settings, state: "default" })
    expect(app.getSnapshot().workspace._tag).toBe("None")
  })

  test("the board has a row for each pin and a column for Today and each idea; a working idea's cells wait", () => {
    const { app } = harness([workspace({
      question: "Can Settings open with the d-pad?", name: "Settings with the d-pad",
      rows: [{ _tag: "State", part: home, state: "default" }, { _tag: "State", part: settings, state: "default" }],
      ideas: [idea("4"), idea("5", { run: { _tag: "Running" }, direction: { title: "Strange", brief: "B", strange: true } })],
    })], {}, "#workspace=1")
    const board = app.getSnapshot().workspace
    if (board._tag !== "Open") throw new Error("Expected the board")
    expect(board.title).toBe("Settings with the d-pad")
    expect(board.rows.map(row => [row.part, row.state])).toEqual([["Home", "Default"], ["Settings", "Default"]])
    expect(board.columns.map(column => column._tag === "Idea" ? `${column.take}:${column.strange}` : column._tag)).toEqual(["Today", "4:false", "5:true"])
    const frame = (row: string, column: string) => board.cells.find(cell => cell.row === row && cell.column === column)?.frame
    expect(frame(`${home}#default`, "today")?.src).toBe(`frame?${new URLSearchParams({ part: home, state: "default" })}`)
    expect(frame(`${settings}#default`, board.columns[1]!.key)?.src).toContain("take=4")
    expect(frame(`${home}#default`, board.columns[2]!.key)).toBeNull()
    expect(board.bar).toMatchObject({ mode: "More", placeholder: "Describe another idea for this question" })
  })

  test("Ask saves the question, plans, and starts one idea per direction; Cancel during planning starts none", async () => {
    let release = () => {}
    const planned = new Promise<void>(resolve => { release = resolve })
    const { app, posts } = harness([workspace({ rows: [{ _tag: "State", part: home, state: "default" }] })], {
      "workspaces/1/plan": async () => { await planned; return { name: "Settings", directions: [{ title: "Header", brief: "In the header." }, { title: "Shelf", brief: "On the shelf." }] } },
      "workspaces/1/ideas": call => ({ take: (call.body as { direction?: { title: string } }).direction?.title === "Header" ? "7" : "8" }),
    }, "#workspace=1")
    expect(app.getSnapshot().workspace).toMatchObject({ _tag: "Open", status: "New", bar: { mode: "Ask", go: { availability: { _tag: "Disabled" } } } })
    app.actions.onPrompt("Can Settings open with the d-pad?")
    app.actions.onCount(2)
    expect(app.getSnapshot().workspace).toMatchObject({ bar: { go: { label: "Plan 2 ideas", availability: { _tag: "Enabled" } } } })
    app.actions.onWorkspaceStart()
    await settle()
    expect(app.getSnapshot().plan).toEqual({ _tag: "Planning", count: 2, message: "Planning 2 ideas…" })
    const board = app.getSnapshot().workspace
    expect(board._tag === "Open" && board.columns.map(column => column._tag)).toEqual(["Today", "Planned", "Planned"])
    release()
    await settle()
    expect(posts().map(call => [call.path, call.body])).toEqual([
      ["workspaces/1/question", { question: "Can Settings open with the d-pad?" }],
      ["workspaces/1/plan", { count: 2, device: "iphone-16" }],
      ["workspaces/1/ideas", { device: "iphone-16", direction: { title: "Header", brief: "In the header." }, others: ["Shelf"] }],
      ["workspaces/1/ideas", { device: "iphone-16", direction: { title: "Shelf", brief: "On the shelf." }, others: ["Header"] }],
    ])
    expect(app.getSnapshot().plan._tag).toBe("None")

    // A second plan, cancelled while the planner works, starts nothing.
    let again = () => {}
    const second = harness([workspace({ question: "q", rows: [{ _tag: "State", part: home, state: "default" }] })], {
      "workspaces/1/plan": async () => { await new Promise<void>(resolve => { again = resolve }); return { directions: [{ title: "A", brief: "a" }, { title: "B", brief: "b" }] } },
    }, "#workspace=1")
    second.app.actions.onCount(2)
    second.app.actions.onWorkspaceStart()
    await settle()
    second.app.actions.onPlanCancel()
    again()
    await settle()
    expect(second.posts().map(call => call.path)).toEqual(["workspaces/1/plan"])
  })

  test("a focused idea gets the prompt, and Discard keeps the questions", async () => {
    const ready = workspace({ question: "q", rows: [{ _tag: "State", part: home, state: "default" }], ideas: [idea("4")], questions: [{ _tag: "Open", id: "1", text: "Does Find get an entry?", by: { _tag: "User" }, asked: created }] })
    const { app, posts } = harness([ready], {}, "#workspace=1")
    app.actions.onIdea("4")
    app.actions.onPrompt("Quieter header")
    expect(app.getSnapshot().workspace).toMatchObject({ bar: { mode: "Idea", go: { label: "Send to idea 4", availability: { _tag: "Enabled" } }, idea: { take: "4" } } })
    app.actions.onIdeaFollow("4")
    await settle()
    app.actions.onAnswer("1", "Yes", "Rule 6")
    await settle()
    app.actions.onWorkspaceDiscard("1")
    await settle()
    expect(posts().map(call => [call.path, call.body])).toEqual([
      ["workspaces/1/ideas/4/prompt", { prompt: "Quieter header" }],
      ["workspaces/1/questions/1/answer", { answer: "Yes", reason: "Rule 6" }],
      ["workspaces/1/discard", {}],
    ])
    const board = app.getSnapshot().workspace
    expect(board._tag === "Open" && board.discard).toEqual({ availability: { _tag: "Enabled" }, ideas: 1, files: 1, answered: 0, open: 1 })
  })

  test("the questions sit in the side slot, through the tool rule", () => {
    const { app } = harness([workspace({ question: "q" })], {}, "#workspace=1")
    app.actions.onQuestions(true)
    expect(app.getSnapshot().tools).toMatchObject({ side: "record", active: "takes" })
    expect(app.getSnapshot().record._tag).toBe("Closed")
    app.actions.onQuestions(false)
    expect(app.getSnapshot().tools.side).toBe("closed")
  })

  test("New row writes a scratch row: the bar sends what you ask, and the new row is focused with its record open (slice 2)", async () => {
    const { app, posts, serve } = harness([workspace({ question: "Can Settings open with the d-pad?", rows: [{ _tag: "State", part: home, state: "default" }], ideas: [idea("4")] })], {
      "workspaces/1/rows/new": () => ({ row: "rows/1.part.tsx" }),
    }, "#workspace=1")
    app.actions.onRowNew(true)
    let board = app.getSnapshot().workspace
    expect(board).toMatchObject({ _tag: "Open", newRow: { _tag: "Enabled" }, bar: { mode: "NewRow", go: { label: "Write row", availability: { _tag: "Disabled" } } } })
    app.actions.onPrompt("Home by d-pad. Check that A opens Settings.")
    serve([workspace({
      question: "Can Settings open with the d-pad?", ideas: [idea("4")],
      rows: [{ _tag: "State", part: home, state: "default" }, { _tag: "Scratch", file: "rows/1.part.tsx", brief: "Home by d-pad. Check that A opens Settings." }],
      scratch: [{ file: "rows/1.part.tsx", written: false, name: null, checks: [], problems: [], run: { _tag: "Running" }, log: [{ _tag: "User", text: "Home by d-pad. Check that A opens Settings." }] }],
    })])
    app.actions.onRowWrite()
    await settle()
    expect(posts().at(-1)).toEqual({ path: "workspaces/1/rows/new", body: { brief: "Home by d-pad. Check that A opens Settings.", device: "iphone-16" } })
    board = app.getSnapshot().workspace
    if (board._tag !== "Open") throw new Error("Expected the board")
    const row = board.rows[1]
    expect(row).toMatchObject({ part: "Home by d-pad. Check that A opens Settings.", state: "Scratch", scratch: { id: "rows/1.part.tsx", written: false, focused: true, run: { _tag: "Running" } }, open: true })
    // While its agent writes, the row's cells wait.
    expect(board.cells.filter(cell => cell.row === row?.key).every(cell => cell.frame === null)).toBe(true)
    expect(board.bar).toMatchObject({ mode: "Row", prompt: "", row: { id: "rows/1.part.tsx", stop: { _tag: "Enabled" } } })
    expect(board.record).toMatchObject({ _tag: "Open", file: ".caliper/workspaces/1/rows/1.part.tsx", brief: "Home by d-pad. Check that A opens Settings.", log: [{ _tag: "User", text: "Home by d-pad. Check that A opens Settings.", images: [] }] })
    expect(app.getSnapshot().tools.side).toBe("record")
    app.actions.onRowStop("rows/1.part.tsx")
    await settle()
    expect(posts().at(-1)?.path).toBe("workspaces/1/rows/1/stop")
  })

  test("a checked row shows a line under each cell on the board's device, and its record has each check per column (slice 2)", async () => {
    const row = ".caliper/workspaces/1/rows/1.part.tsx"
    const result = (status: "Passed" | "Failed") => [
      { name: "A opens Settings", line: 62, status, detail: status === "Failed" ? "No control named Settings is reachable." : "", image: "a".repeat(24) },
      { name: "B returns", line: 70, status: "Passed" as const, detail: "", image: null },
    ]
    const { app, posts } = harness([workspace({
      question: "q", ideas: [idea("4"), idea("5")],
      rows: [{ _tag: "Scratch", file: "rows/1.part.tsx", brief: "Home by d-pad." }],
      scratch: [{ file: "rows/1.part.tsx", written: true, name: "Home by d-pad", checks: [{ name: "A opens Settings", line: 62 }, { name: "B returns", line: 70 }], problems: [], run: { _tag: "Idle" }, log: [] }],
      checks: [
        { row, state: "default", column: "today", device: "iphone-16", status: "Done", reason: "", stale: false, results: result("Failed") },
        { row, state: "default", column: "4", device: "iphone-16", status: "Done", reason: "", stale: true, results: result("Passed") },
        { row, state: "default", column: "5", device: "iphone-16", status: "Running", reason: "", stale: false, results: [] },
        // Another device's result is not this board's.
        { row, state: "default", column: "today", device: "pixel-9", status: "Done", reason: "", stale: false, results: result("Passed") },
      ],
    })], {}, "#workspace=1")
    let board = app.getSnapshot().workspace
    if (board._tag !== "Open") throw new Error("Expected the board")
    expect(board.rows[0]).toMatchObject({ part: "Home by d-pad", checks: 2 })
    expect(board.cells.map(cell => cell.checks)).toEqual([
      { _tag: "Done", passed: 1, total: 2, stale: false },
      { _tag: "Done", passed: 2, total: 2, stale: true },
      { _tag: "Running" },
    ])
    expect(board.cells[0]?.frame?.src).toBe(`frame?${new URLSearchParams({ part: row, state: "default" })}`)
    app.actions.onRowRecord(`${row}#default`, board.columns[1]!.key)
    board = app.getSnapshot().workspace
    if (board._tag !== "Open" || board.record._tag !== "Open") throw new Error("Expected the record")
    expect(board.record.column).toBe(board.columns[1]!.key)
    expect(board.record.columns.map(column => column.label)).toEqual(["Today", "4", "5"])
    expect(board.record.checks[0]?.results.map(item => [item.status, item.detail, item.image])).toEqual([
      ["Failed", "No control named Settings is reachable.", `workspaces/1/checks/${"a".repeat(24)}`],
      ["Passed", "", `workspaces/1/checks/${"a".repeat(24)}`],
      ["Running", "", null],
    ])
    expect(board.bar.mode).toBe("Row")
    app.actions.onRowCheck(`${row}#default`)
    await settle()
    expect(posts().at(-1)).toEqual({ path: "workspaces/1/checks", body: { part: row, state: "default", device: "iphone-16" } })
    // The questions take the side panel back; the bar leaves the row.
    app.actions.onQuestions(true)
    board = app.getSnapshot().workspace
    expect(board._tag === "Open" && board.record._tag).toBe("Closed")
    app.actions.onRowRecord(`${row}#default`)
    app.actions.onPrompt("Rename it.")
    app.actions.onRowWrite()
    await settle()
    expect(posts().at(-1)).toEqual({ path: "workspaces/1/rows/1/prompt", body: { prompt: "Rename it.", device: "iphone-16" } })
    app.actions.onRowDelete("rows/1.part.tsx")
    await settle()
    expect(posts().at(-1)?.path).toBe("workspaces/1/rows/1/delete")
  })
})
