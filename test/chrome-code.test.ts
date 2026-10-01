import { afterEach, describe, expect, test } from "bun:test"
import { createCodeController, type CodeDependencies, type CodeSubject } from "../src/client/app/code"
import type { CodeFile, TakeView } from "../src/types"
import type { CodeView } from "../src/client/ui/contract"
import * as editorModule from "../src/client/code-editor.js"

type Controller = ReturnType<typeof createCodeController>
const controllers: Controller[] = []
afterEach(() => { for (const controller of controllers.splice(0)) controller.destroy() })
const pause = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms))
async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) { if (check()) return; await pause(5) }
  throw new Error("Controller did not settle")
}
function ready(controller: Controller): Extract<CodeView, { _tag: "Ready" }> {
  const view = controller.getView()
  if (view._tag !== "Ready") throw new Error(`Expected Ready, received ${view._tag}`)
  return view
}
const part = { file: "src/Chip.part.tsx", name: "Chip", states: [{ export: "default", label: "Default" }, { export: "Empty", label: "Empty" }] }
const real: CodeSubject = { part, take: null, state: "default" }
function take(overrides: Partial<TakeView> = {}): TakeView {
  return { take: "1", created: 123, part: part.file, state: "default", device: "iphone-16", run: { _tag: "Idle" }, files: ["src/Chip.tsx"], log: [], images: [], ...overrides }
}
function setup(overrides: Partial<CodeDependencies> = {}) {
  let lists: CodeFile[] = [{ file: part.file, depth: 0, changed: false }, { file: "src/Chip.tsx", depth: 1, changed: false }, { file: "src/deep/Chip.tsx", depth: 2, changed: false }]
  const disk = new Map([[part.file, "export default function Part() {}\nexport const Empty = () => null"], ["src/Chip.tsx", "original"], ["src/deep/Chip.tsx", "deep"]])
  const writes: { path: string; file: string; content: string }[] = []
  const reads: string[] = []
  const stopped: string[] = []
  let failure = ""
  const request: CodeDependencies["request"] = async <T>(path: string, data?: object) => {
    if (failure) throw new Error(failure)
    if (data) {
      const { file, content } = data as { file: string; content: string }
      writes.push({ path, file, content }); disk.set(file, content)
      return {} as T
    }
    reads.push(path)
    if (path.startsWith("code/files?")) return { files: lists } as T
    const query = new URL(path, "http://caliper/").searchParams
    const file = query.get("file")!
    return { file, content: disk.get(file) ?? "", ...(query.has("take") ? { original: "original" } : {}) } as T
  }
  const controller = createCodeController({ request, changed: () => {}, selectState: () => {}, stopTake: id => stopped.push(id), ...overrides })
  controllers.push(controller)
  return { controller, disk, writes, reads, stopped, request,
    setFiles: (files: CodeFile[]) => { lists = files }, fail: (text: string) => { failure = text } }
}

