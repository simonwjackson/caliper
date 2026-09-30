import { expect, test } from "bun:test"
import { chromium } from "playwright-core"
import { resolve } from "node:path"

test("real CodeMirror preserves undo and cursor, suppresses disk edits, locks Watching and re-enables Revert", async () => {
  if (!process.env.CHROMIUM) throw new Error("Run with nix develop to supply CHROMIUM")
  const build = await Bun.build({ entrypoints: [resolve("test/chrome-code-browser-entry.ts")], target: "browser" })
  if (!build.success) throw new Error(build.logs.join("\n"))
  const bundle = await build.outputs[0]!.text()
  const server = Bun.serve({ port: 0, fetch: request => new URL(request.url).pathname === "/editor.js"
    ? new Response(bundle, { headers: { "content-type": "text/javascript" } })
    : new Response("<!doctype html><div id='host'></div><div id='diff'></div>", { headers: { "content-type": "text/html" } }) })
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
  try {
    const page = await browser.newPage()
    const errors: string[] = []
    page.on("pageerror", error => errors.push(error.message))
    await page.goto(server.url.href)
    const result = await page.evaluate(async () => {
      const path = "/editor.js"
      const { createEditor, createDiffView, EditorView, undo } = await import(path)
      const host = document.querySelector("#host")!
      const edits: string[] = []
      const states: string[] = []
      let saves = 0
      const original = "export default function Part() {}\nexport const Empty = () => null\n"
      const hooks = { onEdit: (content: string) => edits.push(content), onSave: () => saves++, onSelectState: (state: string) => states.push(state), onChanges: () => {} }
      const editor = createEditor(host, hooks)
      const opened = { key: "real|part", file: "Part.tsx", content: original, mode: { _tag: "Real" }, lenses: [{ export: "default", label: "Default", current: true }, { export: "Empty", label: "Empty", current: false }] }
      editor.open(opened)
      const view = EditorView.findFromDOM(host.querySelector(".cm-editor")!)
      view.dispatch({ changes: { from: 0, insert: "// typed\n" }, selection: { anchor: 9 } })
      const cursor = view.state.selection.main.head
      editor.open({ ...opened, content: view.state.doc.toString() })
      const retainedCursor = view.state.selection.main.head === cursor
      editor.open({ ...opened, key: "real|other", file: "Other.tsx", content: "other", lenses: [] })
      editor.open({ ...opened, content: "// typed\n" + original })
      const retainedFileCursor = view.state.selection.main.head === cursor
      const undoWorked = undo(view) && view.state.doc.toString() === original
      const count = edits.length
      editor.replaceFromDisk(original + "// disk\n", true)
      const diskDidNotEdit = edits.length === count
      undo(view)
      const diskNotInHistory = view.state.doc.toString().includes("// disk")
      editor.open({ ...opened, key: "1@123|part", content: original + "// take\n", mode: { _tag: "Watching", original } })
      view.dispatch({ changes: { from: 0, insert: "refused" } })
      const watchingLocked = !view.state.doc.toString().includes("refused")
      await new Promise(resolve => requestAnimationFrame(resolve))
      const watchingRevertDisabled = [...host.querySelectorAll<HTMLButtonElement>(".cm-cal-revert")].every(button => button.disabled)
      editor.setMode({ _tag: "Take", original })
      await new Promise(resolve => requestAnimationFrame(resolve))
      const revert = host.querySelector<HTMLButtonElement>(".cm-cal-revert")
      const revertEnabled = !!revert && !revert.disabled
      revert?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
      const reverted = view.state.doc.toString() === original
      host.querySelector<HTMLButtonElement>(".cm-cal-lens button[data-current='false']")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
      view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "s", code: "KeyS", ctrlKey: true, bubbles: true }))
      const diff = createDiffView(document.querySelector("#diff")!, { path: "Part.tsx", before: original, after: original + "// new\n" })
      const diffView = EditorView.findFromDOM(document.querySelector("#diff .cm-editor")!)
      const reviewReadonly = diffView.state.readOnly && diffView.contentDOM.contentEditable === "false"
      diff.destroy()
      editor.destroy()
      await new Promise(resolve => setTimeout(resolve, 1650))
      return { retainedCursor, retainedFileCursor, undoWorked, diskDidNotEdit, diskNotInHistory, watchingLocked, watchingRevertDisabled, revertEnabled, reverted, states, saves, reviewReadonly, destroyed: host.childElementCount === 0 }
    })
    expect(result).toEqual({ retainedCursor: true, retainedFileCursor: true, undoWorked: true, diskDidNotEdit: true, diskNotInHistory: true, watchingLocked: true, watchingRevertDisabled: true, revertEnabled: true, reverted: true, states: ["Empty"], saves: 1, reviewReadonly: true, destroyed: true })
    expect(errors).toEqual([])
  } finally {
    await browser.close()
    server.stop(true)
  }
}, 30_000)
