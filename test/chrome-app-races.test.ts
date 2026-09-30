import { afterEach, describe, expect, test } from "bun:test"
import { createChromeApp } from "../src/client/app/runtime"
import { createAppState } from "../src/client/app/state"
import type { Request, RuntimeInput } from "../src/client/app/runtime"
import type { Direction, Project, TakesSnapshot, TakeView } from "../src/types"
import type { FrameView } from "../src/client/ui/contract"
import type { FrameReport } from "../src/client/app/wire"

const part = "src/Chip.atom.part.tsx"
const page = "src/Checkout.page.part.tsx"
const origin = "http://caliper.test"
const created = 1_790_726_400_000

// Representative domain snapshots, not the frozen rendering-contract examples.
function project(): Project {
  return {
    name: "checkout-product",
    parts: [
      { file: part, name: "Chip", layer: "atom", states: [{ export: "default", label: "Default" }, { export: "Busy", label: "Busy", line: 5 }] },
      { file: page, name: "Checkout", layer: "page", states: [{ export: "default", label: "Default" }], composition: { default: [{ part, state: "Busy" }] } },
    ],
    entry: { _tag: "Derived", value: { file: "src/main.tsx" }, source: { file: "index.html", line: 6 }, via: "module script" },
    css: { _tag: "Derived", value: { stylesheets: [{ file: "src/global.css", importedAt: { file: "src/main.tsx", line: 1 } }], unresolved: [] }, source: { file: "src/main.tsx", line: 1 }, via: "entry imports" },
    wrapper: { _tag: "Overridden", value: { elements: [{ tag: "main", className: "app" }] }, option: "wrap" },
  }
}
function take(overrides: Partial<TakeView> = {}): TakeView {
  return { take: "1", part, state: "Busy", device: "rg353m", created, name: "Clearer busy chip", files: ["src/Chip.tsx"], images: [], run: { _tag: "Idle" }, log: [{ _tag: "User", text: "Make the busy state clearer" }], ...overrides }
}
function takes(list: readonly TakeView[] = []): TakesSnapshot {
  return {
    agent: { _tag: "Ready", model: "local", baseUrl: "http://localhost:8080/v1", reasoning: "off", api: "chat-completions", baseUrlFrom: "test configuration", keyFrom: "test environment" },
    skills: { skills: [], problems: [] }, accepted: [], takes: list,
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
type Call = { path: string; body: object | undefined }
type Route = (call: Call) => unknown | Promise<unknown>
type App = ReturnType<typeof createChromeApp>
const apps = new Set<App>()
afterEach(() => { for (const app of apps) app.dispose(); apps.clear() })
function harness(routes: Record<string, Route> = {}, list: readonly TakeView[] = [], input: Partial<RuntimeInput> = {}) {
  let servedProject = project(), servedTakes = takes(list)
  const calls: Call[] = [], revoked: string[] = [], hashes: string[] = []
  const request: Request = async <T>(path: string, body?: object): Promise<T> => {
    const call = { path, body: body === undefined ? undefined : structuredClone(body) }
    calls.push(call)
    if (routes[path]) return await routes[path](call) as T
    if (path === "project.json") return servedProject as T
    if (path === "takes.json") return servedTakes as T
    throw new Error(`Unexpected request: ${path}`)
  }
  const app = createChromeApp({
    request, hash: `#part=${part}&state=Busy`, origin, confirm: () => true,
    saveLocation: hash => hashes.push(hash),
    imageData: async file => ({ data: "iVBORw0KGgo=", url: `blob:${file.name}` }), revokeImage: url => revoked.push(url),
    ...input,
  })
  apps.add(app)
  app.receiveProject(servedProject); app.receiveTakes(servedTakes)
  return {
    app, calls, revoked, hashes,
    project: (value: Project) => { servedProject = value; app.receiveProject(value) },
    takes: (list: readonly TakeView[]) => { servedTakes = takes(list); app.receiveTakes(servedTakes) },
    posts: () => calls.filter(call => call.body !== undefined),
  }
}
async function settle() { for (let index = 0; index < 40; index++) await Promise.resolve() }
async function until(check: () => boolean) {
  for (let index = 0; index < 100; index++) { if (check()) return; await Promise.resolve() }
  throw new Error("The deferred app effect did not reach the expected boundary")
}
const directions: Direction[] = [{ title: "A", brief: "Keep the compact layout" }, { title: "B", brief: "Try a clearer status label" }]
/** Start a plan of two takes and wait until the planner request is in flight. */
async function startPlan(app: App) {
  app.actions.onPrompt("Explore the busy state")
  app.actions.onCount(2); app.actions.onStart()
  await until(() => app.getSnapshot().plan._tag === "Planning")
}
function frame(app: App, takeId: string | null = null): FrameView {
  const canvas = app.getSnapshot().canvas
  if (canvas._tag !== "Frames") throw new Error("Expected frames")
  const found = canvas.frames.find(candidate => candidate.take === takeId)
  if (!found) throw new Error(`Missing frame for ${takeId}`)
  return found
}
function image(name: string) { return new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" }) }

// A lifecycle seam double only. There is no renderer, Vite server or product DOM.
// Window identity stays stable across navigation; the document and current report do not.
function frameNode() {
  const target = new EventTarget()
  const document = () => ({ documentElement: { dataset: {} as Record<string, string> } })
  const window = { document: document(), caliperReport: undefined as Omit<FrameReport, "source"> | undefined, location: { reload: () => {} } }
  const node = Object.assign(target, { contentWindow: window })
  Object.defineProperty(node, "contentDocument", { get: () => window.document })
  return {
    node: node as unknown as HTMLIFrameElement, window,
    load: () => target.dispatchEvent(new Event("load")),
    navigate: () => { window.document = document(); window.caliperReport = undefined },
    report: (view: FrameView, state: FrameReport["state"], title = ""): FrameReport => {
      const report: FrameReport = { source: "caliper-frame", part: view.preview.part, partState: view.preview.state, take: view.take, state, problems: title ? [{ kind: "error", title, detail: "old document detail" }] : [] }
      const { source: _, ...current } = report
      window.caliperReport = structuredClone(current)
      window.document.documentElement.dataset.caliperState = state
      return structuredClone(report)
    },
  }
}
function receive(app: App, node: ReturnType<typeof frameNode>, data: FrameReport) {
  app.receiveFrame({ origin, source: node.window as unknown as Window, data: structuredClone(data) })
}

describe("initial snapshots and saved preferences", () => {
  test("a faster takes response cannot discard the requested subject and composition before project discovery", () => {
    const app = createChromeApp({ hash: `#part=${part}&state=takes:Busy&take=1&contextPart=${page}&contextState=default`, request: async () => { throw new Error("No effects requested") } })
    apps.add(app)
    app.receiveTakes(takes([take({ context: { part: page, state: "default" } })]))
    expect(app.getSnapshot().connection._tag).toBe("Connecting")
    app.receiveProject(project())
    expect(app.getSnapshot().selection).toMatchObject({ _tag: "State", subject: { part, state: "Busy" }, preview: { part: page, state: "default" } })
    expect(app.getSnapshot().focusedTake?.id).toBe("1")
  })
  test("a restored creation-bound URL cannot silently select a reused numeric id", () => {
    const h = harness({}, [take({ created: created + 1 })], { hash: `#part=${part}&state=takes:Busy&take=1&takeCreated=${created}` })
    expect(h.app.getSnapshot().focusedTake).toBeNull()
    expect(h.app.getSnapshot().composer.follow).toBeNull()
    expect(new URLSearchParams(h.hashes.at(-1)?.slice(1)).has("take")).toBe(false)
  })
  test("tool/device/calibration/split preferences restore and a new tool selection persists", () => {
    const values = new Map([["caliper:view", "takes"], ["caliper:device", "odin2portal"], ["caliper:px-per-mm", "7"], ["caliper:code-share", "0.6"], ["caliper:code-open", "true"]])
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
    const restored = createAppState("", storage)
    expect(restored.tools.active).toBe("takes")
    expect(restored.device.id).toBe("odin2portal")
    expect(restored.pxPerMm).toBe(7)
    expect(restored.calibrated).toBe(true)
    expect(restored.tools.codeShare).toBe(0.6)
    expect(restored.tools.codeOpen).toBe(true)
    const app = createChromeApp({ storage, request: async () => { throw new Error("No effects requested") } })
    apps.add(app)
    app.actions.onTool("preview")
    expect(createAppState("", storage).tools.active).toBe("preview")
    expect(createAppState("#device=rg353m", storage).device.id).toBe("rg353m")
  })
})

test("an invalid creation timestamp is rejected before replacing the last valid take snapshot", () => {
  const h = harness({}, [take()])
  h.app.actions.onTake("1")
  expect(() => h.app.receiveTakes(takes([take({ created: 1e99 })]))).toThrow("invalid server snapshot")
  expect(h.app.getSnapshot().focusedTake?.id).toBe("1")
})

describe("captured plan availability", () => {
  // A plan launches its takes as soon as the planner answers (decision 16, changed 2026-09-30).
  // Anything that makes the captured ask unavailable while the planner works stops the launch.
  test("a recovered Default selection cannot authorize the plan's removed Busy subject", async () => {
    const planned = deferred<{ directions: Direction[] }>()
    const h = harness({ "takes/plan": () => planned.promise })
    await startPlan(h.app)
    h.project({ ...project(), parts: project().parts.filter(item => item.file !== page).map(item => ({ ...item, states: item.states.filter(state => state.export !== "Busy") })) })
    expect(h.app.getSnapshot().selection).toMatchObject({ _tag: "State", subject: { part, state: "default" } })
    planned.resolve({ directions }); await settle()
    expect(h.posts().filter(call => call.path === "takes")).toHaveLength(0)
    expect(h.app.getSnapshot().plan._tag).toBe("None")
    expect(h.app.getSnapshot().composer.prompt).toBe("Explore the busy state")
    expect(h.app.getSnapshot().composer.notices.some(notice => notice.kind === "error")).toBe(true)
  })
  test("removing a captured composition blocks launch even after Preview recovers to isolation", async () => {
    const planned = deferred<{ directions: Direction[] }>()
    const h = harness({ "takes/plan": () => planned.promise })
    h.app.actions.onContext(JSON.stringify([page, "default"]))
    await startPlan(h.app)
    expect(h.posts()[0]?.body).toMatchObject({ context: { part: page, state: "default" } })
    h.project({ ...project(), parts: project().parts.map(item => item.file === page ? { ...item, composition: {} } : item) })
    planned.resolve({ directions }); await settle()
    expect(h.posts().filter(call => call.path === "takes")).toHaveLength(0)
    expect(h.app.getSnapshot().plan._tag).toBe("None")
  })
  test("a plan cannot launch while the connection is Unreachable", async () => {
    const planned = deferred<{ directions: Direction[] }>()
    const h = harness({ "takes/plan": () => planned.promise })
    await startPlan(h.app); h.app.unreachable()
    planned.resolve({ directions }); await settle()
    expect(h.posts().filter(call => call.path === "takes")).toHaveLength(0)
    expect(h.app.getSnapshot().plan._tag).toBe("None")
    expect(h.app.getSnapshot().composer.prompt).toBe("Explore the busy state")
  })
  test("a planned prompt starts every direction at once, with no review step", async () => {
    const h = harness({ "takes/plan": () => ({ directions }), takes: call => ({ take: (call.body as { direction: Direction }).direction.title === "A" ? "1" : "2" }) })
    await startPlan(h.app); await settle()
    const launched = h.posts().filter(call => call.path === "takes").map(call => (call.body as { direction: Direction; others: string[] }))
    expect(launched.map(body => body.direction.title)).toEqual(["A", "B"])
    expect(launched.map(body => body.others)).toEqual([["B"], ["A"]])
    expect(h.app.getSnapshot().plan._tag).toBe("None")
    expect(h.app.getSnapshot().composer.prompt).toBe("")
  })
  test("Cancel while planning starts no take and keeps the prompt", async () => {
    const planned = deferred<{ directions: Direction[] }>()
    const h = harness({ "takes/plan": () => planned.promise })
    await startPlan(h.app)
    h.app.actions.onPlanCancel()
    expect(h.app.getSnapshot().plan._tag).toBe("None")
    planned.resolve({ directions }); await settle()
    expect(h.posts().filter(call => call.path === "takes")).toHaveLength(0)
    expect(h.app.getSnapshot().composer.prompt).toBe("Explore the busy state")
  })
})

describe("submitted composer identity", () => {
  test("launch completion preserves a newer prompt and an image whose read finished after submission", async () => {
    const launched = deferred<{ take: string }>(), reading = deferred<{ data: string; url: string }>()
    const h = harness({ takes: () => launched.promise }, [], { imageData: async file => file.name === "next.png" ? reading.promise : { data: "iVBORw0KGgo=", url: `blob:${file.name}` } })
    h.app.actions.onAttach([image("submitted.png")]); await settle()
    const submitted = h.app.getSnapshot().composer.attachments[0]!
    h.app.actions.onAttach([image("next.png")])
    h.app.actions.onPrompt("  First draft  "); h.app.actions.onStart()
    await until(() => h.posts().some(call => call.path === "takes"))
    h.app.actions.onPrompt("Next draft")
    reading.resolve({ data: "bmV4dA==", url: "blob:next.png" }); await settle()
    expect(h.app.getSnapshot().composer.attachments.map(item => item.name)).toEqual(["submitted.png", "next.png"])
    h.takes([take()]); launched.resolve({ take: "1" }); await settle()
    expect(h.posts().find(call => call.path === "takes")?.body).toMatchObject({ prompt: "First draft", images: [{ name: "submitted.png" }] })
    expect(h.app.getSnapshot().composer.prompt).toBe("Next draft")
    expect(h.app.getSnapshot().composer.attachments.map(item => item.name)).toEqual(["next.png"])
    expect(h.revoked).toContain(submitted.url)
    expect(h.revoked).not.toContain("blob:next.png")
  })
  test("follow completion removes only submitted images, preserving input added during preflight", async () => {
    const preflight = deferred<Project>(), sent = deferred<object>()
    const h = harness({ "project.json": () => preflight.promise, "takes/1/prompt": () => sent.promise }, [take()])
    h.app.actions.onTake("1"); h.app.actions.onPrompt("First follow-up")
    h.app.actions.onAttach([image("submitted.png")]); await settle()
    h.app.actions.onFollow("1"); await until(() => h.calls.some(call => call.path === "project.json"))
    h.app.actions.onPrompt("Next follow-up"); h.app.actions.onAttach([image("next.png")]); await settle()
    preflight.resolve(project()); await until(() => h.posts().some(call => call.path === "takes/1/prompt"))
    sent.resolve({}); await settle()
    expect(h.posts().find(call => call.path === "takes/1/prompt")?.body).toMatchObject({ prompt: "First follow-up", images: [{ name: "submitted.png" }] })
    expect(h.app.getSnapshot().composer.prompt).toBe("Next follow-up")
    expect(h.app.getSnapshot().composer.attachments.map(item => item.name)).toEqual(["next.png"])
    expect(h.revoked).toEqual(["blob:submitted.png"])
  })
  test("an unchanged whitespace-padded raw follow-up clears after its trimmed payload succeeds", async () => {
    const sent = deferred<object>()
    const h = harness({ "takes/1/prompt": () => sent.promise }, [take()])
    h.app.actions.onTake("1"); h.app.actions.onPrompt("  Follow me\n "); h.app.actions.onFollow("1")
    await until(() => h.posts().some(call => call.path === "takes/1/prompt"))
    expect(h.posts().find(call => call.path === "takes/1/prompt")?.body).toEqual({ prompt: "Follow me" })
    sent.resolve({}); await settle()
    expect(h.app.getSnapshot().composer.prompt).toBe("")
  })
})

describe("outstanding operations and partial launches", () => {
  test("completing Stop cannot unlock Start or Accept while another take's Accept is pending", async () => {
    const accepted = deferred<object>(), stopped = deferred<object>()
    const h = harness({ "takes/1/accept": () => accepted.promise, "takes/2/stop": () => stopped.promise }, [take(), take({ take: "2", created: created + 1, run: { _tag: "Running" } })])
    h.app.actions.onTake("1"); h.app.actions.onPrompt("Next change"); h.app.actions.onAccept("1")
    await until(() => h.posts().some(call => call.path === "takes/1/accept"))
    h.app.actions.onStop("2"); await until(() => h.posts().some(call => call.path === "takes/2/stop"))
    stopped.resolve({}); await settle()
    expect(h.app.getSnapshot().composer.start._tag).toBe("Disabled")
    expect(h.app.getSnapshot().focusedTake?.accept._tag).toBe("Disabled")
    h.app.actions.onStart(); h.app.actions.onAccept("1"); await settle()
    expect(h.posts().filter(call => call.path === "takes")).toHaveLength(0)
    expect(h.posts().filter(call => call.path === "takes/1/accept")).toHaveLength(1)
    h.takes([take({ take: "2", created: created + 1 })]); accepted.resolve({}); await settle()
    expect(h.app.getSnapshot().composer.start._tag).toBe("Enabled")
  })
  test("successful directions are never relaunched when the partial launch's refresh fails", async () => {
    const launchA = deferred<{ take: string }>(), launchB = deferred<{ take: string }>()
    const h = harness({
      "takes/plan": () => ({ directions }),
      takes: call => (call.body as { direction: Direction }).direction.title === "A" ? launchA.promise : launchB.promise,
      "takes.json": () => { throw new Error("refresh unavailable") },
    })
    await startPlan(h.app)
    await until(() => h.posts().filter(call => call.path === "takes").length === 2)
    launchA.resolve({ take: "1" }); launchB.reject(new Error("B launch failed")); await settle()
    const completed = h.app.getSnapshot()
    h.app.actions.onStart(); await settle()
    const aRequests = h.posts().filter(call => call.path === "takes" && (call.body as { direction?: Direction }).direction?.title === "A")
    expect(aRequests).toHaveLength(1)
    expect(completed.plan._tag).toBe("None")
    expect(completed.composer.notices.some(notice => notice.text.includes("B launch failed"))).toBe(true)
    expect(completed.composer.notices.some(notice => notice.text.includes("refresh unavailable"))).toBe(true)
  })
})

describe("selected take creation identity", () => {
  test("id reuse clears selection until the replacement take is explicitly selected", () => {
    const h = harness({}, [take()])
    h.app.actions.onTake("1")
    expect(h.app.getSnapshot().record._tag).toBe("Open")
    const oldKey = frame(h.app, "1").key
    h.takes([take({ created: created + 1, name: "Different experiment" })])
    expect(h.app.getSnapshot().focusedTake).toBeNull()
    expect(h.app.getSnapshot().record._tag).toBe("Closed")
    expect(h.app.getSnapshot().composer.follow).toBeNull()
    expect(frame(h.app, "1").key).not.toBe(oldKey)
    expect(frame(h.app, "1").selected).toBe(false)
    expect(new URLSearchParams(h.hashes.at(-1)?.slice(1)).has("take")).toBe(false)
    h.app.actions.onTake("1")
    expect(h.app.getSnapshot().focusedTake?.name).toBe("Different experiment")
    expect(h.app.getSnapshot().record._tag).toBe("Open")
  })
  test("initial hash recovery binds identity, while ordinary updates keep the same take selected", () => {
    const h = harness({}, [take()], { hash: `#part=${part}&state=takes:Busy&take=1` })
    expect(h.app.getSnapshot().focusedTake?.id).toBe("1")
    const key = frame(h.app, "1").key
    h.takes([take({ name: "Renamed experiment", log: [{ _tag: "Assistant", text: "Updated progress" }] })])
    expect(h.app.getSnapshot().focusedTake?.name).toBe("Renamed experiment")
    expect(frame(h.app, "1").key).toBe(key)
    h.takes([take({ created: created + 1 })])
    expect(h.app.getSnapshot().focusedTake).toBeNull()
  })
  test("a reused id discovered during exact-take preflight cannot accept the replacement", async () => {
    const preflight = deferred<TakesSnapshot>()
    const h = harness({ "takes.json": () => preflight.promise }, [take()])
    h.app.actions.onTake("1"); h.app.actions.onAccept("1")
    await until(() => h.calls.some(call => call.path === "takes.json"))
    preflight.resolve(takes([take({ created: created + 1 })])); await settle()
    expect(h.posts().filter(call => call.path === "takes/1/accept")).toHaveLength(0)
    expect(h.app.getSnapshot().focusedTake).toBeNull()
  })
})

describe("frame report document lifecycle", () => {
  test("a replacement node starts Loading and ignores the unregistered node's queued report", async () => {
    const h = harness(), old = frameNode(), next = frameNode(), view = frame(h.app)
    h.app.actions.onFrameMount(view.key, old.node)
    const failure = old.report(view, "Failed", "Old failure")
    receive(h.app, old, failure)
    expect(frame(h.app).verdict._tag).toBe("Failed")
    h.app.actions.onFrameMount(view.key, null); h.app.actions.onFrameMount(view.key, next.node); await settle()
    expect(frame(h.app).verdict._tag).toBe("Loading")
    expect(frame(h.app).problems).toEqual([])
    receive(h.app, old, failure)
    expect(frame(h.app).verdict._tag).toBe("Loading")
    receive(h.app, next, next.report(view, "Rendered"))
    expect(frame(h.app).verdict._tag).toBe("Rendered")
  })
  test("registering the same node again preserves its current verdict", async () => {
    const h = harness(), node = frameNode(), view = frame(h.app)
    h.app.actions.onFrameMount(view.key, node.node)
    receive(h.app, node, node.report(view, "Rendered"))
    h.app.actions.onFrameMount(view.key, node.node); await settle()
    expect(frame(h.app).verdict._tag).toBe("Rendered")
  })
  test("load retains a fresh report already received from that same document", async () => {
    const h = harness(), node = frameNode(), view = frame(h.app)
    h.app.actions.onFrameMount(view.key, node.node)
    receive(h.app, node, node.report(view, "Rendered"))
    node.load(); await settle()
    expect(frame(h.app).verdict._tag).toBe("Rendered")
  })
  test("a new document load clears old verdicts until that document reports", async () => {
    const h = harness(), node = frameNode(), view = frame(h.app)
    h.app.actions.onFrameMount(view.key, node.node)
    receive(h.app, node, node.report(view, "Failed", "Previous document failed"))
    node.navigate(); node.load(); await settle()
    expect(frame(h.app).verdict._tag).toBe("Loading")
    expect(frame(h.app).problems).toEqual([])
    receive(h.app, node, node.report(view, "Rendered"))
    expect(frame(h.app).verdict._tag).toBe("Rendered")
  })
  test("a queued verdict from the previous document cannot replace the new document's report", async () => {
    const h = harness(), node = frameNode(), view = frame(h.app)
    h.app.actions.onFrameMount(view.key, node.node)
    const stale = node.report(view, "Failed", "Stale failure")
    receive(h.app, node, stale)
    node.navigate()
    receive(h.app, node, node.report(view, "Loading"))
    receive(h.app, node, stale)
    expect(frame(h.app).verdict._tag).toBe("Loading")
    expect(frame(h.app).problems).toEqual([])
    node.load(); await settle()
    receive(h.app, node, node.report(view, "Rendered"))
    expect(frame(h.app).verdict._tag).toBe("Rendered")
  })
})