describe("React source controller", () => {
  test("is lazy, selects the matching component and produces detached snapshots", async () => {
    let loads = 0
    const { controller, reads } = setup({ loadEditor: async () => { loads++; return editorModule } })
    controller.sync(real, false)
    expect(controller.getView()).toEqual({ _tag: "Closed" })
    expect(reads).toEqual([])
    controller.sync(real, true)
    await until(() => controller.getView()._tag === "Ready")
    expect(loads).toBe(1)
    const view = ready(controller)
    expect(view.selectedFile).toBe("src/Chip.tsx")
    expect(view.files.map(file => file.label)).toEqual(["Chip.part.tsx", "src/Chip.tsx", "deep/Chip.tsx"])
    expect(view.tabs).toEqual([part.file, "src/Chip.tsx"])
    expect(view.documentKey).toBe("real|src/Chip.tsx")
    controller.edit("typed")
    controller.setFilter("deep")
    expect(view.document.content).toBe("original")
    expect(view.filter).toBe("")
    expect(ready(controller).filter).toBe("deep")
    expect(await controller.flush()).toBe(true)
  })

  test("SSE snapshots during loading neither restart the load nor lose selection", async () => {
    let loads = 0
    let resolve!: (module: typeof editorModule) => void
    const { controller, reads } = setup({ loadEditor: () => { loads++; return new Promise(done => { resolve = done }) } })
    controller.sync(real, true)
    for (let count = 0; count < 5; count++) controller.sync(structuredClone(real), true)
    resolve(editorModule)
    await until(() => controller.getView()._tag === "Ready")
    expect(loads).toBe(1)
    expect(reads.filter(path => path.startsWith("code/files?"))).toHaveLength(1)
    controller.openFile("src/deep/Chip.tsx")
    await until(() => controller.getView()._tag === "Ready")
    controller.sync(structuredClone(real), true)
    expect(ready(controller).selectedFile).toBe("src/deep/Chip.tsx")
  })

  test("unchanged editor inputs and take log updates publish nothing", async () => {
    let publications = 0
    const { controller, reads } = setup({ changed: () => publications++ })
    const subject = { ...real, take: take() }
    controller.sync(subject, false)
    const closed = publications
    controller.sync(structuredClone(subject), false)
    expect(publications).toBe(closed)
    controller.sync(subject, true)
    await until(() => controller.getView()._tag === "Ready")
    await pause()
    const before = publications, readCount = reads.length
    controller.sync(structuredClone(subject), true)
    controller.sync({ ...subject, take: take({ log: [{ _tag: "Assistant", text: "Progress" }] }) }, true)
    await pause()
    expect(publications).toBe(before)
    expect(reads).toHaveLength(readCount)
    controller.sync({ ...subject, take: take({ run: { _tag: "Running" } }) }, true)
    expect(ready(controller).mode._tag).toBe("Watching")
  })

  test("debounces edits and saves real files without making a take", async () => {
    const { controller, writes } = setup()
    controller.sync(real, true)
    await until(() => controller.getView()._tag === "Ready")
    controller.edit("one"); controller.edit("two"); controller.edit("three")
    expect(writes).toHaveLength(0)
    await until(() => writes.length === 1)
    expect(writes).toEqual([{ path: "code/file", file: "src/Chip.tsx", content: "three" }])
    expect(ready(controller).save).toEqual({ _tag: "Saved", label: "Saved" })
  })

  test("flush waits for text typed during a save and serializes concurrent flushes", async () => {
    const setupResult = setup()
    let release!: () => void
    const gate = new Promise<void>(done => { release = done })
    let writes = 0
    const controller = createCodeController({ request: async <T>(path: string, data?: object) => {
      if (data && ++writes === 1) await gate
      return setupResult.request<T>(path, data)
    }, changed: () => {}, selectState: () => {}, stopTake: () => {} })
    controllers.push(controller)
    controller.sync(real, true)
    await until(() => controller.getView()._tag === "Ready")
    controller.edit("one")
    const first = controller.flush()
    await until(() => writes === 1)
    controller.edit("two")
    const second = controller.flush()
    release()
    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(setupResult.writes.map(write => write.content)).toEqual(["one", "two"])
    expect(ready(controller).save._tag).toBe("Saved")
  })

  test("dirty disk updates keep typed text and show the overwrite notice", async () => {
    const { controller, disk, writes } = setup()
    controller.sync(real, true)
    await until(() => controller.getView()._tag === "Ready")
    controller.edit("local")
    disk.set("src/Chip.tsx", "outside")
    controller.receive({ take: null, file: "src/Chip.tsx" })
    await until(() => ready(controller).notice.includes("changed on disk"))
    expect(ready(controller).document.content).toBe("local")
    expect(await controller.flush()).toBe(true)
    expect(writes[0]?.content).toBe("local")
  })

  test("clean disk updates do not become human saves", async () => {
    const { controller, disk, writes } = setup()
    controller.sync(real, true)
    await until(() => controller.getView()._tag === "Ready")
    disk.set("src/Chip.tsx", "outside")
    controller.receive({ take: null, file: "src/Chip.tsx" })
    await until(() => ready(controller).document.content === "outside")
    expect(await controller.flush()).toBe(true)
    expect(writes).toEqual([])
  })

  test("a disk read started before a successful save cannot replace the saved text", async () => {
    const source = setup()
    let hold = false
    let release!: () => void
    let readStarted = false
    const gate = new Promise<void>(done => { release = done })
    const controller = createCodeController({ request: async <T>(path: string, data?: object) => {
      const value = await source.request<T>(path, data)
      if (hold && !data && path.startsWith("code/file?")) { readStarted = true; await gate }
      return value
    }, changed: () => {}, selectState: () => {}, stopTake: () => {} })
    controllers.push(controller)
    controller.sync(real, true)
    await until(() => controller.getView()._tag === "Ready")
    hold = true
    source.disk.set("src/Chip.tsx", "outside")
    controller.receive({ file: "src/Chip.tsx", take: null })
    await until(() => readStarted)
    controller.edit("saved text")
    expect(await controller.flush()).toBe(true)
    release()
    await pause()
    expect(ready(controller).document.content).toBe("saved text")
  })

  test("failed saves block flush and retain text across closing and reopening", async () => {
    const { controller, fail } = setup()
    controller.sync(real, true)
    await until(() => controller.getView()._tag === "Ready")
    controller.edit("unsaved")
    fail("write refused")
    expect(await controller.flush()).toBe(false)
    expect(ready(controller).save).toEqual({ _tag: "Failed", reason: "write refused" })
    controller.sync(real, false)
    await pause()
    fail("")
    controller.sync(real, true)
    await until(() => controller.getView()._tag === "Ready")
    expect(ready(controller).document.content).toBe("unsaved")
    expect(await controller.flush()).toBe(true)
  })

  test("Watching rejects edits, offers Stop and becomes editable when the run ends", async () => {
    const { controller, writes, stopped } = setup()
    const subject = { ...real, take: take({ run: { _tag: "Running" } }) }
    controller.sync(subject, true)
    await until(() => controller.getView()._tag === "Ready")
    expect(ready(controller).mode._tag).toBe("Watching")
    expect(ready(controller).stop._tag).toBe("Enabled")
    controller.edit("refused")
    expect(await controller.flush()).toBe(true)
    expect(writes).toEqual([])
    controller.stop()
    expect(stopped).toEqual(["1"])
    controller.sync({ ...subject, take: take() }, true)
    controller.edit("take edit")
    expect(await controller.flush()).toBe(true)
    expect(writes[0]?.path).toBe("takes/1/file")
    expect(ready(controller).save).toEqual({ _tag: "Saved", label: "Saved to the take" })
  })

  test("late file responses cannot overwrite the next subject or a destroyed controller", async () => {
    let resolve!: (value: object) => void
    let hold = true
    const source = setup()
    let publications = 0
    const controller = createCodeController({ request: async <T>(path: string, data?: object) => {
      if (hold && path.startsWith("code/file?")) return new Promise<T>(done => { resolve = value => done(value as T) })
      return source.request<T>(path, data)
    }, changed: () => publications++, selectState: () => {}, stopTake: () => {} })
    controllers.push(controller)
    controller.sync(real, true)
    await until(() => typeof resolve === "function")
    hold = false
    controller.sync({ ...real, take: take({ created: 456 }) }, true)
    await until(() => controller.getView()._tag === "Ready")
    resolve({ file: "src/Chip.tsx", content: "old reply" })
    await pause()
    expect(ready(controller).documentKey).toBe("1@456|src/Chip.tsx")
    expect(ready(controller).document.content).toBe("original")
    controller.destroy()
    const count = publications
    controller.receive({ file: "src/Chip.tsx", take: "1" })
    controller.sync(real, true)
    await pause(180)
    expect(publications).toBe(count)
  })

  test("file requested before opening wins, and named-state lenses follow the selected state", async () => {
    const { controller } = setup()
    controller.openFile(part.file)
    controller.sync(real, true)
    await until(() => controller.getView()._tag === "Ready")
    expect(ready(controller).selectedFile).toBe(part.file)
    expect(ready(controller).lenses.map(lens => lens.current)).toEqual([true, false])
    controller.sync({ ...real, state: "Empty" }, true)
    expect(ready(controller).lenses.map(lens => lens.current)).toEqual([false, true])
  })

  test("retains one editor across SSE, close, detach and host replacement, and destroys it once", async () => {
    let created = 0
    let destroyed = 0
    let opened = 0
    const surface = { remove: () => {}, ownerDocument: null }
    const host = { ownerDocument: { createElement: () => surface }, append: () => {} } as unknown as HTMLDivElement
    const secondHost = { ...host } as HTMLDivElement
    const module: typeof editorModule = { ...editorModule, createEditor: () => {
      created++
      return { open: () => { opened++ }, destroy: () => { destroyed++ }, setMode: () => {}, replaceFromDisk: () => {}, setLenses: () => {}, revealState: () => {}, nextChange: () => false, previousChange: () => false, focus: () => {} }
    } }
    const { controller } = setup({ loadEditor: async () => module })
    controller.sync(real, true)
    await until(() => controller.getView()._tag === "Ready")
    controller.mount(host)
    controller.mount(host)
    const before = opened
    controller.sync(structuredClone(real), true)
    expect(opened).toBe(before)
    controller.sync(real, false)
    controller.mount(null)
    expect(destroyed).toBe(0)
    controller.sync(real, true)
    await until(() => controller.getView()._tag === "Ready")
    controller.mount(secondHost)
    expect(created).toBe(1)
    controller.destroy(); controller.destroy()
    expect(destroyed).toBe(1)
  })

  test("follows new agent files until a user picks a file and reports changed-file statistics", async () => {
    const { controller, setFiles, disk } = setup()
    const subject = { ...real, take: take({ run: { _tag: "Running" } }) }
    setFiles([{ file: part.file, depth: 0, changed: false }, { file: "src/Chip.tsx", depth: 1, changed: true }])
    disk.set("src/Chip.tsx", "original\nadded")
    controller.sync(subject, true)
    await until(() => controller.getView()._tag === "Ready" && ready(controller).files.some(file => (file.added ?? 0) > 0))
    expect(ready(controller).files.find(file => file.file === "src/Chip.tsx")?.added).toBe(editorModule.lineChanges("original", "original\nadded").added)
    setFiles([{ file: part.file, depth: 0, changed: false }, { file: "src/Chip.tsx", depth: 1, changed: true }, { file: "src/new.css", depth: null, changed: true }])
    controller.receive({ file: "src/new.css", take: "1" })
    await until(() => ready(controller).selectedFile === "src/new.css")
    controller.openFile(part.file)
    await until(() => controller.getView()._tag === "Ready")
    setFiles([{ file: part.file, depth: 0, changed: false }, { file: "src/Chip.tsx", depth: 1, changed: true }, { file: "src/new.css", depth: null, changed: true }, { file: "src/another.css", depth: null, changed: true }])
    controller.receive({ file: "src/another.css", take: "1" })
    await until(() => ready(controller).files.length === 4)
    expect(ready(controller).selectedFile).toBe(part.file)
  })

  test("a reused numeric take id cannot receive dirty text kept from the previous creation", async () => {
    const { controller, fail, writes } = setup()
    controller.sync({ ...real, take: take() }, true)
    await until(() => controller.getView()._tag === "Ready")
    controller.edit("old unsaved text")
    fail("offline")
    expect(await controller.flush()).toBe(false)
    fail("")
    controller.sync({ ...real, take: take({ created: 456 }) }, true)
    await until(() => controller.getView()._tag === "Ready")
    expect(ready(controller).documentKey).toBe("1@456|src/Chip.tsx")
    expect(ready(controller).document.content).toBe("original")
    expect(await controller.flush()).toBe(false)
    expect(writes).toEqual([])
  })

  test("load failures can retry and no subject produces an Empty view", async () => {
    const { controller, fail } = setup()
    controller.sync(null, true)
    expect(controller.getView()._tag).toBe("Empty")
    fail("file unavailable")
    controller.sync(real, true)
    await until(() => controller.getView()._tag === "Failed")
    fail("")
    controller.sync(structuredClone(real), true)
    expect(controller.getView()._tag).toBe("Failed")
    controller.retry()
    await until(() => controller.getView()._tag === "Ready")
    expect(ready(controller).document.content).toBe("original")
  })
})
